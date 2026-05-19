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

type profile struct {
	Rank        string
	TypeName    string
	StylePoints []string
	Assessment  string
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
	if err != nil || bs.Total == 0 {
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

	p := buildProfile(bs, bands)

	sep := strings.Repeat("━", 38)
	fmt.Printf("%s%s%s\n", colorBold, sep, colorReset)
	fmt.Printf("%s  🔥 DDD PASSION REPORT 🔥%s\n", colorBold, colorReset)
	fmt.Printf("%s%s%s\n\n", colorBold, sep, colorReset)

	printOverall(p, bs)
	printBasicStats(bs)
	printStyleAnalysis(p)
	printTopCommits(tops)
	printTimeAnalysis(bands)
	printAssessment(p)

	fmt.Printf("%s%s%s\n", colorBold, sep, colorReset)
}

func queryBasicStats(ctx context.Context, db *sql.DB) (basicStats, error) {
	var bs basicStats
	err := db.QueryRowContext(ctx, `
		SELECT
			MAX(bpm_at_commit),
			CAST(AVG(bpm_at_commit) AS INTEGER),
			COUNT(*),
			SUM(CASE WHEN result = 'accepted' THEN 1 ELSE 0 END),
			SUM(CASE WHEN result = 'rejected' THEN 1 ELSE 0 END)
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
			continue
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
			continue
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

func buildProfile(bs basicStats, bands []timeBand) profile {
	successRate := 0
	if bs.Total > 0 {
		successRate = (bs.Accepted*100 + bs.Total/2) / bs.Total
	}

	// ランク決定
	rank := "C"
	switch {
	case (bs.MaxBPM >= 155 && successRate >= 60) || successRate >= 85:
		rank = "S"
	case bs.MaxBPM >= 140 || successRate >= 65:
		rank = "A"
	case bs.MaxBPM >= 120 || successRate >= 40:
		rank = "B"
	}

	// タイプ決定
	typeName := "安定型エンジニア"
	switch {
	case bs.MaxBPM >= 160:
		typeName = "バーサーカー型エンジニア"
	case successRate >= 85:
		typeName = "スナイパー型エンジニア"
	case bs.Rejected > bs.Accepted:
		typeName = "玉砕型エンジニア"
	case bs.AvgBPM >= 120 && bs.AvgBPM <= 135 && successRate >= 60:
		typeName = "ステルス型エンジニア"
	case bs.MaxBPM >= 145:
		typeName = "瞬発力型エンジニア"
	}

	// スタイル分析（2〜3点）
	var stylePoints []string
	if bs.MaxBPM >= 155 {
		stylePoints = append(stylePoints, "瞬間火力が非常に高い")
	}
	if successRate >= 70 {
		stylePoints = append(stylePoints, "コミット成功率が高く安定している")
	} else if successRate < 45 {
		stylePoints = append(stylePoints, "失敗を恐れずチャレンジするスタイル")
	}
	bestBand, worstBand := findBestWorstBand(bands)
	if bestBand != nil {
		switch bestBand.Key {
		case "00-06":
			stylePoints = append(stylePoints, "深夜帯に最高のパフォーマンスを発揮")
		case "06-12":
			stylePoints = append(stylePoints, "午前中にゴールデンタイムがある朝型")
		case "18-24":
			stylePoints = append(stylePoints, "夜間にパフォーマンスが上がる夜型")
		}
	}
	if worstBand != nil && worstBand.DeadPct >= 40 {
		stylePoints = append(stylePoints, worstBand.Label+"にパフォーマンス低下")
	}
	if bs.AvgBPM >= 140 {
		stylePoints = append(stylePoints, "常時高心拍でコミットするストロングスタイル")
	} else if bs.AvgBPM >= 120 && bs.AvgBPM <= 132 {
		stylePoints = append(stylePoints, "閾値ギリギリをコントロールする玄人感")
	}
	if len(stylePoints) > 3 {
		stylePoints = stylePoints[:3]
	}

	// 総評
	assessment := buildAssessment(typeName, successRate, bs, bestBand, worstBand)

	return profile{
		Rank:        rank,
		TypeName:    typeName,
		StylePoints: stylePoints,
		Assessment:  assessment,
	}
}

func buildAssessment(typeName string, successRate int, bs basicStats, best, worst *timeBand) string {
	switch typeName {
	case "バーサーカー型エンジニア":
		return "あなたは「追い込まれるほど強いタイプ」です。\n  平常時の生産性は低めですが、緊張状態では圧倒的なパフォーマンスを発揮します。\n  締切前のラストスパートに期待大。"
	case "スナイパー型エンジニア":
		return "あなたは「確実に仕留めるタイプ」です。\n  コミット成功率の高さが光ります。\n  焦らず着実に、そのスタイルを貫いてください。"
	case "玉砕型エンジニア":
		return "あなたは「量で勝負するタイプ」です。\n  失敗数が多い分、チャレンジ精神は折り紙付き。\n  次は心拍を上げてから commit！"
	case "ステルス型エンジニア":
		return "あなたは「省エネ最適化タイプ」です。\n  閾値をギリギリ超えるコントロールは職人技。\n  余裕があるときはもっと情熱を解放しましょう。"
	default:
		if successRate >= 60 {
			return "あなたは「バランス型」です。\n  安定した成功率と適度な興奮状態を保っています。\n  このペースを維持していきましょう。"
		}
		return "あなたはまだデータ蓄積中です。\n  コミットを重ねるほど精度が上がります。\n  引き続き情熱的な開発を！"
	}
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

func printOverall(p profile, bs basicStats) {
	rankColor := colorGreen
	if p.Rank == "S" {
		rankColor = colorYellow
	} else if p.Rank == "C" {
		rankColor = colorRed
	}
	fmt.Printf("%s🔥 総合評価%s：%s%s%sランク — %s\n\n",
		colorBold, colorReset, rankColor, colorBold, p.Rank, p.TypeName+colorReset)
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

func printStyleAnalysis(p profile) {
	if len(p.StylePoints) == 0 {
		return
	}
	fmt.Printf("🧠 開発スタイル分析\n")
	for _, pt := range p.StylePoints {
		fmt.Printf("  ・%s\n", pt)
	}
	fmt.Println()
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

func printAssessment(p profile) {
	fmt.Printf("🧾 総評\n  %s\n\n", p.Assessment)
}
