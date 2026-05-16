# Doki Doki Development (DDD) 技術選定書

> 心拍数駆動コミットゲートシステムの技術アーキテクチャと選定根拠

---

# 0. ドキュメントの目的

本書は DDD の実装にあたり、各レイヤーで採用する技術スタックの選定根拠を示すものである。

ハッカソン MVP（2週間程度）での実装完遂を前提に、以下の三軸で評価する。

- 実装可能性
- デモ映え
- 拡張性

---

# 1. システム全体構成

## 1.1 アーキテクチャ図

```txt
【画像挿入位置】architecture.svg または architecture.png
```

本システムは以下の3レイヤー構成で動作する。

### L1 物理レイヤー

Apple Watch がリストで心拍を計測し、BLE 経由で iPhone Companion App に転送する。  
iPhone はその値を WebSocket でローカルマシンへ送る。

### L2 ローカルマシン

Go 製の DDD Daemon が中核。

以下の3モジュールで構成される。

- HRM 受信モジュール
- SQLite ストア
- HTTP / WebSocket API サーバー

また、以下2つのコンシューマへ心拍データを供給する。

- git pre-commit hook
- VS Code 拡張

### L3 クラウド / GitHub

git push 時に GitHub Actions が起動し、PR 心拍グラフを自動生成する。

Next.js 製ダッシュボードを Vercel にホストし、Firebase Auth / Firestore によりランキング機能を提供する。

---

## 1.2 データフロー

```txt
【画像挿入位置】dataflow.svg または dataflow.png
```

10ステップで「心拍計測 → コミット判定 → GitHub への push」までの全シーケンスを表現する。

| # | 主体 | アクション | 通信 | 頻度 |
|---|---|---|---|---|
| 1 | Apple Watch → iPhone | 心拍計測 | BLE / HealthKit | 1 Hz |
| 2 | iPhone → Daemon | WebSocket 送信 | WS | 1 Hz |
| 3 | Daemon | SQLite 永続化 | ローカル | 1 Hz |
| 4 | Developer | git commit 実行 | - | 任意 |
| 5 | git hook → Daemon | 直近10秒の平均を問合せ | HTTP localhost | コミット時 |
| 6 | Daemon → git hook | 平均 bpm を返却 | HTTP | コミット時 |
| 7 | git hook | 閾値判定 (bpm > 120 ?) | - | コミット時 |
| 8 | git hook → Developer | ACCEPT または REJECT | exit 0/1 | コミット時 |
| 9 | Developer → GitHub | git push | HTTPS | push 時 |
| 10 | GitHub Actions | PR 心拍グラフ自動添付 | - | push 時 |

---

# 2. レイヤー別技術選定

## 2.1 心拍計測デバイス

### 採用

- Apple Watch Series 6 以降

### 選定理由

- HealthKit API が成熟している
- 心拍取得頻度が高い（運動中は1秒間隔）
- デモ映えする
- iPhone 連携前提で開発しやすい

### 懸念点

- iPhone 必須
- 実機必須

### 代替案

| デバイス | API | 採用しなかった理由 |
|---|---|---|
| Fitbit | Web API | 数分単位の遅延 |
| Garmin | Connect IQ SDK | 学習コスト |
| Polar H10 | Web Bluetooth | デモ映え不足 |
| WHOOP | 公式 API なし | リスク大 |

---

## 2.2 iPhone Companion App

### 採用

- Swift
- SwiftUI
- HealthKit

### 選定理由

- HealthKit は Swift が最適
- HKAnchoredObjectQuery が使える
- SwiftUI で UI 実装が高速

### 代替案

| 選択肢 | 理由 |
|---|---|
| Flutter + health | リアルタイム性不足 |
| React Native | ブリッジ実装コスト |

> Flutter で書きたい気持ちは強いが、Apple Watch 連携は Swift ネイティブが王道。

---

## 2.3 ローカルデーモン（コアサーバー）

### 採用

- Go
- Echo Framework

### 選定理由

- 単一バイナリ配布
- 常駐安定性
- WebSocket / HTTP / SQLite 対応
- 既存スキル活用

### 役割

- 心拍データ受信
- SQLite 保存
- HTTP API 提供
- VS Code 拡張向け WS 配信

### 代替案

| 選択肢 | 理由 |
|---|---|
| Rust (axum) | 開発速度 |
| Node.js | 型安全性不足 |
| FastAPI | 起動コスト |

---

## 2.4 ローカルデータストア

### 採用

- SQLite

### 選定理由

- 軽量
- 単一ユーザー向け
- デバッグ容易

### スキーマ案

