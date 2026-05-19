package main

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	_ "modernc.org/sqlite"
)

const (
	colorReset  = "\033[0m"
	colorRed    = "\033[31m"
	colorGreen  = "\033[32m"
	colorYellow = "\033[33m"
	colorCyan   = "\033[36m"
	colorBold   = "\033[1m"
)

type basicStats struct {
	MaxBPM   int
	AvgBPM   int
	Total    int
	Accepted int
	Rejected int
}

type topCommit struct {
	BPM  int
	Hash string
	At   string
}

type timeBand struct {
	Label   string
	Key     string
	Total   int
	Dead    int
	DeadPct int
	SuccPct int
}

func main() {
	home, err := os.UserHomeDir()
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}

	dbPath := filepath.Join(home, ".ddd", "ddd.db")
	if _, err := os.Stat(dbPath); os.IsNotExist(err) {
		fmt.Println("まだデータがありません（デーモンを起動してコミットしてみてください）")
		return
	}

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: open db: %v\n", err)
		os.Exit(1)
	}
	defer db.Close()

	ctx := context.Background()

	bs, err := queryBasicStats(ctx, db)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: query stats: %v\n", err)
		os.Exit(1)
	}
	if bs.Total == 0 {
		fmt.Println("まだデータがありません（コミットしてみてください）")
		return
	}

	tops, err := queryTopCommits(ctx, db)
	if err != nil {
		fmt.Fprintf(os.Stderr, "warning: top commits: %v\n", err)
	}

	bands, err := queryTimeBands(ctx, db)
	if err != nil {
		fmt.Fprintf(os.Stderr, "warning: time bands: %v\n", err)
	}

	sep := strings.Repeat("━", 38)
	fmt.Printf("%s%s%s\n", colorBold, sep, colorReset)
	fmt.Printf("%s  🔥 DDD PASSION REPORT 🔥%s\n", colorBold, colorReset)
	fmt.Printf("%s%s%s\n\n", colorBold, sep, colorReset)

	printBasicStats(bs)
	printTopCommits(tops)
	printTimeAnalysis(bands)

	fmt.Printf("%s%s%s\n", colorBold, sep, colorReset)
}

func queryBasicStats(ctx context.Context, db *sql.DB) (basicStats, error) {
	var bs basicStats
	err := db.QueryRowContext(ctx, `
		SELECT
			COALESCE(MAX(bpm_at_commit), 0),
			COALESCE(CAST(AVG(bpm_at_commit) AS INTEGER), 0),
			COUNT(*),
			COALESCE(SUM(CASE WHEN result = 'accepted' THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN result = 'rejected' THEN 1 ELSE 0 END), 0)
		FROM commit_attempts
	`).Scan(&bs.MaxBPM, &bs.AvgBPM, &bs.Total, &bs.Accepted, &bs.Rejected)
	return bs, err
}

func queryTopCommits(ctx context.Context, db *sql.DB) ([]topCommit, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT bpm_at_commit, COALESCE(commit_hash, ''), strftime('%Y-%m-%d %H:%M', attempted_at, 'localtime')
		FROM commit_attempts
		WHERE result = 'accepted'
		ORDER BY bpm_at_commit DESC
		LIMIT 3
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tops []topCommit
	for rows.Next() {
		var t topCommit
		if err := rows.Scan(&t.BPM, &t.Hash, &t.At); err != nil {
			return nil, fmt.Errorf("scan top commit: %w", err)
		}
		if len(t.Hash) > 7 {
			t.Hash = t.Hash[:7]
		}
		tops = append(tops, t)
	}
	return tops, rows.Err()
}

