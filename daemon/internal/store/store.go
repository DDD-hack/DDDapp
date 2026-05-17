package store

import (
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

	dir := filepath.Join(home, ".ddd")
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
		db.Close()
		return nil, fmt.Errorf("init schema: %w", err)
	}

	return &Store{db: db}, nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

func (s *Store) SaveSample(bpm int, source string) error {
	_, err := s.db.Exec(
		`INSERT INTO heart_rate_samples (bpm, recorded_at, source) VALUES (?, ?, ?)`,
		bpm, time.Now().UTC(), source,
	)
	if err != nil {
		return fmt.Errorf("save sample: %w", err)
	}
	return nil
}

func (s *Store) SaveCommitAttempt(repoPath, commitHash string, bpm int, result string) error {
	_, err := s.db.Exec(
		`INSERT INTO commit_attempts (repo_path, commit_hash, bpm_at_commit, result, attempted_at) VALUES (?, ?, ?, ?, ?)`,
		repoPath, commitHash, bpm, result, time.Now().UTC(),
	)
	if err != nil {
		return fmt.Errorf("save commit attempt: %w", err)
	}
	return nil
}
