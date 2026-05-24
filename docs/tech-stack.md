# 使用技術

DDD (Doki Doki Development) で採用している技術スタック一覧。

## アーキテクチャ概要（1 行版）

```
Apple Watch (HealthKit) → iPhone (Swift) → Go daemon (Echo + WebSocket)
  → SQLite + Firebase RTDB → Next.js dashboard (Vercel) + VS Code 拡張
```

---

## フロントエンド（ダッシュボード）

- **Next.js 16.2** (App Router, Turbopack)
- **React 19**
- **TypeScript 5**
- **Tailwind CSS v4** (`@tailwindcss/postcss`)
- **shadcn/ui** (UI コンポーネント)
- **Radix UI / @base-ui/react** (ヘッドレス UI)
- **lucide-react** (アイコン)
- **recharts** (心拍数チャート可視化)
- **class-variance-authority / clsx / tailwind-merge** (条件付きスタイル)
- **Firebase Web SDK 12** (Auth + Realtime Database)
- **Vercel** (ホスティング・デプロイ)

### 技術的ポイント

#### 🌐 ローカル WS / クラウド RTDB のハイブリッドソース
- 起動時に `window.location.hostname` で**ローカル開発 / Vercel 本番**を判定
- ローカル: `ws://localhost:8765` を主、3 秒切断したら RTDB の `onValue` にフォールバック
- Vercel: 最初から RTDB の `onValue` 一択（localhost に届かないので試行すらしない）
- どちらでも同じ `DaemonState` インターフェースで UI に流す

#### 🔐 fail-safe な Firebase 初期化
- 必須環境変数が 1 個でも欠けたら `auth = null`, `rtdb = null` を返す
- → 全環境変数を設定しなくてもアプリ全体がクラッシュせず「ローカルモード」で動く

#### 🆔 auth_sync WS メッセージで daemon に uid を渡す
- ログイン時、ダッシュボードの `useDaemon` が WS open ハンドラ内で `{type:"auth_sync", uid}` を送信
- daemon はこれを受け取って memory session に保持し、以降の RTDB 書き込みパスに使う
- → クラウドストレージへの**書き込み主体**が daemon、**読み取り主体**が dashboard という綺麗な分離

## バックエンド（Go デーモン）

- **Go 1.25**
- **Echo v4** (HTTP / WebSocket ルーター)
- **gorilla/websocket** (Apple Watch・VS Code 拡張との双方向通信)
- **spf13/viper** (環境変数・設定管理)
- **modernc.org/sqlite** (Pure Go SQLite — Windows クロスビルド対応)
- **firebase.google.com/go/v4** (Firebase Admin SDK)
- **cloud.google.com/go/firestore** (Firestore クライアント)

### 技術的ポイント

#### 🪶 CGO ゼロの Pure Go SQLite
- `mattn/go-sqlite3` ではなく **`modernc.org/sqlite`** を採用
- → `GOOS=windows go build` でクロスコンパイルが通る = **配布用バイナリが macOS で作れる**
- DDD は git hook として配布するので、ユーザー側の Go コンパイラ不要

#### 🛡️ Fail-safe な Firebase 初期化
- credentials が無くても daemon は **クラッシュせず起動**（`OpenRTDB` が `(nil, nil)` を返す設計）
- 全メソッドが **nil レシーバ no-op** で安全 → ハッカソン参加者が Firebase 未設定でもローカル機能だけで動く

#### ⏱️ 1Hz broadcast ループによる decoupling
- Apple Watch の送信レートに依存せず、**main.go の `time.NewTicker(1s)`** から RTDB 書き込みを発火
- → 「1 秒ごとに `/users/{uid}/current_bpm` を更新」を Apple Watch のスペック差を問わず保証

#### 🪪 in-memory Session で uid を保持
- ダッシュボードから受信する `auth_sync` WS メッセージで uid を保持
- mutex 保護で並行アクセス安全
- ハッカソン用途の単一ユーザー前提のため Redis 等は不要

#### 🔥 `context.Background()` での非同期書き込み
- Firebase/Discord 書き込みは goroutine 化、ただし親 context は `Background()` を起点に
- HTTP request の context をそのまま使うと、レスポンス返却時に **`context canceled`** で書き込みが落ちる落とし穴を回避

## iOS コンパニオン（独自アプリ）

- **Swift / SwiftUI** で iPhone アプリ + Apple Watch アプリを独自実装
- **HealthKit** (`HKWorkoutSession` でリアルタイム心拍取得)
- **WatchConnectivity** (`WCSession` で iPhone ↔ Apple Watch 通信)
- **URLSessionWebSocketTask** (daemon への WebSocket クライアントを自作)
- **Background delivery** 対応 (Workout 中もアプリ閉じても心拍中継継続)

