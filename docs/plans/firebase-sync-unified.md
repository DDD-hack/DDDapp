  # 統合実装計画 — Firebase 同期 (Daemon=RTDB 完了 / Dashboard=未着手)

**作成日**: 2026-05-23
**対象 Issue**: #79 [FB-3]（設計を Firestore → RTDB に再定義）

---

## 0. 背景: なぜ「見直す」必要があるか

| 工程 | 元の `implementation_plan.md`（Firestore 前提） | 実際の現状 |
|---|---|---|
| daemon 側 BPM 中継 | Firestore `users/{uid}` 書き込み | ✅ **RTDB `/users/{uid}/current_bpm` で実装済み**（`feature/daemon-rtdb-sync`） |
| daemon 側 コミット記録 | Firestore `users/{uid}/commits/{id}` | ✅ **RTDB `/commits/{uid}/{push-id}` で実装済み** |
| daemon 側 fail-safe | サービスアカウント未設定でローカル継続 | ✅ 実装済み |
| `auth_sync` 受信 | daemon が WS から uid を保持 | ✅ 実装済み（`api.Session`） |
| dashboard `useDaemon` フォールバック | Firestore `onSnapshot` | ❌ **未着手** |
| dashboard `useCommits` フォールバック | Firestore コレクションクエリ | ❌ **未着手** |
| `auth_sync` 送信 | `AuthProvider.tsx` から WS へ | ❌ **未着手** |

**結論**: 元計画書の **Component 1 は RTDB 版として既に着地**。残りの **Component 2（dashboard 側）を RTDB 前提に読み替えて実装する**のが本計画書のスコープ。

---

## 1. なぜダッシュボードも Firestore ではなく RTDB か

- daemon が RTDB に書いているので、dashboard も RTDB から読むのが**最短経路**
- Firestore を経由しても二重コスト・整合性確保のオーバーヘッドが増えるだけ
- `dashboard/lib/firebase.ts` には既に `db: Database | null`（RTDB）が export 済み — 受け皿は揃っている
- RTDB の `onValue` は WebSocket ベースでミリ秒オーダー、BPM ゲージ表示に最適

---

## 2. ブランチ戦略

| 案 | 内容 | 評価 |
|---|---|---|
| A. `feature/daemon-rtdb-sync` の続きで実装 | 1 つの大きい PR にまとまる | ❌ レビュー粒度が大きすぎる |
| **B. `feature/dashboard-rtdb-sync` を main から新規** | dashboard 側だけの独立 PR | ✅ **推奨**。daemon が未マージでも動作確認可、レビュー分割 |
| C. `feature/daemon-rtdb-sync` から派生 | dashboard が daemon の変更に依存 | △ Session/auth_sync は daemon 側完結。dashboard は WS の口だけ知ればよく独立可 |

**採用: B**。dashboard 側で動作確認するには Firebase Console で RTDB のデータが見えればよく、daemon の PR 状態とは独立。

---

## 3. スコープ（Component 2 = Dashboard Frontend）

### B-1. `dashboard/app/hooks/useDaemon.ts` の改修

**現状**: WS のみ。切断時は `disconnected` ステータスのまま BPM が `null` になる。

**追加機能**:
- `useAuth()` から `user` を読む
- WS の `open` ハンドラ内で `{"type":"auth_sync","uid","displayName"}` を送信
- ユーザー変更時（login/logout/switch）に既存 WS へ `auth_sync` を投げ直す
- WS が **3 秒以上 disconnected** かつ `user && db` の場合 → `onValue(ref(db, "users/" + uid))` で RTDB 購読開始
  - 受信 `{current_bpm, updated_at}` から `bpm` / `stale` を算出
  - `updated_at` から 10 秒以上経過なら `stale=true`
- WS が再接続したら `off()` で購読停止 → WS 経路に戻す
- `ConnectionStatus` の union に `"cloud"` を追加

**実装の肝**:
- WS callback から最新 user を読むため `userRef = useRef(user)` を別 effect で同期
- フォールバックタイマー / unsubscribe 関数を ref に保持し、cleanup で確実に解放

### B-2. `dashboard/app/hooks/useCommits.ts` の改修

**現状**: ローカル `GET /commits` をポーリング。失敗時は `error=true` になるだけ。

**追加機能**:
- `useAuth()` から `user` を読む
- ローカル fetch が失敗 かつ `user && db` の場合、RTDB へフォールバック:
  - `query(ref(db, "commits/" + uid), orderByChild("attempted_at"), limitToLast(n))`
  - `get` で 1 回取得（ポーリング維持）。本格的リアルタイムにしたければ後で `onChildAdded` に置換可
- フィールド命名は RTDB が snake_case（`repo_path`/`commit_hash`/`bpm`/`result`/`attempted_at`）なので既存 `CommitRecord` 型と整合
- `attempted_at` は RTDB では Unix ミリ秒（number）→ `new Date(ms).toISOString()` に変換

### B-3. `auth_sync` の送信箇所

元計画書は `AuthProvider.tsx` に書く案だったが、**`useDaemon.ts` 側に集約する方が自然**:

- WS のライフサイクル（open / close / reconnect）と密接に結合
- `AuthProvider` が WS 接続の中身を知る必要がなくなり、責務が分離される
- ログアウト時に空 uid を送る処理も同じ場所に書ける

