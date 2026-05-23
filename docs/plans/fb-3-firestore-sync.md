# [FB-3] Firestore Sync 実装計画

**対象 Issue**: #79 [FB-3] コミット記録を Firestore に同期
**ベース**: `implementation_plan.md`（ユーザー提供版）
**作成日**: 2026-05-23

---

## 0. 全体アーキテクチャ

```text
[Apple Watch] ──► [Go daemon (~/.ddd)]
                       │
                       ├─► SQLite (ローカル)
                       ├─► WebSocket ──► [Dashboard (localhost)]
                       │                       │
                       │                       ▼
                       │                  (Google ログイン)
                       │                       │
                       │  ◄── auth_sync({uid,displayName}) ──
                       │
                       └─► Firestore (Google Cloud)
                                  │
                                  ▼ onSnapshot
                          [Dashboard (Vercel)]
                          ※ Mixed Content で daemon に
                            直接届かない時のフォールバック
```

3つの鍵:
1. **UID の橋渡し**: dashboard が Google ログイン後、ローカル WS に `{"type":"auth_sync","uid":...,"displayName":...}` を送る。daemon はメモリに保持。
2. **daemon が書き込み主体**: Apple Watch からの BPM とコミット結果は、UID が分かっている時だけ daemon が Firestore に書き込む。
3. **dashboard のフォールバック**: WS が disconnected の場合、`users/{uid}` を `onSnapshot` で購読してクラウド経由で表示。

---

## 1. ブランチ戦略

- **新規** `feature/firestore-sync` を **`main` から切る**
- 直前の `feature/dashboard-hybrid-auth-ui` には依存しない（UI バッジは「ログイン済み」の表示だけ。FB-3 が無くても破綻しない）
- 並行で進めたいなら hybrid-auth-ui を先にマージ → このブランチを rebase が綺麗

---

## 2. 主要な設計判断（要承認）

| # | 項目 | 採用案 | 代替案 |
|---|------|--------|--------|
| D1 | 環境変数名 | `DDD_FIREBASE_CREDENTIALS`（viper の `DDD_` プレフィックスに揃える）, `DDD_FIREBASE_PROJECT_ID` | プラン記載の `FIREBASE_CONFIG_PATH` |
| D2 | サービスアカウント JSON の置き場所 | デフォルト `~/.ddd/firebase-credentials.json`（SQLite と同じディレクトリ） | repo 直下 `daemon/.firebase-credentials.json`（gitignore） |
| D3 | BPM 書き込みスロットリング | **2 秒に 1 回**最新値で上書き（書き込みコスト抑制） | 都度書き込み、または変化が ±5bpm 以上の時のみ |
| D4 | `auth_sync` 送信元 | **`useDaemon`**（WS のライフサイクルと同じ場所で送る方が自然） | プラン記載の `AuthProvider` |
| D5 | dashboard のフォールバック起動条件 | WS が **3 秒以上 disconnected** かつ user ログイン中 かつ Firestore 設定済み | `disconnected` 即時 / 環境（Vercel）検知ベース |
| D6 | コミット履歴のフォールバック | `useCommits` の初回 fetch が失敗したら user 設定済みなら Firestore へ切替 | 常に Firestore 優先 |

---

## 3. Component A: Go daemon

### A-1. `daemon/go.mod` 依存追加
- `firebase.google.com/go/v4`
- `cloud.google.com/go/firestore`
- `google.golang.org/api/option`

> いずれも Pure Go。`GOOS=windows go build` を CI で確認する。

### A-2. `daemon/internal/store/firebase.go`（新規）
```go
type FirestoreClient struct {
    cli *firestore.Client
}

// OpenFirestore は credentials が無い/読み取り不能なら (nil, nil) を返す（fail-safe）。
// 呼び出し側は nil チェックで分岐する。
func OpenFirestore(ctx context.Context, credentialsPath, projectID string) (*FirestoreClient, error)

func (c *FirestoreClient) UpsertUserBpm(ctx, uid, displayName string, bpm int) error
func (c *FirestoreClient) AddUserCommit(ctx, uid string, repoPath, commitHash string, bpm int, result string) error
func (c *FirestoreClient) Close() error
```

書き込み先:
- `users/{uid}` (merge): `displayName`, `currentBpm`, `bpmUpdatedAt`, `updatedAt`
- `users/{uid}/commits/{auto-id}`: `repoName` (path 末尾)、`repoPath`、`bpm`、`result`、`attemptedAt`

### A-3. `daemon/internal/api/session.go`（新規）
```go
type Session struct {
    mu          sync.RWMutex
    uid         string
    displayName string
    lastBpmAt   time.Time // BPM スロットリング用
}

func (s *Session) SetAuth(uid, displayName string)
func (s *Session) Clear()
func (s *Session) UID() (uid, displayName string, ok bool)
func (s *Session) ShouldWriteBpm(now time.Time) bool // 前回から 2s 経過してれば true
```

### A-4. `daemon/internal/api/handler.go` 修正
- `Handler` に `fs *store.FirestoreClient` と `session *Session` を追加（コンストラクタ引数）
- `VscodeWS` のメッセージループで JSON parse:
  - `{"type":"auth_sync","uid":"...","displayName":"..."}` → `session.SetAuth`
  - `{"type":"auth_sync","uid":""}` → `session.Clear`
- `WS` (iPhone) の BPM 受信ハンドラ末尾:
  - `if fs != nil && session.UID().ok && session.ShouldWriteBpm(now)`:
    - `go fs.UpsertUserBpm(ctx, uid, name, bpm)` （非同期、エラーは log）
- `PostCommit` 末尾:
  - `if fs != nil && session.UID().ok`:
    - `go fs.AddUserCommit(...)`

