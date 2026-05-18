package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"math/rand"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

const (
	colorReset  = "\033[0m"
	colorRed    = "\033[31m"
	colorGreen  = "\033[32m"
	colorYellow = "\033[33m"

	daemonURL        = "http://localhost:8765/heartrate/current"
	timeout          = 3 * time.Second
	defaultThreshold = 120
	minThreshold     = 40  // 医学的下限（アスリート・心疾患を考慮）
	maxThreshold     = 120 // hooks 契約: exit 1 は bpm < threshold の場合のみ
)

const noPowerBanner = `
██╗   ██╗ ██████╗ ██╗   ██╗    ██████╗ ███████╗ █████╗ ██████╗
╚██╗ ██╔╝██╔═══██╗██║   ██║    ██╔══██╗██╔════╝██╔══██╗██╔══██╗
 ╚████╔╝ ██║   ██║██║   ██║    ██║  ██║█████╗  ███████║██║  ██║
  ╚██╔╝  ██║   ██║██║   ██║    ██║  ██║██╔══╝  ██╔══██║██║  ██║
   ██║   ╚██████╔╝╚██████╔╝    ██████╔╝███████╗██║  ██║██████╔╝██╗██╗██╗
   ╚═╝    ╚═════╝  ╚═════╝     ╚═════╝ ╚══════╝╚═╝  ╚═╝╚═════╝ ╚═╝╚═╝╚═╝`

func main() {
	if len(os.Args) > 1 && os.Args[1] == "check" {
		runCheck()
		return
	}

	threshold := defaultThreshold
	if n, ok, err := loadRCThreshold(); err != nil {
		warn(fmt.Sprintf("⚠ failed to read ~/.ddddrc: %v", err))
	} else if ok {
		threshold = n
	}
	if v := os.Getenv("DDD_THRESHOLD_BPM"); v != "" {
		if n, err := strconv.Atoi(v); err != nil {
			warn(fmt.Sprintf("⚠ Invalid DDD_THRESHOLD_BPM=%q, using %d", v, threshold))
		} else if n < minThreshold || n > maxThreshold {
			warn(fmt.Sprintf("⚠ DDD_THRESHOLD_BPM=%d out of range [%d, %d], using %d", n, minThreshold, maxThreshold, threshold))
		} else {
			threshold = n
		}
	}

	bpm, status, err := fetchHeartRate()
	if err != nil {
		warn("💤 Daemon offline — commit OK (passion unverified)")
		os.Exit(0)
	}

	switch status {
	case "stale":
		warn("📡 No heart rate data — commit OK (wake up Apple Watch!)")
		os.Exit(0)
	case "ok":
		if bpm >= threshold {
			fmt.Printf("%s🔥 BPM: %d — You're fired up! Commit allowed ✓%s\n", colorGreen, bpm, colorReset)
			printECG(bpm)
			if err := storeBPMForTrailer(bpm); err != nil {
				warn(fmt.Sprintf("⚠ failed to store BPM for trailer: %v", err))
			}
			if err := recordCommit(bpm, "accepted"); err != nil {
				warn(fmt.Sprintf("⚠ failed to record commit result: %v", err))
			}
			os.Exit(0)
		}
		printRejected(bpm, threshold)
		if err := recordCommit(bpm, "rejected"); err != nil {
			warn(fmt.Sprintf("⚠ failed to record commit result: %v", err))
		}
		os.Exit(1)
	default:
		warn("❓ Unexpected response from daemon — commit OK")
		os.Exit(0)
	}
}

func runCheck() {
	bpm, status, err := fetchHeartRate()
	if err != nil {
		warn("💤 Daemon offline — heart rate unavailable")
		return
	}
	switch status {
	case "stale":
		warn("📡 No heart rate data (wake up Apple Watch!)")
	case "ok":
		fmt.Printf("%s♥ BPM: %d%s\n", colorGreen, bpm, colorReset)
		printECG(bpm)
	default:
		warn("❓ Unexpected response from daemon")
	}
}

