# CLAUDE.md — Doki Doki Development (DDD)

## プロジェクト概要

心拍数が 120 bpm を超えていないと `git commit` できない開発環境。
ハッカソン向けジョークプロダクト。

```
Apple Watch → iPhone (Swift/HealthKit)
  → WebSocket POST → Go daemon (localhost:8765)
  → GET /heartrate/current → git pre-commit hook (Go binary)
  → 120 bpm 超: commit 許可 / 以下: commit 拒否
```

---

## ディレクトリ構成

```
daemon/          # Go デーモン（メイン実装）
  cmd/ddd/       # エントリーポイント（main.go）
  internal/api/  # HTTP / WebSocket ハンドラ
  internal/hrm/  # 心拍バッファ管理（10秒ウィンドウ・平均計算）
  internal/store/# SQLite 保存（modernc.org/sqlite）
hooks/           # git pre-commit hook（Go binary）
companion/       # Swift iOS アプリ（F001 担当者が実装）
scripts/         # セットアップスクリプト
tasks/           # mise タスク定義
```

---

## 技術スタック・主要ライブラリ

| 用途 | ライブラリ |
|------|-----------|
| HTTP / WebSocket サーバー | github.com/labstack/echo/v4 |
| WebSocket | gorilla/websocket または echo 組み込み |
| 設定管理 | github.com/spf13/viper |
| SQLite | modernc.org/sqlite（Pure Go・CGO不要） |

### modernc.org/sqlite を使う理由
`mattn/go-sqlite3` は CGO が必要で Windows クロスビルドができない。
`modernc.org/sqlite` は Pure Go のため `GOOS=windows` でそのままビルドできる。

---

## 環境変数

```
DDD_DAEMON_PORT   = 8765   # デーモンの待受ポート
DDD_THRESHOLD_BPM = 120    # コミット許可の閾値（超えた場合のみ許可）
```

---

## API 仕様

### WebSocket — iPhone → daemon
```
ws://localhost:8765/ws

受信フォーマット:
{ "bpm": 152, "timestamp": "2025-05-19T10:00:00Z" }
```

### GET /heartrate/current — git hook → daemon
```json
// 正常（10秒以内にサンプルあり）
{ "bpm": 152, "status": "ok" }

// stale（10秒以上サンプルなし）
{ "bpm": 0, "status": "stale" }
```

### GET /health
```json
{ "status": "ok" }
```

### 異常系ルール（hook 側の挙動）

| 状態 | hook の挙動 |
|------|------------|
| daemon 未起動 | exit 0 + 警告メッセージ |
| タイムアウト（3秒超） | exit 0 + 警告メッセージ |
| stale | exit 0 + 警告メッセージ |
| bpm ≤ 120 | exit 1（コミット拒否） |
| bpm > 120 | exit 0（コミット許可） |

---

## Go コーディング規約

- `gofmt` でフォーマット（PR前に必ず実行）
- エラーは必ず返す。`log.Fatal` はエントリーポイント（main.go）のみ
- OS依存パスは `os.UserHomeDir()` を使う（`~` は Windows で動かない）
- 並列アクセスは `sync.Mutex` でロック
- パス操作は `filepath` パッケージを使う（`/` と `\` の差異を吸収）
- WebSocket のコネクション管理は goroutine + channel または mutex で安全に

---

## SQLite スキーマ

```sql
CREATE TABLE heart_rate_samples (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  bpm         INTEGER NOT NULL,
  recorded_at DATETIME NOT NULL,
  source      TEXT NOT NULL
);

CREATE TABLE commit_attempts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_path     TEXT NOT NULL,
  commit_hash   TEXT,
  bpm_at_commit INTEGER NOT NULL,
  result        TEXT NOT NULL,  -- 'accepted' | 'rejected'
  attempted_at  DATETIME NOT NULL
);
```

---

## コードレビューチェックリスト

### 全般
- [ ] `gofmt` が通っているか
- [ ] `go vet ./...` でエラーが出ていないか
- [ ] `go test -race ./...` が PASS しているか
- [ ] エラーが握りつぶされていないか（`_ = err` は原則禁止）
- [ ] `log.Fatal` が main.go 以外で使われていないか

### 並行処理
- [ ] 複数 goroutine からアクセスするデータに `sync.Mutex` があるか
- [ ] WebSocket コネクションのライフサイクルが適切に管理されているか
- [ ] goroutine リークがないか（defer で close しているか）

### パス・OS対応
- [ ] `~` を使わず `os.UserHomeDir()` を使っているか
- [ ] パス結合に `filepath.Join()` を使っているか
- [ ] `GOOS=windows go build` が通るか（CGO を使っていないか）

### API・WebSocket
- [ ] レスポンスの JSON フォーマットが仕様通りか
- [ ] stale 判定（10秒）が正しいか
- [ ] daemon 未起動・タイムアウト時に exit 0 になっているか（exit 1 にしない）

### SQLite（modernc.org/sqlite）
- [ ] `mattn/go-sqlite3` を使っていないか（CGO が入るので NG）
- [ ] DB 初期化時に `CREATE TABLE IF NOT EXISTS` を使っているか
- [ ] DB ファイルのパスに `os.UserHomeDir()` を使っているか
- [ ] トランザクションが必要な箇所で使われているか

### デモ演出
- [ ] 拒否メッセージが仕様の文言通りか
- [ ] ANSI カラーコードが使われているか（拒否: 赤 `\033[31m`、許可: 緑 `\033[32m`）
- [ ] Windows の cmd.exe で文字化けしないか（UTF-8 前提）

---

## mise タスク

```bash
mise run daemon:run    # デーモン起動
mise run daemon:test   # go test -race ./...
mise run hooks:install # .git/hooks/pre-commit にバイナリを配置
```

---

## よくある間違い

**× やってはいけない**
```go
// パスに ~ を使う（Windows で動かない）
path := "~/.ddd/ddd.db"

// CGO が必要なライブラリ（クロスビルド不可）
import _ "github.com/mattn/go-sqlite3"

// エラーの握りつぶし
conn, _ := db.Open(...)

// log.Fatal を main 以外で使う
log.Fatal("something went wrong")
```

**○ 正しい書き方**
```go
// os.UserHomeDir() でパスを解決
home, err := os.UserHomeDir()
if err != nil {
    return fmt.Errorf("get home dir: %w", err)
}
path := filepath.Join(home, ".ddd", "ddd.db")

// Pure Go SQLite
import _ "modernc.org/sqlite"

// エラーを必ず返す
conn, err := db.Open(...)
if err != nil {
    return fmt.Errorf("open db: %w", err)
}
```