func queryTimeBands(ctx context.Context, db *sql.DB) ([]timeBand, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT
			CASE
				WHEN CAST(strftime('%H', attempted_at, 'localtime') AS INTEGER) < 6  THEN '00-06'
				WHEN CAST(strftime('%H', attempted_at, 'localtime') AS INTEGER) < 12 THEN '06-12'
				WHEN CAST(strftime('%H', attempted_at, 'localtime') AS INTEGER) < 18 THEN '12-18'
				ELSE                                                                      '18-24'
			END as key,
			COUNT(*) as total,
			SUM(CASE WHEN result = 'rejected' THEN 1 ELSE 0 END) as dead
		FROM commit_attempts
		GROUP BY key
		ORDER BY key
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	keyToLabel := map[string]string{
		"00-06": "深夜（ 0〜 6時）",
		"06-12": "午前（ 6〜12時）",
		"12-18": "午後（12〜18時）",
		"18-24": "夜  （18〜24時）",
	}

	var bands []timeBand
	for rows.Next() {
		var b timeBand
		if err := rows.Scan(&b.Key, &b.Total, &b.Dead); err != nil {
			return nil, fmt.Errorf("scan time band: %w", err)
		}
		b.Label = keyToLabel[b.Key]
		if b.Total > 0 {
			b.DeadPct = (b.Dead*100 + b.Total/2) / b.Total
			b.SuccPct = 100 - b.DeadPct
		}
		bands = append(bands, b)
	}
	return bands, rows.Err()
}

func findBestWorstBand(bands []timeBand) (best, worst *timeBand) {
	for i := range bands {
		b := &bands[i]
		if b.Total == 0 {
			continue
		}
		if best == nil || b.SuccPct > best.SuccPct {
			best = b
		}
		if b.Dead > 0 && (worst == nil || b.DeadPct > worst.DeadPct) {
			worst = b
		}
	}
	return
}

func printBasicStats(bs basicStats) {
	successRate := 0
	if bs.Total > 0 {
		successRate = (bs.Accepted*100 + bs.Total/2) / bs.Total
	}
	deadRate := 100 - successRate

	fmt.Printf("📊 基本統計\n")
	fmt.Printf("  最大心拍  : %s%d bpm%s\n", colorCyan, bs.MaxBPM, colorReset)
	fmt.Printf("  平均心拍  : %d bpm\n", bs.AvgBPM)
	fmt.Printf("  成功率    : %s%d%%（%d / %d 回）%s\n", colorGreen, successRate, bs.Accepted, bs.Total, colorReset)
	fmt.Printf("  DEAD率    : %s%d%%（%d / %d 回）%s\n\n", colorRed, deadRate, bs.Rejected, bs.Total, colorReset)
}

func printTopCommits(tops []topCommit) {
	if len(tops) == 0 {
		return
	}
	medals := []string{"🥇", "🥈", "🥉"}
	fmt.Printf("🏆 ベストコミット\n")
	for i, t := range tops {
		hash := t.Hash
		if hash == "" {
			hash = "N/A"
		}
		fmt.Printf("  %s %s%d bpm%s  %s  %s\n", medals[i], colorGreen, t.BPM, colorReset, hash, t.At)
	}
	fmt.Println()
}

func printTimeAnalysis(bands []timeBand) {
	if len(bands) == 0 {
		return
	}
	best, worst := findBestWorstBand(bands)

	fmt.Printf("⏰ 時間帯分析\n")

	if best != nil {
		fmt.Printf("  %s🔥 ゴールデンタイム%s\n", colorGreen, colorReset)
		fmt.Printf("    %s：成功率 %d%%\n", best.Label, best.SuccPct)
	}

	if worst != nil {
		fmt.Printf("  %s💀 危険時間帯%s\n", colorRed, colorReset)
		fmt.Printf("    %s：DEAD率 %d%%\n", worst.Label, worst.DeadPct)
	}

	// ゴールデン・危険以外のバンドを簡易表示
	for _, b := range bands {
		if b.Total == 0 {
			continue
		}
		if best != nil && b.Key == best.Key {
			continue
		}
		if worst != nil && b.Key == worst.Key {
			continue
		}
		icon := "📊"
		fmt.Printf("  %s %s：成功率 %d%%\n", icon, b.Label, b.SuccPct)
	}
	fmt.Println()
}

