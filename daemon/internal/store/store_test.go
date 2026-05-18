package store

import (
	"context"
	"path/filepath"
	"testing"
)

func openTestStore(t *testing.T) *Store {
	t.Helper()
	s, err := OpenAt(t.TempDir())
	if err != nil {
		t.Fatalf("OpenAt: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func TestOpenAt_AutoCreatesNestedDir(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "nested", "path")
	s, err := OpenAt(dir)
	if err != nil {
		t.Fatalf("OpenAt nested dir: %v", err)
	}
	_ = s.Close()
}

func TestSaveSample(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()

	if err := s.SaveSample(ctx, 150, "apple_watch"); err != nil {
		t.Fatalf("SaveSample: %v", err)
	}

	var count int
	if err := s.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM heart_rate_samples").Scan(&count); err != nil {
		t.Fatalf("query: %v", err)
	}
	if count != 1 {
		t.Fatalf("want 1 row, got %d", count)
	}
}

func TestSaveSample_MultipleRows(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()

	for _, bpm := range []int{100, 120, 140} {
		if err := s.SaveSample(ctx, bpm, "apple_watch"); err != nil {
			t.Fatalf("SaveSample(%d): %v", bpm, err)
		}
	}

	var count int
	if err := s.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM heart_rate_samples").Scan(&count); err != nil {
		t.Fatalf("query: %v", err)
	}
	if count != 3 {
		t.Fatalf("want 3 rows, got %d", count)
	}
}

func TestSaveCommitAttempt_Accepted(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()

	if err := s.SaveCommitAttempt(ctx, "/repo/path", "abc1234", 150, "accepted"); err != nil {
		t.Fatalf("SaveCommitAttempt: %v", err)
	}

	var result string
	var bpm int
	if err := s.db.QueryRowContext(ctx,
		"SELECT result, bpm_at_commit FROM commit_attempts",
	).Scan(&result, &bpm); err != nil {
		t.Fatalf("query: %v", err)
	}
	if result != "accepted" {
		t.Fatalf("want result=accepted, got %s", result)
	}
	if bpm != 150 {
		t.Fatalf("want bpm=150, got %d", bpm)
	}
}

func TestSaveCommitAttempt_Rejected(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()

	if err := s.SaveCommitAttempt(ctx, "/repo/path", "def5678", 80, "rejected"); err != nil {
		t.Fatalf("SaveCommitAttempt rejected: %v", err)
	}

	var result string
	if err := s.db.QueryRowContext(ctx,
		"SELECT result FROM commit_attempts",
	).Scan(&result); err != nil {
		t.Fatalf("query: %v", err)
	}
	if result != "rejected" {
		t.Fatalf("want result=rejected, got %s", result)
	}
}

func TestSaveCommitAttempt_EmptyHash(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()

	// commit_hash は NULL 許容
	if err := s.SaveCommitAttempt(ctx, "/repo", "", 100, "rejected"); err != nil {
		t.Fatalf("SaveCommitAttempt with empty hash: %v", err)
	}
}
