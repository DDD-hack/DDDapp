# Implementation Plan - Firebase Firestore Sync [FB-3]

本計画書は、ローカルで動作する Go デーモンとクラウド（Vercel にデプロイされた Next.js ダッシュボード）の間で、心拍データ（BPM）およびコミットログを **Firebase Firestore 経由でバックグラウンド同期**するための実装計画です。

これにより、ブラウザのセキュリティ制限（Mixed Content）を完全に回避し、Vercel 上でローカルの心拍数をセキュアかつリアルタイムに表示できるようになります。

---

## 全体アーキテクチャ・データフロー

```
[Apple Watch (companion)]
      │ (ローカルWiFi/Bluetooth)
      ▼
[ローカル Go デーモン (dddd)] ── (WebSocketでUID取得) ── [Next.js (ローカル環境)]
      │
      ├─► [Git Hook / VS Code 拡張] (ローカル超高速判定)
      │
      └─► [Firestore (Google Cloud)] (バックグラウンドクラウド同期)
                │
                ▼ (Firestore SDK - onSnapshot リアルタイム監視)
          [Vercel ダッシュボード (https://xxx.vercel.app)]
```

### 同期メカニズムの鍵：
1. **ユーザーID (UID) のデーモン連携**: 
   ダッシュボード（ローカル環境）にログインした際、WebSocket を通じてデーモンに `{"type": "auth_sync", "uid": "xxxx", "displayName": "xxxx"}` のような認証情報を通知します。
2. **デーモンからの直接クラウド送信**:
   デーモンは通知された UID に紐づけて、Apple Watch からの心拍データや `git commit` 結果を直接 Firestore に書き込みます。
3. **Vercel 上でのフォールバック取得**:
   Vercel 上で動くダッシュボードは、ローカル WebSocket 接続が Mixed Content 等でブロックされた場合、自動的に **Firestore リアルタイム監視（onSnapshot）** パスへフォールバックし、クラウドからデータをリアルタイムに取得します。

---

## User Review Required

> [!IMPORTANT]
> **Firebase サービスアカウント (Credentials) の導入について:**
> ローカルの Go デーモンから Firestore に安全に書き込むため、**Firebase サービスアカウントの秘密鍵 JSON** が必要になります。
> デーモンは、環境変数 `FIREBASE_CONFIG_PATH`（または `daemon/.env`）でこの JSON ファイルのパスを読み込み、Firestore への認証を行います。
> *※この JSON ファイルは絶対に Git にコミットせず、`.gitignore` に追加します。*

---

## Proposed Changes

### Component 1: Go Daemon (Firestore バックグラウンド同期の実装)

#### [MODIFY] [go.mod](file:///Users/kotaro/ddd/daemon/go.mod)
- Firebase Go Admin SDK (`firebase.google.com/go/v4`) および Firestore クライアントの依存パッケージを追加します。

#### [NEW] [firebase.go](file:///Users/kotaro/ddd/daemon/internal/store/firebase.go)
- Firebase アプリの初期化と Firestore クライアントのシングルトン管理を行います。
- サービスアカウント JSON ファイルが存在しない場合は、サイレントにローカル専用モードで動作を続行する（Fail-safe設計）。

#### [MODIFY] [handler.go](file:///Users/kotaro/ddd/daemon/internal/api/handler.go)
- WebSocket 接続時、クライアント（ダッシュボード）からの `auth_sync` メッセージを受信し、現在アクティブなユーザーID (`uid`) をメモリに保持・更新するハンドラを追加します。
- 心拍データ（BPM）受信時、アクティブな `uid` が存在すれば、Firestore 上の `users/{uid}` ドキュメントを更新する非同期ゴルーチンを走らせます。
- コミット結果受信時、`users/{uid}/commits/{commitId}` にコミット履歴ドキュメントを追加します。

---

### Component 2: Dashboard Frontend (Vercel フォールバック表示の実装)

#### [MODIFY] [useDaemon.ts](file:///Users/kotaro/ddd/dashboard/app/hooks/useDaemon.ts)
- WebSocket の接続試行が Mixed Content エラーや接続エラーで `disconnected` になった場合、またはデプロイ環境である場合、**Firestore リアルタイム監視リスナー (`onSnapshot`)** を起動します。
- ログイン中のユーザーの Firestore パス `users/{uid}` を常時監視し、心拍数（BPM）やステータスを WebSocket 接続時と全く同じ `DaemonState` インターフェースで UI に提供します。

#### [MODIFY] [useCommits.ts](file:///Users/kotaro/ddd/dashboard/app/hooks/useCommits.ts)
- 直近コミット履歴の取得において、ローカルデーモンからの API フェッチが失敗した場合、Firestore コレクション `users/{uid}/commits` からクエリ（日付順で降順ソート、制限件数）を行ってコミットリストを取得するようにします。

#### [MODIFY] [AuthProvider.tsx](file:///Users/kotaro/ddd/dashboard/app/auth/AuthProvider.tsx)
- ダッシュボードがローカル開発環境（`localhost:3000`）で動作しており、かつログインに成功した際、接続中のローカル WebSocket に対して `auth_sync` メッセージを自動送信する処理を追加します。

---

## Verification Plan

### Automated Tests
- `go test ./...` にて、Firestore 書き込み処理が正常にバイパス（サービスアカウント未設定時）または実行されることをテスト。
- `bun run lint` および `tsc --noEmit` で TypeScript のコンパイルが通ることを確認。

### Manual Verification
1. **ローカル環境での動作**:
   - ダッシュボード（localhost）で Google ログインする。
   - Go デーモン側に `Received auth_sync: uid=...` とログが出力されることを確認。
2. **Vercel 上での動作**:
   - ダッシュボードを Vercel にデプロイし、Google ログインする。
   - ローカルの Apple Watch アプリで心拍数を更新する。
   - Vercel ダッシュボードが、ローカルへの直接通信なしで（Firestore 経由で）リアルタイムに心拍ゲージやコミットログを更新できることを確認。
