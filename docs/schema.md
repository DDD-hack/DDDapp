# Firebase Firestore Data Schema Specification

本ドキュメントは、今後実装予定の `[FB-3] Firebase Firestore Sync`（Issue #79）におけるデータスキーマ設計を定義する。
ログインしたユーザーは、このスキーマに従って心拍数およびコミットの履歴データを Firestore に同期する。

> **Issue #78 との関係**: 当初の Issue #78 ではフラットな `/commit_attempts` コレクションを提案していたが、
> 本ドキュメントではユーザー単位のサブコレクション（`users/{uid}/commits`）を採用する。
> 個人スコープの権限制御がセキュリティルール上シンプルになり、ユーザー削除時の連鎖削除も自然に行えるためである。
> チーム全体のランキングは `collectionGroup("commits")` クエリ、または `global_rankings` の集計ドキュメントを用いる
> （後述の集計担当については Cloud Functions 採用時に決定）。

---

## 1. ユーザープロフィールコレクション

ユーザー自身の情報および個別の設定（閾値など）を格納する。

### コレクションパス: `users/{userId}`

- `{userId}`: Firebase Auth で生成される一意のユーザー ID（`uid`）

| フィールド名   | 型          | 説明                                       | 例                                              |
| :------------- | :---------- | :----------------------------------------- | :---------------------------------------------- |
| `displayName`  | `string`    | ユーザーの表示名（Google アカウント等）    | `"山田 太郎"`                                   |
| `email`        | `string`    | メールアドレス                             | `"taro.yamada@example.com"`                     |
| `photoURL`     | `string`    | プロフィール画像 URL                       | `"https://lh3.googleusercontent.com/..."`       |
| `thresholdBpm` | `number`    | ユーザー個別の BPM 閾値設定                | `120`                                           |
| `createdAt`    | `timestamp` | アカウント初回ログイン日時                 | `2026-05-23T04:00:00Z`                          |
| `updatedAt`    | `timestamp` | 最終更新日時                               | `2026-05-23T04:00:00Z`                          |

---

## 2. ユーザーコミット履歴コレクション

ユーザー個人の情熱コミット履歴を格納する。複数デバイスからでも過去履歴をダッシュボードに再現できる。

### コレクションパス: `users/{userId}/commits/{commitId}`

- `{commitId}`: 自動生成されるドキュメント ID、またはコミットハッシュ

| フィールド名  | 型          | 説明                                         | 例                       |
| :------------ | :---------- | :------------------------------------------- | :----------------------- |
| `repoName`    | `string`    | コミット対象のリポジトリ名                   | `"ddd"`                  |
| `repoPath`    | `string`    | ローカルでのリポジトリ絶対パス               | `"/Users/kotaro/ddd"`    |
| `bpm`         | `number`    | コミット時の心拍数（BPM）                    | `132`                    |
| `result`      | `string`    | 判定結果（`"accepted"` / `"rejected"`）       | `"accepted"`             |
| `attemptedAt` | `timestamp` | コミットが試行された日時                     | `2026-05-23T04:15:30Z`   |

> **命名規則メモ**: Firestore は camelCase、ローカル SQLite は snake_case（`attempted_at` 等）を採用する。
> 同期層（daemon → Firestore）で変換を行う。

---

## 3. グローバル共有ランキング（読み取り専用 / 集計データ）

チーム全体やグローバルでのランキングを表示するための集計用データストア。
個人の詳細なリポジトリパスなどは隠蔽し、共有可能なリポジトリ統計情報のみを格納する。

### コレクションパス: `global_rankings/{repoName}`

- `{repoName}`: リポジトリ名

| フィールド名    | 型          | 説明                                       | 例                       |
| :-------------- | :---------- | :----------------------------------------- | :----------------------- |
| `repoName`      | `string`    | リポジトリ名                               | `"ddd"`                  |
| `totalCommits`  | `number`    | 記録された総コミット数                     | `450`                    |
| `accepted`      | `number`    | 情熱コミット成功数                         | `380`                    |
| `rejected`      | `number`    | 情熱不足でブロックされた数                 | `70`                     |
| `avgBpm`        | `number`    | 該当リポジトリの全開発者の平均 BPM         | `134`                    |
| `maxBpm`        | `number`    | 該当リポジトリで記録された最高 BPM         | `189`                    |
| `updatedAt`     | `timestamp` | 統計情報の最終更新日時                     | `2026-05-23T04:30:00Z`   |

> **集計担当の TODO**: 初期実装では Cloud Functions が無いため、本コレクションを使う代わりに
> クライアントから `collectionGroup("commits")` を直接クエリしてランキングを表示する案を採用する。
> Cloud Functions を導入したタイミングで `global_rankings` への定期集計バッチを実装し、
> 読み取りコストを削減する。

---

## セキュリティルール（`firestore.rules`）の設計指針

データの一貫性とセキュリティを確保するため、以下のセキュリティルールを適用する。

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // ユーザー個人のデータ領域
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;

      // コミット履歴
      match /commits/{commitId} {
        allow read, write: if request.auth != null && request.auth.uid == userId;
      }
    }

    // collectionGroup("commits") クエリでチームランキングを取得する場合のルール。
    // 認証済みユーザーには他人の commits も読み取り可とする（ハッカソンの共有スコープ前提）。
    // 本番では「公開可フラグ」「チーム ID」等で絞ること。
    match /{path=**}/commits/{commitId} {
      allow read: if request.auth != null;
    }

    // 集計済みランキング（書き込みは Cloud Functions などサーバー側のみ）
    match /global_rankings/{repoName} {
      allow read: if request.auth != null;
      allow write: if false;
    }
  }
}
```