### 技術的ポイント

#### ⚡ クエリ型 → ストリーム型への切り替えで遅延を解消
- 当初構成は **既製の Workout アプリ → HealthKit Store → iPhone の `HKAnchoredObjectQuery`** で読む方式
- → サンプル反映に **数秒〜数十秒の遅延**で、1Hz リアルタイム判定が成立しない
- 現構成は **独自 Watch アプリ内で `HKLiveWorkoutBuilder` を直接購読**
- → センサーから**サブ秒**で BPM を取り、人体の反応速度に追従

#### 🔀 三重経路によるフォールトトレラント設計
1. **Path 1 (メイン)**: Watch → `WCSession.sendMessage` → iPhone → WebSocket → daemon
2. **Path 2 (低レイテンシ)**: Watch → `DaemonDirectClient` → daemon に直送（同一 WiFi 時）
3. **Path 3 (保険)**: iPhone の `HealthKitManager` がフォアグラウンドで HealthKit クエリ

→ Watch ↔ iPhone 切断時も Watch 直送、iPhone のみ起動時もデータが流れる

#### 📨 WCSession の 2 経路使い分け
- 到達可能時 = **`sendMessage`** (即時、レスポンス保証)
- 到達不可時 = **`updateApplicationContext`** (キュー化されたバックグラウンド配信)
- → アプリがバックグラウンドにあっても BPM が確実に届く

#### 🔄 自動再接続 + keepAlive
- `URLSessionWebSocketTask` 切断時、指数バックオフで再接続
- `HKWorkoutSession` には keepAlive Timer を仕込んで OS の省電力スリープを防止

## VS Code 拡張

- **TypeScript 5**
- **VS Code Extension API**
- **bun** (バンドラ・ビルドツール)
- WebView API (HTML / CSS / JS による演出パネル)

### 技術的ポイント

#### ⌨️ `type` コマンドの override で typing 自体をブロック
- `vscode.commands.registerCommand("type", ...)` を登録すると、VS Code はキー入力のたびにこちらを呼ぶ
- BPM が閾値未満なら `default:type` に転送せず**入力を物理的に止める** (VSCodeVim と同じ手法)
- ReadOnly Session API との二重防御で paste / drag-drop も塞ぐ

#### 🎬 3 段構えの演出フェーズ設計
- Buildup (鼓動 0.8s + 白フラッシュ 0.2s) → Main (火炎・パーティクル) → Afterglow (3s)
- BPM に応じた **Tier 1〜5** で背景色・称号・粒子数を段階化
- Tier 4 (LEGENDARY) 以上ではサイドバー一時クローズ + Achievement Card パネル並列表示

#### 🧪 安全装置 4 重のコード挿入
- REJECTED 時に編集中ファイルへダメージコメントを 3 秒だけ挿入する演出
- **dirty document はスキップ / 削除前にテキスト一致確認**でユーザーの作業を絶対に壊さない設計

## Git Hook

- **Go** (pre-commit hook をクロスプラットフォーム単一バイナリで配布)

## クラウド・インフラ

- **Firebase Realtime Database** (1Hz BPM + コミット履歴の中継)
- **Firebase Authentication** (Google ログイン)
- **Firebase Firestore** (補助的データ保存用)
- **Vercel** (Next.js デプロイ)
- **Discord Webhook** (コミット結果の自動通知)
- **GitHub Actions** (CI: lint / test / build)

## 開発環境・ツール

- **mise** (Go / Node / bun / firebase CLI のバージョン統一)
- **bun** (JavaScript / TypeScript パッケージマネージャ・ランタイム)
- **gh CLI** (GitHub 操作)
- **Vitest / Go test** (テスト)
- **ESLint / gofmt / go vet** (リンタ・フォーマッタ)

## アーキテクチャ特徴

- **WebSocket リアルタイム通信** (心拍数の 1Hz ストリーミング)
- **ハイブリッドクラウド設計** (ローカル daemon + RTDB フォールバック)
- **Fail-safe 設計** (Firebase 未設定でもローカルで完結動作)
- **クロスプラットフォーム** (macOS / Windows / Linux 対応)

---

## 短縮版（README / スライド用）

- **フロント**: Next.js 16 / React 19 / TypeScript / Tailwind CSS v4 / shadcn/ui / recharts
- **バックエンド**: Go 1.25 / Echo / gorilla/websocket / modernc.org/sqlite
- **iOS**: Swift / SwiftUI / HealthKit / WatchConnectivity
- **VS Code 拡張**: TypeScript / VS Code Extension API / WebView
- **クラウド**: Firebase Realtime Database / Firebase Auth / Vercel / Discord Webhook
- **開発環境**: mise / bun / GitHub Actions
