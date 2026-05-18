package main

import (
	"encoding/json"
	"fmt"
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

func printRejected(bpm, threshold int) {
	fmt.Printf("\n%s💔  BPM: %d  —  Commit BLOCKED%s\n", colorRed, bpm, colorReset)
	fmt.Printf("%s%s%s\n", colorRed, getBanner(), colorReset)
	fmt.Printf("%s\n  🏃 Need %d+ BPM to commit. Go get your heart pumping!\n%s\n", colorRed, threshold, colorReset)
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
