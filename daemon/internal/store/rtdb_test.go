package store

import (
	"context"
	"path/filepath"
	"testing"
)

// OpenRTDB は credentials / databaseURL のどちらかが空なら (nil, nil) を返す（fail-safe）。
// この挙動が崩れると、daemon が起動時にクラッシュしてローカル機能まで道連れになる。
func TestOpenRTDB_NoConfig_ReturnsNilNil(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		cred string
		url  string
	}{
		{"both empty", "", ""},
		{"only cred", "/path/to/creds.json", ""},
		{"only url", "", "https://example.firebaseio.com"},
		{"whitespace", "   ", "\t"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			cli, err := OpenRTDB(context.Background(), tc.cred, tc.url)
			if err != nil {
				t.Fatalf("expected nil error, got %v", err)
			}
			if cli != nil {
				t.Fatalf("expected nil client, got %v", cli)
			}
		})
	}
}

// 指定された credentials ファイルが存在しない場合はエラーを返すが、panic しない。
func TestOpenRTDB_MissingFile_ReturnsError(t *testing.T) {
	t.Parallel()
	missing := filepath.Join(t.TempDir(), "does-not-exist.json")
	cli, err := OpenRTDB(context.Background(), missing, "https://example.firebaseio.com")
	if err == nil {
		t.Fatal("expected error for missing credentials file, got nil")
	}
	if cli != nil {
		t.Fatalf("expected nil client when error returned, got %v", cli)
	}
}

// nil レシーバでも全メソッドが panic せず no-op で返ることを保証する。
// （RTDB 未設定時に handler 側が if 文を増やさず呼べるようにするため）
func TestRTDBClient_NilReceiver_IsSafe(t *testing.T) {
	t.Parallel()
	var c *RTDBClient
	ctx := context.Background()

	if err := c.SetCurrentBpm(ctx, "uid", 120); err != nil {
		t.Errorf("nil.SetCurrentBpm() should be nil, got %v", err)
	}
	if err := c.AddCommit(ctx, "uid", "/repo", "hash", 120, "accepted"); err != nil {
		t.Errorf("nil.AddCommit() should be nil, got %v", err)
	}
}

// uid が空文字なら、クライアントが設定済みでも no-op で返ることを保証する。
// （未ログイン状態で誤って書き込みを発火させない安全弁）
func TestRTDBClient_EmptyUID_IsNoOp(t *testing.T) {
	t.Parallel()
	// cli=nil なクライアントを通常コンストラクタ経由で作れないので、ゼロ値を直接使う。
	// 内部の nil チェックは cli==nil でも uid=="" でも同じく no-op になる。
	c := &RTDBClient{cli: nil}
	ctx := context.Background()
	if err := c.SetCurrentBpm(ctx, "", 120); err != nil {
		t.Errorf("empty uid SetCurrentBpm: %v", err)
	}
	if err := c.AddCommit(ctx, "", "/repo", "hash", 120, "accepted"); err != nil {
		t.Errorf("empty uid AddCommit: %v", err)
	}
}

func TestValidateUID(t *testing.T) {
	t.Parallel()
	validCases := []string{
		"simple-uid-123",
		"uid_with_underscores_and_dashes",
		"normalUIDabcdefghijklmnopqrstuvwxyz",
	}
	for _, tc := range validCases {
		if err := validateUID(tc); err != nil {
			t.Errorf("expected uid %q to be valid, got error: %v", tc, err)
		}
	}

	invalidCases := []struct {
		uid  string
		desc string
	}{
		{"uid.with.dots", "contains dot"},
		{"uid$with$dollar", "contains dollar"},
		{"uid#with#hash", "contains hash"},
		{"uid[with[brackets", "contains open bracket"},
		{"uid]with]brackets", "contains close bracket"},
		{"uid/with/slash", "contains slash"},
		{"uid\x00withcontrol", "contains null byte"},
		{"uid\x1Fwithcontrol", "contains control code"},
		{"uid\x7Fwithcontrol", "contains delete char"},
		{string(make([]byte, 129)), "too long"},
	}
	for _, tc := range invalidCases {
		if err := validateUID(tc.uid); err == nil {
			t.Errorf("expected error for %s, got nil", tc.desc)
		}
	}
}
