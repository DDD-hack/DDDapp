package store

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	firebase "firebase.google.com/go/v4"
	"firebase.google.com/go/v4/db"
	"google.golang.org/api/option"
)

// RTDBClient は DDD 用に Firebase Realtime Database へ書き込むラッパー。
//
// 高頻度な BPM（1Hz）と低頻度なコミット結果の中継のため、Firestore（書き込み回数課金）の
// 代わりに RTDB（データ転送量課金）を採用している。詳細は docs/schema.md を参照。
//
// FirestoreClient と同様、認証情報が未設定の場合は値そのものを nil として扱う。
// 全メソッドは nil レシーバを許容する（呼び出し側の nil チェックを減らすため）。
type RTDBClient struct {
	cli *db.Client
}

// OpenRTDB は Realtime Database クライアントを開く。
//
// fail-safe 設計:
//   - credentialsPath か databaseURL のどちらかが空 → (nil, nil) を返す（サイレント無効化）。
//   - credentialsPath が指定されていてもファイルが無ければ通常エラーを返す
//     （呼び出し側は warning として起動を継続する想定）。
//
// expandHome は firebase.go の同名ヘルパーを再利用する。
func OpenRTDB(ctx context.Context, credentialsPath, databaseURL string) (*RTDBClient, error) {
	if strings.TrimSpace(credentialsPath) == "" || strings.TrimSpace(databaseURL) == "" {
		return nil, nil
	}

	expanded, err := expandHome(credentialsPath)
	if err != nil {
		return nil, fmt.Errorf("resolve credentials path: %w", err)
	}
	if _, err := os.Stat(expanded); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, fmt.Errorf("firebase credentials not found: %s", expanded)
		}
		return nil, fmt.Errorf("stat credentials file: %w", err)
	}

	app, err := firebase.NewApp(ctx, &firebase.Config{DatabaseURL: databaseURL}, option.WithCredentialsFile(expanded))
	if err != nil {
		return nil, fmt.Errorf("firebase init: %w", err)
	}
	cli, err := app.Database(ctx)
	if err != nil {
		return nil, fmt.Errorf("rtdb client: %w", err)
	}
	return &RTDBClient{cli: cli}, nil
}

// validateUID checks if uid complies with Firebase Realtime Database key constraints.
func validateUID(uid string) error {
	if len(uid) > 128 {
		return fmt.Errorf("uid too long: %d characters", len(uid))
	}
	disallowed := []rune{'.', '$', '#', '[', ']', '/'}
	for _, r := range disallowed {
		if strings.ContainsRune(uid, r) {
			return fmt.Errorf("uid contains disallowed character: %q", r)
		}
	}
	for i := 0; i < len(uid); i++ {
		c := uid[i]
		if c < 0x20 || c == 0x7F {
			return fmt.Errorf("uid contains control character: 0x%02X", c)
		}
	}
	return nil
}

// SetCurrentBpm は users/{uid} の current_bpm / updated_at を 1Hz 想定で更新する。
//
// `Update` を使い、他のフィールド（プロフィール等が将来書かれた場合）を消さずに
// current_bpm と updated_at だけ差し替える。
// uid が空、または nil レシーバなら no-op。
func (c *RTDBClient) SetCurrentBpm(ctx context.Context, uid string, bpm int) error {
	if c == nil || c.cli == nil || uid == "" {
		return nil
	}
	if err := validateUID(uid); err != nil {
		return fmt.Errorf("invalid uid: %w", err)
	}
	ref := c.cli.NewRef("users/" + uid)
	if err := ref.Update(ctx, map[string]any{
		"current_bpm": bpm,
		"updated_at":  time.Now().UnixMilli(),
	}); err != nil {
		return fmt.Errorf("rtdb set current_bpm: %w", err)
	}
	return nil
}

// AddCommit は commits/{uid} 直下に push-id 付きのコミット結果ドキュメントを追加する。
// uid が空、または nil レシーバなら no-op。
func (c *RTDBClient) AddCommit(ctx context.Context, uid, repoPath, commitHash string, bpm int, result string) error {
	if c == nil || c.cli == nil || uid == "" {
		return nil
	}
	if err := validateUID(uid); err != nil {
		return fmt.Errorf("invalid uid: %w", err)
	}
	ref := c.cli.NewRef("commits/" + uid)
	if _, err := ref.Push(ctx, map[string]any{
		"repo_path":    repoPath,
		"commit_hash":  commitHash,
		"bpm":          bpm,
		"result":       result,
		"attempted_at": time.Now().UnixMilli(),
	}); err != nil {
		return fmt.Errorf("rtdb add commit: %w", err)
	}
	return nil
}