```sql
CREATE TABLE heart_rate_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bpm INTEGER NOT NULL,
  recorded_at DATETIME NOT NULL,
  source TEXT NOT NULL
);

CREATE INDEX idx_recorded_at
ON heart_rate_samples(recorded_at);

CREATE TABLE commit_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_path TEXT NOT NULL,
  commit_hash TEXT,
  bpm_at_commit INTEGER NOT NULL,
  result TEXT NOT NULL,
  attempted_at DATETIME NOT NULL
);
```

---

## 2.5 Git Hook

### 採用

- Go 製独立バイナリ `ddd-hook`

### 選定理由

- クロスプラットフォーム対応
- Go で統一
- 単一バイナリ配布
- jq 不要
- testing パッケージでテスト可能

### 配布形態

- `dddd`
- `ddd-hook`

を別バイナリとして配布。

### fail-open ポリシー

Daemon が落ちていても commit は通す。

理由:

- 開発体験を壊さない
- ジョークがバグ体験にならない
- 離脱防止

---

## 2.6 VS Code 拡張

### 採用

- TypeScript
- VS Code Extension API

### 機能

- `❤ 87 bpm` 表示
- 情熱モード
- コミット拒否トースト

---

## 2.7 PR 心拍グラフ自動生成

### 採用

- GitHub Actions
- Chart.js
- Node.js

### 処理フロー

1. pull_request イベントで起動
2. git log から trailer 抽出
3. Chart.js でグラフ生成
4. PR に画像添付

---

## 2.8 ダッシュボード

### 採用

- Next.js
- Recharts
- Tailwind CSS
- Vercel
- Firestore

### 選定理由

- React のグラフ資産が強い
- デモ映え
- SSR / リアルタイム両対応
- Vercel デプロイが高速

### 画面構成

| パス | 内容 |
|---|---|
| `/` | 心拍推移 |
| `/despair` | 絶望度メーター |
| `/ranking` | 情熱ランキング |
| `/u/[userId]` | 個人プロフィール |

### 技術スタック

| 要素 | 技術 |
|---|---|
| Framework | Next.js 15 |
| Language | TypeScript |
| Graph | Recharts |
| Style | Tailwind CSS |
| Auth | Firebase Auth |
| DB | Firestore |
| Hosting | Vercel |

---

## 2.9 認証・バックエンド

### 採用

- Firebase Authentication
- Firestore

### 選定理由

- 実装速度
- 無料枠
- ランキング機能に必要

### プライバシー対策

デフォルトはローカル保存のみ。  
ランキング参加時のみ平均値を送信。

---

# 3. 技術スタック構成図

```txt
【画像挿入位置】techstack.svg または techstack.png
```

| レイヤー | 役割 | 主要技術 |
|---|---|---|
| L1 Hardware | 物理デバイス | Apple Watch / iPhone |
| L2 Client | アプリ・拡張 | SwiftUI / VS Code |
| L3 Core | ローカルランタイム | Go / SQLite |
| L4 Tooling | 開発支援 | Git / Homebrew |
| L5 Cloud | 公開面 | Next.js / Firebase |

---

# 4. 開発スケジュール（2週間）

| 週 | 日 | タスク |
|---|---|---|
| 1 | 1-2 | 心拍取得 |
| 1 | 3-4 | Go Daemon |
| 1 | 5 | git hook |
| 1 | 6-7 | 演出強化 |
| 2 | 8-9 | VS Code 拡張 |
| 2 | 10-11 | ダッシュボード |
| 2 | 12 | GitHub Actions |
| 2 | 13 | デモリハ |
| 2 | 14 | バグ修正 |

---

# 5. リスクと対策

| リスク | 影響度 | 対策 |
|---|---|---|
| Watch 接続切れ | 高 | ホットスポット運用 |
| Background 停止 | 高 | App 常時起動 |
| 階段ダッシュ事故 | 中 | 動線確認 |
| 心拍が上がらない | 中 | デモモード |
| 実機不足 | 中 | 借用前提 |
| 実用性を聞かれる | 低 | 「ない、それが価値」 |

---

# 6. 拡張余地

- Fitbit / Garmin 対応
- Slack 連携
- AI によるコード傾向分析
- CI/CD 心拍連動
- HCI 学会投稿

---

# 7. 結論

DDD は技術的に成立する。

Apple Watch + Go Daemon + git hook という枯れた技術を組み合わせることで、「情熱の物理計測」というコンセプトを実装できる。

重要なのは、ふざけたコンセプトを真面目な技術アーキテクチャで実装することである。

---

## メタ情報

| 項目 | 内容 |
|---|---|
| バージョン | 1.1 |
| 作成日 | 2026-05-14 |
| 前提ドキュメント | DDD 要件定義書 v1.0 |