var heartRateTips = []string{
	"階段ダッシュ                    +60 bpm（推奨）",
	"締切ギリギリ駆動                +40 bpm",
	"上司からのSlack通知             +35 bpm",
	"コーヒー10杯                    +25 bpm",
	"本番環境に直接デプロイ          +80 bpm",
	"git push --force origin main    +75 bpm",
	"「もうすぐ終わります」と宣言    +50 bpm",
	"エナジードリンク3本             +40 bpm",
	"merge conflict を手動解決       +30 bpm",
	"テストなしで main にマージ      +65 bpm",
	"深夜2時のデバッグセッション     +55 bpm",
	"腕立て伏せ20回                  +45 bpm",
	"スクワット30回                  +50 bpm",
	"その場ダッシュ30秒              +65 bpm",
	"腹筋50回                        +40 bpm",
	"ジャンピングジャック20回        +55 bpm",
	"廊下を全力ダッシュ              +80 bpm",
}

func printRejected(bpm, threshold int) {
	fmt.Printf("\n%s💔  BPM: %d  —  Commit BLOCKED%s\n", colorRed, bpm, colorReset)
	fmt.Printf("%s%s%s\n", colorRed, getBanner(), colorReset)
	fmt.Printf("%s\n", colorRed)
	fmt.Printf("  Heart rate : %d bpm\n", bpm)
	fmt.Printf("  Threshold  : %d bpm\n", threshold)
	fmt.Printf("  Reason     : 情熱が足りません。\n")
	fmt.Printf("\n  心拍を上げる方法:\n")
	tips := rand.Perm(len(heartRateTips))[:4]
	for _, i := range tips {
		fmt.Printf("  ・%s\n", heartRateTips[i])
	}
	fmt.Printf("%s\n", colorReset)
}

// getBanner returns an ASCII-only banner on Windows cmd.exe to avoid garbled output.
func getBanner() string {
	if runtime.GOOS == "windows" {
		return `
__   __  ___  _   _    ____  _____    _    ____
\ \ / / / _ \| | | |  |  _ \| ____|  / \  |  _ \
 \ V / | | | | | | |  | | | |  _|   / _ \ | | | |
  | |  | |_| | |_| |  | |_| | |___ / ___ \| |_| |
  |_|   \___/ \___/   |____/|_____/_/   \_\____/  . . .`
	}
	return noPowerBanner
}

type heartRateResponse struct {
	BPM    int    `json:"bpm"`
	Status string `json:"status"`
}

func fetchHeartRate() (bpm int, status string, err error) {
	client := &http.Client{Timeout: timeout}
	resp, err := client.Get(daemonURL)
	if err != nil {
		return 0, "", err
	}
	defer resp.Body.Close()

	var r heartRateResponse
	if err := json.NewDecoder(resp.Body).Decode(&r); err != nil {
		return 0, "", err
	}
	return r.BPM, r.Status, nil
}

// loadRCThreshold reads threshold_bpm from ~/.ddddrc.
// Returns (value, true, nil) if found, (0, false, nil) if file absent or key missing,
// (0, false, err) on I/O or permission errors.
func loadRCThreshold() (int, bool, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return 0, false, err
	}
	f, err := os.Open(filepath.Join(home, ".ddddrc"))
	if err != nil {
		if os.IsNotExist(err) {
			return 0, false, nil
		}
		return 0, false, err
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}
		if strings.TrimSpace(parts[0]) == "threshold_bpm" {
			val := strings.TrimSpace(parts[1])
			n, err := strconv.Atoi(val)
			if err != nil {
				fmt.Fprintf(os.Stderr, "⚠ ~/.ddddrc: invalid threshold_bpm=%q, ignored\n", val)
				continue
			}
			if n < minThreshold {
				fmt.Fprintf(os.Stderr, "%s💀 threshold_bpm=%d？それは甘えです。%s\n", colorRed, n, colorReset)
				fmt.Fprintf(os.Stderr, "%s   閾値を下げる前に心拍を上げる努力をしてください。%s\n", colorRed, colorReset)
				continue
			}
			if n > maxThreshold {
				fmt.Fprintf(os.Stderr, "⚠ ~/.ddddrc: threshold_bpm=%d out of range [%d, %d], ignored\n", n, minThreshold, maxThreshold)
				continue
			}
			return n, true, nil
		}
	}
	if err := scanner.Err(); err != nil {
		return 0, false, err
	}
	return 0, false, nil
}

