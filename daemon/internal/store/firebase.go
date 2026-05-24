package store

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"cloud.google.com/go/firestore"
	firebase "firebase.google.com/go/v4"
	"google.golang.org/api/option"
)

// FirestoreClient は DDD 用に Firestore へユーザー/コミットを書き込むラッパー。
//
// 認証情報が未設定の場合、本クライアントの値そのものを nil として扱う。
// 全メソッドは nil レシーバを許容する（呼び出し側の nil チェックを減らすため）。
type FirestoreClient struct {
	cli *firestore.Client
}

// OpenFirestore は Firestore クライアントを開く。
//
// fail-safe 設計:
//   - credentialsPath が空 → (nil, nil) を返す（Firestore 同期を「サイレントに無効化」）。
//   - credentialsPath で指定されたファイルが存在しない → エラーを返すが、呼び出し側で
//     warning にして起動を継続することを想定する。
//
// projectID が空でも、credentials JSON 側の project_id が使われる。
func OpenFirestore(ctx context.Context, credentialsPath, projectID string) (*FirestoreClient, error) {
	if strings.TrimSpace(credentialsPath) == "" {
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

	conf := &firebase.Config{}
	if projectID != "" {
		conf.ProjectID = projectID
	}
	app, err := firebase.NewApp(ctx, conf, option.WithCredentialsFile(expanded))
	if err != nil {
		return nil, fmt.Errorf("firebase init: %w", err)
	}
	cli, err := app.Firestore(ctx)
	if err != nil {
		return nil, fmt.Errorf("firestore init: %w", err)
	}
	return &FirestoreClient{cli: cli}, nil
}

// Close は nil レシーバでも安全に呼べる。
func (c *FirestoreClient) Close() error {
	if c == nil || c.cli == nil {
		return nil
	}
	return c.cli.Close()
}

// UpsertUserBpm は users/{uid} ドキュメントを merge で更新する。
// uid が空、または nil レシーバなら何もしない。
func (c *FirestoreClient) UpsertUserBpm(ctx context.Context, uid, displayName string, bpm int) error {
	if c == nil || c.cli == nil || uid == "" {
		return nil
	}
	now := time.Now().UTC()
	payload := map[string]any{
		"currentBpm":   bpm,
		"bpmUpdatedAt": now,
		"updatedAt":    now,
	}
	if displayName != "" {
		payload["displayName"] = displayName
	}
	if _, err := c.cli.Collection("users").Doc(uid).Set(ctx, payload, firestore.MergeAll); err != nil {
		return fmt.Errorf("upsert user bpm: %w", err)
	}
	return nil
}

// AddUserCommit は users/{uid}/commits に新規ドキュメントを追加する。
// uid が空、または nil レシーバなら何もしない。
//
// プライバシー設計:
//   - repoPath（絶対パス）は Firestore に送信しない。
//   - 代わりに SHA-256(repoPath) の先頭 8 文字を repoKeyHash として保存する。
//   - isPublic はデフォルト false。collectionGroup での他ユーザーへの公開は
//     将来的にユーザーが明示的に true に変更した場合のみ許可する。
func (c *FirestoreClient) AddUserCommit(ctx context.Context, uid, repoPath, commitHash string, bpm int, result string) error {
	if c == nil || c.cli == nil || uid == "" {
		return nil
	}
	sum := sha256.Sum256([]byte(repoPath))
	repoKeyHash := hex.EncodeToString(sum[:])[:8]

	doc := map[string]any{
		"repoName":    filepath.Base(repoPath),
		"repoKeyHash": repoKeyHash,
		"commitHash":  commitHash,
		"bpm":         bpm,
		"result":      result,
		"isPublic":    false,
		"attemptedAt": time.Now().UTC(),
	}
	if _, _, err := c.cli.Collection("users").Doc(uid).Collection("commits").Add(ctx, doc); err != nil {
		return fmt.Errorf("add user commit: %w", err)
	}
	return nil
}

// expandHome は先頭の "~" をユーザーホームに展開する。
// Windows でも UserHomeDir が正しく動くため安全。
func expandHome(path string) (string, error) {
	if path == "" || !strings.HasPrefix(path, "~") {
		return path, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("get home dir: %w", err)
	}
	// "~" -> $HOME, "~/foo" -> $HOME/foo
	if path == "~" {
		return home, nil
	}
	return filepath.Join(home, path[2:]), nil
}
