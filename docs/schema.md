# Firebase Firestore Data Schema Specification

本ドキュメントは、今後実装予定の `[FB-3] Firebase Firestore Sync` におけるデータスキーマ設計を定義するものです。ログインしたユーザーは、このスキーマに従って心拍数およびコミットの履歴データを Firestore に同期します。

---

## 1. ユーザープロフィールコレクション

ユーザー自身の情報および個別の設定（閾値など）を格納します。

### コレクションパス: `users/{userId}`

- `{userId}`: Firebase Auth で生成される一意のユーザーID (`uid`)

| フィールド名 | 型 | 説明 | 例 |
| :--- | :--- | :--- | :--- |
| `displayName` | `string` | ユーザーの表示名（Googleアカウント等） | `"山田 太郎"` |
| `email` | `string` | メールアドレス | `"taro.yamada@example.com"` |
| `photoURL` | `string` | プロフィール画像 URL | `"https://lh3.googleusercontent.com/...` |
| `thresholdBpm`| `number` | ユーザー個別のBPM閾値設定 | `120` |
| `createdAt` | `timestamp`| アカウント初回ログイン日時 | `2026-05-22T04:00:00Z` |
| `updatedAt` | `timestamp`| 最終更新日時 | `2026-05-22T04:00:00Z` |

---

## 2. ユーザーコミット履歴コレクション

ユーザー個人の情熱コミット履歴を格納します。これにより複数デバイスからでも過去のすべての履歴をダッシュボードに再現可能になります。

### コレクションパス: `users/{userId}/commits/{commitId}`

- `{commitId}`: 自動生成されるドキュメントID、またはコミットハッシュ

| フィールド名 | 型 | 説明 | 例 |
| :--- | :--- | :--- | :--- |
| `repoName` | `string` | コミット対象のリポジトリ名 | `"DDDapp"` |
| `repoPath` | `string` | ローカルでのリポジトリ絶対パス | `"/Users/kotaro/ddd"` |
| `bpm` | `number` | コミット時の心拍数（BPM） | `132` |
| `result` | `string` | 判定結果 (`"accepted"` または `"rejected"`) | `"accepted"` |
| `attemptedAt`| `timestamp`| コミットが試行された日時 | `2026-05-22T04:15:30Z` |

---

## 3. グローバル共有ランキング（読み取り専用 / 集計データ）

チーム全体やグローバルでのランキングを表示するための集計用データストアです。
ユーザー個人の詳細なリポジトリパスなどは隠蔽し、共有可能なリポジトリ統計情報のみを格納します。

### コレクションパス: `global_rankings/{repoName}`

- `{repoName}`: リポジトリ名

| フィールド名 | 型 | 説明 | 例 |
| :--- | :--- | :--- | :--- |
| `repoName` | `string` | リポジトリ名 | `"DDDapp"` |
| `totalCommits`| `number` | 記録された総コミット数 | `450` |
| `accepted` | `number` | 情熱コミット成功数 | `380` |
| `rejected` | `number` | 情熱不足でブロックされた数 | `70` |
| `avgBpm` | `number` | 該当リポジトリの全開発者の平均BPM | `134` |
| `maxBpm` | `number` | 該当リポジトリで記録された最高BPM | `189` |
| `updatedAt` | `timestamp`| 統計情報の最終更新日時 | `2026-05-22T04:30:00Z` |

---

## セキュリティルール（`firestore.rules`）の設計指針

データの一貫性とセキュリティを確保するため、以下のセキュリティルールを適用します。

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
    
    // グローバルランキング（ログイン済みユーザーなら誰でも読めるが、書き込みはバッチまたはサーバー側からのみに制限）
    match /global_rankings/{repoName} {
      allow read: if request.auth != null;
      allow write: if false; // クライアントからの直接書き込みは禁止（Firebase Functionsなどで安全に集計）
    }
  }
}
```