func warn(msg string) {
	fmt.Printf("%s%s%s\n", colorYellow, msg, colorReset)
}

func termWidth() int {
	if s := os.Getenv("COLUMNS"); s != "" {
		if n, err := strconv.Atoi(s); err == nil && n > 0 {
			return n
		}
	}
	if out, err := exec.Command("tput", "cols").Output(); err == nil {
		if n, err := strconv.Atoi(strings.TrimSpace(string(out))); err == nil && n > 0 {
			return n
		}
	}
	return 80
}

// buildECGRows generates a 4-row ECG waveform.
// The spike rises from the baseline (row 3) up through rows 2, 1, 0.
//
//	        /\
//	       /  \
//	      /    \
//	_____/      \______
func buildECGRows(bpm, width int) [4][]byte {
	if bpm <= 0 {
		bpm = 1
	}
	const spikeW = 8
	r0spike := "   /\\   " // 3sp /\ 3sp
	r1spike := "  /  \\  " // 2sp / 2sp \ 2sp
	r2spike := " /    \\ " // 1sp / 4sp \ 1sp
	r3spike := "/      \\" // / 6sp \

	period := width * 40 / bpm
	if period < spikeW+8 {
		period = spikeW + 8
	}

	flat := period - spikeW
	before := flat * 2 / 3
	after := flat - before

	r0unit := strings.Repeat(" ", before) + r0spike + strings.Repeat(" ", after)
	r1unit := strings.Repeat(" ", before) + r1spike + strings.Repeat(" ", after)
	r2unit := strings.Repeat(" ", before) + r2spike + strings.Repeat(" ", after)
	r3unit := strings.Repeat("_", before) + r3spike + strings.Repeat("_", after)

	var sb0, sb1, sb2, sb3 strings.Builder
	for sb0.Len() < width {
		sb0.WriteString(r0unit)
		sb1.WriteString(r1unit)
		sb2.WriteString(r2unit)
		sb3.WriteString(r3unit)
	}

	return [4][]byte{
		[]byte(sb0.String())[:width],
		[]byte(sb1.String())[:width],
		[]byte(sb2.String())[:width],
		[]byte(sb3.String())[:width],
	}
}

func printECG(bpm int) {
	const height = 4
	width := termWidth()
	rows := buildECGRows(bpm, width)

	delay := time.Duration(1200/width) * time.Millisecond
	if delay < 5*time.Millisecond {
		delay = 5 * time.Millisecond
	}

	fmt.Printf("%s", colorGreen)
	for c := 0; c < width; c++ {
		if c > 0 {
			fmt.Printf("\033[%dA\r", height-1)
		}
		for row := 0; row < height; row++ {
			fmt.Printf("%s", rows[row][:c+1])
			if c < width-1 {
				fmt.Print(strings.Repeat(" ", width-c-1))
			}
			if row < height-1 {
				fmt.Print("\n")
			}
		}
		time.Sleep(delay)
	}
	// 空行を1行追加
	fmt.Printf("%s\n\n", colorReset)
}

func storeBPMForTrailer(bpm int) error {
	out, err := exec.Command("git", "rev-parse", "--git-dir").Output()
	if err != nil {
		return fmt.Errorf("resolve git-dir: %w", err)
	}
	bpmFile := filepath.Join(strings.TrimSpace(string(out)), "DDD_BPM")
	if err := os.WriteFile(bpmFile, []byte(strconv.Itoa(bpm)), 0o644); err != nil {
		return fmt.Errorf("write DDD_BPM: %w", err)
	}
	return nil
}

func recordCommit(bpm int, result string) error {
	repoPath := ""
	if out, err := exec.Command("git", "rev-parse", "--show-toplevel").Output(); err == nil {
		repoPath = strings.TrimSpace(string(out))
	}

	body, err := json.Marshal(map[string]any{
		"repo_path":   repoPath,
		"commit_hash": "",
		"bpm":         bpm,
		"result":      result,
	})
	if err != nil {
		return fmt.Errorf("marshal commit payload: %w", err)
	}

	client := &http.Client{Timeout: 1 * time.Second}
	resp, err := client.Post("http://localhost:8765/commits", "application/json", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("post commit record: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("post commit record: unexpected status %s", resp.Status)
	}
	return nil
}
