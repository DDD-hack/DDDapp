package store

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

// OpenFirestore は credentials 未設定なら (nil, nil) を返す（fail-safe）。
// この挙動が崩れると、daemon が起動時にクラッシュしてローカル機能まで道連れになる。
func TestOpenFirestore_NoCredentials_ReturnsNilNil(t *testing.T) {
	t.Parallel()
	cli, err := OpenFirestore(context.Background(), "", "")
	if err != nil {
		t.Fatalf("expected nil error, got %v", err)
	}
	if cli != nil {
		t.Fatalf("expected nil client, got %v", cli)
	}
}

// 指定された credentials ファイルが存在しない場合はエラーを返すが、
// 呼び出し側で warning にできる程度の通常エラーであること（panic しない）。
func TestOpenFirestore_MissingFile_ReturnsError(t *testing.T) {
	t.Parallel()
	missing := filepath.Join(t.TempDir(), "does-not-exist.json")
	cli, err := OpenFirestore(context.Background(), missing, "")
	if err == nil {
		t.Fatal("expected error for missing credentials file, got nil")
	}
	if cli != nil {
		t.Fatalf("expected nil client when error returned, got %v", cli)
	}
}

// nil レシーバでも全メソッドが panic せず no-op で返ることを保証する。
// （Firestore 未設定時に handler 側が if 文を増やさず呼べるようにするため）
func TestFirestoreClient_NilReceiver_IsSafe(t *testing.T) {
	t.Parallel()
	var c *FirestoreClient
	ctx := context.Background()

	if err := c.Close(); err != nil {
		t.Errorf("nil.Close() should be nil, got %v", err)
	}
	if err := c.UpsertUserBpm(ctx, "uid", "name", 120); err != nil {
		t.Errorf("nil.UpsertUserBpm() should be nil, got %v", err)
	}
	if err := c.AddUserCommit(ctx, "uid", "/repo", "hash", 120, "accepted"); err != nil {
		t.Errorf("nil.AddUserCommit() should be nil, got %v", err)
	}
}

func TestExpandHome(t *testing.T) {
	t.Parallel()
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatalf("UserHomeDir: %v", err)
	}

	cases := []struct {
		in   string
		want string
	}{
		{"", ""},
		{"/absolute/path.json", "/absolute/path.json"},
		{"~", home},
		{"~/.ddd/firebase.json", filepath.Join(home, ".ddd", "firebase.json")},
		{"relative/path.json", "relative/path.json"},
	}
	for _, tc := range cases {
		got, err := expandHome(tc.in)
		if err != nil {
			t.Errorf("expandHome(%q) error: %v", tc.in, err)
			continue
		}
		if got != tc.want {
			t.Errorf("expandHome(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}
