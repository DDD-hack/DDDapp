package store

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"
)

const schema = `
CREATE TABLE IF NOT EXISTS heart_rate_samples (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  bpm         INTEGER  NOT NULL,
  recorded_at DATETIME NOT NULL,
  source      TEXT     NOT NULL
);

CREATE TABLE IF NOT EXISTS commit_attempts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_path     TEXT     NOT NULL,
  commit_hash   TEXT,
  bpm_at_commit INTEGER  NOT NULL,
  result        TEXT     NOT NULL,
  attempted_at  DATETIME NOT NULL
);
`

type Store struct {
	db *sql.DB
}

func Open() (*Store, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, fmt.Errorf("get home dir: %w", err)
	}
	return OpenAt(filepath.Join(home, ".ddd"))
}

// OpenAt opens (or creates) a Store rooted at dir. Exposed for tests.
func OpenAt(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("create dir %s: %w", dir, err)
	}

	dbPath := filepath.Join(dir, "ddd.db")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}
	db.SetMaxOpenConns(1)

	if _, err := db.Exec(schema); err != nil {
		if cerr := db.Close(); cerr != nil {
			return nil, fmt.Errorf("init schema: %w; close db: %v", err, cerr)
		}
		return nil, fmt.Errorf("init schema: %w", err)
	}

	return &Store{db: db}, nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

func (s *Store) SaveSample(ctx context.Context, bpm int, source string) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO heart_rate_samples (bpm, recorded_at, source) VALUES (?, ?, ?)`,
		bpm, time.Now().UTC(), source,
	)
	if err != nil {
		return fmt.Errorf("save sample: %w", err)
	}
	return nil
}

func (s *Store) SaveCommitAttempt(ctx context.Context, repoPath, commitHash string, bpm int, result string) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO commit_attempts (repo_path, commit_hash, bpm_at_commit, result, attempted_at) VALUES (?, ?, ?, ?, ?)`,
		repoPath, commitHash, bpm, result, time.Now().UTC(),
	)
	if err != nil {
		return fmt.Errorf("save commit attempt: %w", err)
	}
	return nil
}

// CommitAttempt is a read model for the commit_attempts table.
type CommitAttempt struct {
	ID          int64     `json:"id"`
	RepoPath    string    `json:"repo_path"`
	CommitHash  string    `json:"commit_hash"`
	BPM         int       `json:"bpm"`
	Result      string    `json:"result"`
	AttemptedAt time.Time `json:"attempted_at"`
}

// HeartRateSample is a read model for the heart_rate_samples table.
type HeartRateSample struct {
	ID         int64     `json:"id"`
	BPM        int       `json:"bpm"`
	RecordedAt time.Time `json:"recorded_at"`
	Source     string    `json:"source"`
}

// GetCommitAttempts returns the most recent commit attempts, newest first.
func (s *Store) GetCommitAttempts(ctx context.Context, limit int) ([]CommitAttempt, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, repo_path, COALESCE(commit_hash, ''), bpm_at_commit, result, attempted_at
		 FROM commit_attempts ORDER BY attempted_at DESC LIMIT ?`, limit)
	if err != nil {
		return nil, fmt.Errorf("get commit attempts: %w", err)
	}
	defer rows.Close()

	var out []CommitAttempt
	for rows.Next() {
		var r CommitAttempt
		if err := rows.Scan(&r.ID, &r.RepoPath, &r.CommitHash, &r.BPM, &r.Result, &r.AttemptedAt); err != nil {
			return nil, fmt.Errorf("scan commit attempt: %w", err)
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// GetHeartRateSamples returns the most recent heart rate samples, newest first.
func (s *Store) GetHeartRateSamples(ctx context.Context, limit int) ([]HeartRateSample, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, bpm, recorded_at, source
		 FROM heart_rate_samples ORDER BY recorded_at DESC LIMIT ?`, limit)
	if err != nil {
		return nil, fmt.Errorf("get heart rate samples: %w", err)
	}
	defer rows.Close()

	var out []HeartRateSample
	for rows.Next() {
		var r HeartRateSample
		if err := rows.Scan(&r.ID, &r.BPM, &r.RecordedAt, &r.Source); err != nil {
			return nil, fmt.Errorf("scan heart rate sample: %w", err)
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
