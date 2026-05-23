# PR Draft — `feature/daemon-rtdb-sync`

ブランチ: `feature/daemon-rtdb-sync`（base: `feature/firestore-sync`）
作成日: 2026-05-23

---

## 📝 コミットメッセージ

```
feat(daemon): BPM・コミット結果を Firebase Realtime Database に送信

Apple Watch の心拍を /users/{uid}/current_bpm に 1Hz で更新し、
git pre-commit hook 経由のコミット結果を /commits/{uid}/{push-id} に
書き込む RTDB 中継パスを実装する。

Firestore は書き込み回数課金（無料枠 50k/day）のため 1Hz BPM では即超過
するが、RTDB は転送量・容量課金で同じワークロードを完全に無料枠内で
さばける。詳細は docs/rtdb-schema.md を参照。

## 主な変更
- store/rtdb.go: RTDB クライアント。OpenRTDB / SetCurrentBpm / AddCommit。
  credentials か DATABASE_URL のどちらかが空なら (nil, nil) を返し、
  全メソッドが nil レシーバ no-op の fail-safe 設計
- handler.go: WriteCurrentBpmToRTDB(bpm) を公開し、main の 1Hz broadcast
  ループから呼ばれる。PostCommit の Firestore 書き込みを RTDB AddCommit
  に置換。WS ハンドラ末尾の per-sample 書き込みは撤去(1Hz ループに集約)
- main.go: DDD_FIREBASE_DATABASE_URL を viper で読み、OpenRTDB を起動時に
  呼ぶ。1Hz ticker から WriteCurrentBpmToRTDB を発火
- docs/rtdb-schema.md: スキーマ仕様、セキュリティルール、命名規則

## 検証
- go build ./... / GOOS=windows go build ./...
- go vet ./...
- go test -race ./...

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

## 📋 PR タイトル

```
feat(daemon): BPM・コミット結果を Firebase Realtime Database に同期
```

---

## 📋 PR 本文

```markdown
## 概要

Apple Watch から受け取った心拍 BPM とコミット結果を、Go daemon が Firebase Realtime Database (RTDB) に直接書き込むようにする。Vercel 等にデプロイされたダッシュボードは、ローカル WebSocket が届かない環境でも RTDB から購読することでリアルタイム表示を継続できる。

> タスク文:
> Go daemon → Firebase Realtime Database に心拍・コミット結果を送信
> 1秒ごとに `/users/{uid}/current_bpm` を更新。
> コミット時に `/commits/{uid}/{id}` に書き込む。

## 設計判断

### なぜ Firestore ではなく RTDB か
| | Firestore | RTDB |
|---|---|---|
| 課金軸 | 書き込み回数(無料枠 50k/day) | 転送量＋容量 |
| 1Hz × 86,400 s/day | 即無料枠超過 | 数バイト×86k で無料枠余裕 |
| レイテンシ | 数百 ms | 数十 ms(常時接続 WS) |

### 主要設計
- **BPM は 1Hz broadcast ループ駆動**: Apple Watch の送信レートではなく `main.go` の 1秒 ticker から `WriteCurrentBpmToRTDB` を呼ぶことで、「1秒ごとに更新」を Apple Watch のスペックに依存せず保証。
- **`/users/{uid}` は Update 書き込み**: `current_bpm` と `updated_at` だけ差し替え、将来プロフィール等が追加されても上書きしない。
- **`/commits/{uid}/{push-id}` は Push 書き込み**: Firebase 自動採番 ID をタスク文の `{id}` として採用。
- **fail-safe**: `DDD_FIREBASE_CREDENTIALS` か `DDD_FIREBASE_DATABASE_URL` が未設定なら `OpenRTDB` が `(nil, nil)` を返し起動継続。全メソッドが nil レシーバ no-op。

## ファイル変更

**daemon (Go)**
- **NEW** `daemon/internal/store/rtdb.go` — `RTDBClient`、`OpenRTDB` / `SetCurrentBpm` / `AddCommit`
- **NEW** `daemon/internal/store/rtdb_test.go` — fail-safe / nil レシーバ / 空 uid のユニットテスト
- **MOD** `daemon/internal/api/handler.go` — `rtdb` フィールド配線、`WriteCurrentBpmToRTDB(bpm)` 公開、`PostCommit` の Firestore 書き込みを RTDB に置換
- **MOD** `daemon/internal/api/handler_test.go` — `NewHandler` の引数追加に追従
- **MOD** `daemon/cmd/ddd/main.go` — RTDB 初期化、1Hz ticker から `WriteCurrentBpmToRTDB` 呼び出し

**設定・ドキュメント**
- **MOD** `.env.example` — `DDD_FIREBASE_DATABASE_URL` セクション追加
- **NEW** `docs/rtdb-schema.md` — RTDB スキーマ仕様(`/users/{uid}` + `/commits/{uid}/{push-id}`)、推奨セキュリティルール、命名規則

## 検証

**自動**
- [x] `go build ./...`
- [x] `GOOS=windows go build ./...`(Pure Go 維持確認)
- [x] `go vet ./...`
- [x] `go test -race ./...`

**手動(要 Firebase 設定)**
1. Firebase Console で Realtime Database を有効化(リージョン選択)
2. サービスアカウント JSON を `~/.ddd/firebase-credentials.json` に配置
3. `.env` に `DDD_FIREBASE_CREDENTIALS` と `DDD_FIREBASE_DATABASE_URL` を設定
4. `mise run daemon:run` → ログに `rtdb: ready` 表示
5. dashboard で Google ログイン → daemon ログに `auth_sync received: uid=...`
6. Apple Watch で BPM 送信 → RTDB Console の `/users/{uid}/current_bpm` が 1秒ごとに点滅更新
7. `git commit` → `/commits/{uid}/<push-id>` にエントリ追加

## 注意

- 本 PR は **`feature/firestore-sync` を基点**としており、Firestore client や `Session` 等のインフラは引き続き残置(呼び出しは削除)。将来「コミット履歴のクエリ可能な永続化」が必要になった時の選択肢として保持。
- ダッシュボード側(`useDaemon` を RTDB `onValue` に差し替え)は **別タスク**。
- セキュリティルールは `docs/rtdb-schema.md` に推奨設定を記載。Firebase Console への適用は手動作業。
- daemon は Firebase Admin SDK + サービスアカウントで書き込むため、セキュリティルールはバイパスされる。クライアント(dashboard)からの読み取りに対してのみルールが効く。

## 関連 Issue

- #79 [FB-3] コミット記録を Firestore に同期 — 設計を Firestore → RTDB に変更したので、本 PR で部分的に着地
- #78 [FB-2] Firestore スキーマ設計 — BPM 系統が RTDB に移ったため、Issue 本文を要更新

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

---

## ⚠️ マージ先について

このブランチは `feature/firestore-sync` から派生しているため、PR の base 選択で挙動が変わる:

| base | 含まれる差分 | 想定する状況 |
|---|---|---|
| **`main`**(推奨) | Firestore 基盤コミット + 今回の RTDB コミット | 一気にマージしたい。dashboard 系のファイル(`useDaemon.ts` 等)で main と衝突するので手動解消が必要 |
| `feature/firestore-sync` | RTDB コミットのみ | feature/firestore-sync を先に main へマージするつもりなら、こちらが綺麗 |

衝突回避の観点では、**feature/firestore-sync のうち RTDB に直接不要な dashboard ファイル変更**(`useDaemon.ts` / `useCommits.ts` / `page.tsx` / `lib/firebase.ts` の Firestore 用変更)を rebase で落として main にぶつけるのが一番すっきりする。