採用: **B-1 の中に内包**。

### B-4. `dashboard/app/page.tsx` の表示拡張

- `STATUS_LABEL` に `cloud: "☁ CLOUD"` 追加
- `STATUS_COLOR` に `cloud: "text-sky-400"` 追加（LIVE の green と区別）

### B-5. `.env.example` の整理

- 既存 `NEXT_PUBLIC_FIREBASE_DATABASE_URL=https://ddd-hack-default-rtdb.firebaseio.com/` を空値テンプレに戻す（コミット時に他人の URL が誤って入らないように）
- `databaseURL` を含めた Firebase 必須キーを comment で明示

---

## 4. 主要な設計判断（要承認）

| # | 項目 | 採用案 | 代替案 |
|---|------|--------|--------|
| **D1** | フォールバック起動条件 | WS が **3 秒以上 disconnected** AND user ログイン中 AND `db` 設定済み | デプロイ環境検知（`hostname !== "localhost"`）で即 RTDB 購読 |
| **D2** | `auth_sync` 送信元 | **`useDaemon.ts`**（WS ライフサイクルに集約） | `AuthProvider.tsx`（元計画書通り） |
| **D3** | `useCommits` フォールバック取得方式 | **`get()` 1 回取得**（既存ポーリングは継続） | `onChildAdded` でリアルタイム差分受信 |
| **D4** | コミット取得件数 | 既存 `limit` プロパティをそのまま使用（デフォルト 100） | 別パラメータで分離 |
| **D5** | "cloud" 状態の表現 | `status` の union に追加 | 別フィールド `source: "ws" \| "rtdb"` を追加 |

---

## 5. ファイル変更一覧

**dashboard（TS）**
| ファイル | 種別 | 変更 |
|---|---|---|
| `dashboard/app/hooks/useDaemon.ts` | **MOD** | `useAuth` 連携、`auth_sync` 送信、RTDB `onValue` フォールバック、`"cloud"` ステータス追加 |
| `dashboard/app/hooks/useCommits.ts` | **MOD** | RTDB `query` + `get` フォールバック、`attempted_at` の型変換 |
| `dashboard/app/page.tsx` | **MOD** | `STATUS_LABEL` / `STATUS_COLOR` に `cloud` 追加 |
| `.env.example` | **MOD** | `NEXT_PUBLIC_FIREBASE_DATABASE_URL` を空テンプレに戻す |

**変更しないファイル（既に整っている）**
- `dashboard/lib/firebase.ts` — `db: Database | null` が既に export 済み
- `dashboard/app/auth/AuthProvider.tsx` — D2 の判断により責務は変更しない
- daemon 側のすべて — `feature/daemon-rtdb-sync` で完了

---

## 6. 検証計画

### 自動
- `cd dashboard && npx tsc --noEmit`
- `cd dashboard && npm run lint`

### 手動（要 daemon 起動 & Firebase 設定）
1. daemon を `DDD_FIREBASE_CREDENTIALS` + `DDD_FIREBASE_DATABASE_URL` 付きで起動 → `rtdb: ready`
2. dashboard で Google ログイン → daemon ログに `auth_sync received: uid=...`
3. Apple Watch で BPM 送信 → ヘッダーが `● LIVE`、BPM ゲージが連動
4. daemon を停止 → 3 秒後に `☁ CLOUD` に切替、Firebase Console の `/users/{uid}/current_bpm` の値が dashboard に表示され続ける
5. daemon を再起動 → 自動再接続で `● LIVE` に戻る
6. `git commit` 数回 → ローカル取得 OK / daemon 停止後は RTDB 取得 OK の両方を確認

---

## 7. リスクと留意点

| リスク | 対策 |
|---|---|
| `onValue` リスナーリーク | cleanup で確実に `off()` / unsubscribe を呼ぶ。useRef で参照保持 |
| user 切替時の購読切替漏れ | user 変更 effect 内で「フォールバック中なら uid 切替」ロジックを書く |
| WS 切断直後に user が落ちた場合の空クエリ | `if (!user) return;` ガードを各分岐に置く |
| `attempted_at` の型不一致（RTDB=number, local=string） | useCommits 内で `new Date(ms).toISOString()` 変換層を1箇所に閉じる |
| Mixed Content（Vercel から `ws://localhost` 拒否） | 3 秒タイムアウト後の RTDB フォールバックで自然に救済される。デプロイ環境検知の即時切替も D1 で検討可 |

---

## 8. 実装順（PR 内コミット分割案）

1. `useDaemon.ts` の改修（auth_sync 送信 + RTDB onValue フォールバック + cloud status）
2. `useCommits.ts` の RTDB フォールバック
3. `page.tsx` の cloud ステータス表示
4. `.env.example` の整理

各ステップで `tsc` / `lint` を回す。

---

## 9. 元計画書（Firestore 版）の取り扱い

- `implementation_plan.md`（Firestore 前提）は**役割を終えた**ものとして、リポジトリにコミットしない or `docs/archive/` に移動を推奨
- 本計画書（`docs/plans/firebase-sync-unified.md`）が確定版
- `docs/rtdb-schema.md` がデータスキーマの一次情報源
