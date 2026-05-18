package main

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"net/http"
	"os"
	"runtime"
	"strconv"
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
)

const noPowerBanner = `
██╗   ██╗ ██████╗ ██╗   ██╗    ██████╗ ███████╗ █████╗ ██████╗
╚██╗ ██╔╝██╔═══██╗██║   ██║    ██╔══██╗██╔════╝██╔══██╗██╔══██╗
 ╚████╔╝ ██║   ██║██║   ██║    ██║  ██║█████╗  ███████║██║  ██║
  ╚██╔╝  ██║   ██║██║   ██║    ██║  ██║██╔══╝  ██╔══██║██║  ██║
   ██║   ╚██████╔╝╚██████╔╝    ██████╔╝███████╗██║  ██║██████╔╝██╗██╗██╗
   ╚═╝    ╚═════╝  ╚═════╝     ╚═════╝ ╚══════╝╚═╝  ╚═╝╚═════╝ ╚═╝╚═╝╚═╝`

func main() {
	threshold := defaultThreshold
	if v := os.Getenv("DDD_THRESHOLD_BPM"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			threshold = n
		} else {
			warn(fmt.Sprintf("⚠ Invalid DDD_THRESHOLD_BPM=%q, using default %d", v, defaultThreshold))
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
			os.Exit(0)
		}
		printRejected(bpm, threshold)
		os.Exit(1)
	default:
		warn("❓ Unexpected response from daemon — commit OK")
		os.Exit(0)
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

func warn(msg string) {
	fmt.Printf("%s%s%s\n", colorYellow, msg, colorReset)
}