### A-5. `daemon/cmd/ddd/main.go` 修正
```go
viper.SetDefault("DDD_FIREBASE_CREDENTIALS", "")
viper.SetDefault("DDD_FIREBASE_PROJECT_ID", "")

credPath := viper.GetString("DDD_FIREBASE_CREDENTIALS")
projectID := viper.GetString("DDD_FIREBASE_PROJECT_ID")

fs, err := store.OpenFirestore(ctx, credPath, projectID)
if err != nil {
    log.Printf("firestore disabled: %v", err) // fail-safe: 続行
}
if fs == nil {
    log.Print("firestore disabled: credentials not configured")
}
defer fs.Close() // nil レシーバ安全
```

### A-6. `.env.example`（daemon 用セクション追加）
```properties
# Daemon -> Firestore (オプション)
DDD_FIREBASE_CREDENTIALS=~/.ddd/firebase-credentials.json
DDD_FIREBASE_PROJECT_ID=
```

### A-7. `.gitignore`
- `*firebase-credentials*.json`
- `daemon/.env`

---

## 4. Component B: Dashboard

### B-1. `dashboard/lib/firebase.ts` 拡張
- `import { getFirestore, type Firestore }` 追加
- `export const db: Firestore | null = app ? getFirestore(app) : null;`

### B-2. `dashboard/app/hooks/useDaemon.ts` 修正
- `useAuth()` を読み、WS の `open` ハンドラ内で `{"type":"auth_sync","uid":user.uid,"displayName":user.displayName}` 送信
- ユーザーがログアウト/切り替わったら `auth_sync` 送り直し
- WS が **3 秒以上 disconnected** かつ user/db ある場合 → `onSnapshot(doc(db,"users",uid))` 起動
  - 受信値で `bpm`/`stale` を更新（`bpmUpdatedAt` が現在から 10 秒以上前なら `stale=true`）
  - WS が再接続したら `unsubscribe()` して WS に戻す
- 戻り値の `status` 型に `"cloud"` を追加 → 4状態に拡張

### B-3. `dashboard/app/hooks/useCommits.ts` 修正
- ローカル fetch が成功する間はそのまま
- 失敗時、`user && db` なら `query(collection(db,"users",uid,"commits"), orderBy("attemptedAt","desc"), limit(n))` を `getDocs`
- 受信値を既存の `CommitRecord` 型に変換（フィールド名の snake_case ↔ camelCase 変換層を 1 箇所に閉じる）

### B-4. `dashboard/app/page.tsx`
- `STATUS_LABEL` に `cloud: "☁ CLOUD"` を追加
- `STATUS_COLOR` に `cloud: "text-sky-400"`（既存「ローカル接続」の green と区別）

---

## 5. Component C: ドキュメント

### C-1. `docs/schema.md` 更新
- 既に B-2 で書いた構造を確定。`users/{uid}` の直下フィールドに `currentBpm`/`bpmUpdatedAt` を追記
- 既存の「Issue #78 との関係」セクションで本実装を確定版として位置付け

### C-2. README または `docs/setup-firestore.md`（新規・任意）
- Firebase コンソールでの service account JSON 取得手順
- daemon 環境変数の設定例
- 初回の Firestore セキュリティルールデプロイ手順

---

## 6. 検証計画

### 自動
- `cd daemon && go build ./...`
- `cd daemon && GOOS=windows go build ./...` （Windows クロスビルド確認）
- `cd daemon && go test -race ./...`
  - 追加テスト: `OpenFirestore("", "")` で `(nil, nil)` を返すこと
  - `Session` の並行 set/get テスト
- `cd dashboard && npx tsc --noEmit && npm run lint`

### 手動
1. daemon に `DDD_FIREBASE_CREDENTIALS` を設定して起動 → ログに `firestore: ready` 表示
2. ダッシュボード（localhost）で Google ログイン → daemon ログに `auth_sync received: uid=...`
3. Apple Watch / 手動 WS で BPM 送信 → Firestore Console で `users/{uid}.currentBpm` が更新
4. `git commit` → `users/{uid}/commits` にドキュメント追加
5. daemon を停止 → 3 秒後にダッシュボードが `☁ CLOUD` ステータスに切り替わり、Firestore からの値で表示継続
6. daemon を再起動 → WS 再接続で `● LIVE` に戻る

---

## 7. リスクと留意点

| リスク | 対策 |
|--------|------|
| Firestore Admin SDK がイレギュラーなビルドエラー | 早期に `go mod tidy` + Windows クロスビルドで検証 |
| 単一 UID 想定（dashboard を複数ブラウザで開いた時に最後勝ち） | 仕様として明記。ハッカソン用途で許容 |
| BPM 書き込みコスト（1日数千書き込み） | 2秒スロットル + Firestore 無料枠（50k writes/day）で収まる試算 |
| onSnapshot のリスナーリーク | useDaemon の cleanup で確実に `unsubscribe()` を呼ぶ |
| 認証情報の誤コミット | `.gitignore` + `pre-commit` で `firebase-credentials*` を弾く（既存 hook を拡張） |

---

## 8. 実装順（PR 内コミット分割案）

1. `daemon`: firebase.go + session.go + テスト（**Firestore 接続なしでビルド/テスト pass**まで）
2. `daemon`: handler.go / main.go から呼び出し配線
3. `dashboard`: firebase.ts に Firestore 追加、useDaemon に auth_sync 送信
4. `dashboard`: useDaemon の onSnapshot フォールバック
5. `dashboard`: useCommits の Firestore フォールバック
6. `dashboard`: page.tsx の `cloud` ステータス表示
7. docs/schema.md 更新
8. `.env.example` / `.gitignore` 更新

各ステップで `tsc` / `lint` / `go build` を回す。
