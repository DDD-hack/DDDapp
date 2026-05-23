# Firebase Realtime Database Schema (Daemon Side)

本ドキュメントは Go daemon が書き込む **Firebase Realtime Database (RTDB)** のスキーマを定義する。
ハイブリッド設計の高頻度側（BPM 1Hz、コミット結果）を担当する。

> **なぜ RTDB か**: Firestore は書き込み回数課金（無料枠 50k/day）のため、1Hz BPM × 86,400s/day = 即超過する。
> RTDB は転送量＋容量課金で、数バイトの BPM ペイロードを 1Hz 送信しても無料枠（10GB/月）に余裕がある。
> また persistent WebSocket でミリ秒オーダーのリアルタイム配信ができるため、BPM ゲージ用途に最適。

---

## トップレベル構造

```
{
  "users": {
    "{uid}": {
      "current_bpm": 142,
      "updated_at":  1716480000000
    }
  },
  "commits": {
    "{uid}": {
      "{push-id}": {
        "repo_path":    "/Users/kotaro/ddd",
        "commit_hash":  "abc1234",
        "bpm":          142,
        "result":       "accepted",
        "attempted_at": 1716480005000
      }
    }
  }
}
```

`commits` は `users` のサブツリーではなくトップレベルに分離している。
コミット履歴は付加情報なので、ユーザー文書から読み書きを切り離すことで、
ダッシュボード側で `users/{uid}` を購読する際に履歴全部を巻き込まずに済む。

---

## 1. `/users/{uid}` — リアルタイム BPM

daemon の 1Hz broadcast ループから `Update` で書き込む（他フィールドを保持するため `Set` ではなく `Update`）。

| フィールド名   | 型     | 説明                                                      |
| :------------- | :----- | :-------------------------------------------------------- |
| `current_bpm`  | number | 直近 10 秒平均の BPM（`hrm.Buffer.Average()`）            |
| `updated_at`   | number | Unix ミリ秒。10 秒以上前なら dashboard 側で stale 表示    |

書き込み頻度は **1Hz** 固定（`main.go` の `time.NewTicker(1s)` で駆動）。

---

## 2. `/commits/{uid}/{push-id}` — コミット履歴

daemon の `POST /commits` ハンドラから `Push` で書き込む。`push-id` は Firebase 自動生成。

| フィールド名    | 型     | 説明                                                |
| :-------------- | :----- | :-------------------------------------------------- |
| `repo_path`     | string | ローカルでのリポジトリ絶対パス                      |
| `commit_hash`   | string | コミットハッシュ（空文字あり）                      |
| `bpm`           | number | コミット時の心拍数                                  |
| `result`        | string | `"accepted"` または `"rejected"`                    |
| `attempted_at`  | number | Unix ミリ秒                                         |

書き込みはコミットイベントごと（低頻度・スロットルなし）。

---

## 書き込み権限と認証

daemon は **Firebase Admin SDK + サービスアカウント JSON** で書き込む。Admin SDK は
セキュリティルールをバイパスするため、本実装では daemon → RTDB の書き込みはルール対象外。

ダッシュボード（クライアント SDK）からの読み取りは認証必須。推奨セキュリティルール:

```json
{
  "rules": {
    "users": {
      "$uid": {
        ".read":  "auth != null",
        ".write": "auth != null && auth.uid === $uid"
      }
    },
    "commits": {
      "$uid": {
        ".read":  "auth != null",
        ".write": "auth != null && auth.uid === $uid"
      }
    }
  }
}
```

ハッカソンのチーム共有スコープ前提で、`.read` は認証済みなら他人のデータも読めるようにしている。
本番運用では「公開可フラグ」「チーム ID」等で絞ること。
クライアント側の `.write` は本人のみだが、daemon は Admin SDK なので影響なし。

---

## 命名規則

| 場所            | 命名規則  | 例                              |
| :-------------- | :-------- | :------------------------------ |
| RTDB（本ドキュメント） | snake_case | `current_bpm`, `attempted_at` |
| Firestore        | camelCase | （未使用。`docs/schema.md` 参照） |
| SQLite           | snake_case | `bpm_at_commit`, `recorded_at` |

RTDB は SQLite と同じ snake_case で揃え、daemon 側の変換コストを最小化している。

---

## 設定

daemon に以下の環境変数を設定する:

```bash
DDD_FIREBASE_CREDENTIALS=~/.ddd/firebase-credentials.json
DDD_FIREBASE_DATABASE_URL=https://<project-id>-default-rtdb.firebaseio.com/
```

どちらかが空なら RTDB 同期はサイレントに無効化される（fail-safe）。
