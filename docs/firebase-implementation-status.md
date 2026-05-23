# DDD Firebase 実装状況 — 解説ドキュメント

**最終更新**: 2026-05-23
**目的**: 現状の Firebase / DB 実装を把握する。何がどう繋がっているか、どこに不整合があるかを視覚的に解説する。

---

## 0. TL;DR

- ストレージは **4 層**（SQLite / Firebase Auth / Firebase Realtime Database / Firestore）
- daemon は **SQLite + RTDB** に書き込む。Firestore は休眠中
- dashboard は **WebSocket → daemon** が主経路、切断時のフォールバックで **Firestore** を読もうとしている（実態は空）
- **3 つの大きな不整合**がある: daemon と dashboard の読み書き先がズレている、RTDB スキーマが 2 種類並立、Firestore コードが残骸として残っている

---

## 1. 全体アーキテクチャ

```mermaid
flowchart TB
    subgraph Local["💻 ローカル環境"]
        AppleWatch["⌚ Apple Watch<br/>1Hz BPM 送信"]
        iPhone["📱 iPhone Companion<br/>(Swift / HealthKit)"]
        GitHook["🪝 git pre-commit hook<br/>(Go binary)"]
        VSCode["📝 VS Code 拡張"]

        subgraph Daemon["🛡️ Go Daemon (localhost:8765)"]
            Buffer["🧠 hrm.Buffer<br/>10秒窓 BPM 平均"]
            Session["🪪 api.Session<br/>uid を保持"]
            SQLite[("📦 SQLite<br/>~/.ddd/ddd.db")]
            FirestoreClient["☁️ FirestoreClient<br/>(休眠中)"]
            RTDBClient["🔥 RTDBClient<br/>(Admin SDK)"]
        end

        subgraph Dashboard["🖥️ Dashboard (Next.js)"]
            useDaemon["useDaemon hook<br/>WS + Firestore fallback"]
            useCommits["useCommits hook<br/>HTTP + Firestore fallback"]
            AuthProvider["AuthProvider<br/>Google ログイン"]
        end
    end

    subgraph Cloud["☁️ Firebase Cloud"]
        FirebaseAuth["🔐 Firebase Auth<br/>(Google)"]
        RTDB[("🔥 Realtime Database<br/>/users, /commits")]
        Firestore[("🗂️ Firestore<br/>(未使用・空)")]
    end

    AppleWatch -- "BPM" --> iPhone
    iPhone -- "WebSocket<br/>{bpm, timestamp}" --> Daemon
    GitHook -- "POST /commits" --> Daemon
    VSCode -- "WS /ws/vscode" --> Daemon

    Buffer -. "1Hz tick" .-> RTDBClient
    Daemon -- "/users/{uid}/current_bpm<br/>/commits/{uid}/{push-id}" --> RTDB

    Dashboard <== "WS リアルタイム<br/>(主経路)" ==> Daemon
    Dashboard -- "HTTP /commits<br/>15秒ポーリング" --> Daemon

    AuthProvider <-- "Google ログイン" --> FirebaseAuth
    Dashboard -. "WS切断 3秒経過時の<br/>フォールバック (現状は空振り)" .-> Firestore
    Dashboard -. "本来はここを読むべき<br/>(未実装)" .-> RTDB

    classDef warn stroke:#f00,stroke-width:2px,color:#f00
    classDef sleep stroke:#888,stroke-width:1px,stroke-dasharray: 5 5
    class FirestoreClient,Firestore sleep
    class useDaemon,useCommits warn
```

> 💡 **赤枠** = 不整合あり（後述）/ **点線** = 休眠・未実装

---

## 2. ストレージ層の役割

| # | ストレージ | 場所 | 書き込み | 読み取り | 用途 |
|:-:|---|---|---|---|---|
| ① | **SQLite** | ローカル `~/.ddd/ddd.db` | daemon | daemon の HTTP / git hook | 永続ローカル履歴・BPM 閾値判定 |
| ② | **Firebase Auth** | Google 側 | dashboard (ログイン操作) | dashboard | UID 発行・認証状態管理 |
| ③ | **Realtime Database (RTDB)** | Firebase | daemon (Admin SDK) | dashboard (フォールバック想定) | リアルタイム BPM とコミット結果のクラウド中継 |
| ④ | **Firestore** | Firebase | 誰も書いてない | dashboard hooks の fallback コード | **本来は不要**。コード残骸 |

```mermaid
quadrantChart
    title ストレージの位置づけ
    x-axis "ローカル" --> "クラウド"
    y-axis "永続化" --> "リアルタイム"
    SQLite: [0.15, 0.25]
    "Firebase Auth": [0.85, 0.5]
    RTDB: [0.85, 0.85]
    "Firestore (休眠)": [0.85, 0.55]
```

---

## 3. 書き込みフロー（daemon → クラウド）

### 3-1. BPM の流れ（Apple Watch → RTDB）

```mermaid
sequenceDiagram
    autonumber
    actor Watch as ⌚ Apple Watch
    participant iPhone as 📱 iPhone
    participant WS as 🛡️ daemon WS Handler
    participant Buffer as 🧠 hrm.Buffer
    participant Tick as ⏰ 1Hz Ticker (main.go)
    participant Session as 🪪 Session
    participant RTDB as 🔥 RTDB

    Watch->>iPhone: 心拍数 1Hz
    iPhone->>WS: ws://localhost:8765/ws<br/>{"bpm": 152, "timestamp": "..."}
    WS->>Buffer: buf.Add(152)
    WS->>WS: SQLite.SaveSample()

    loop 毎秒（独立タイマー）
        Tick->>Buffer: bpm = buf.Average()
        alt 直近 10 秒以内にサンプルあり
            Tick->>Session: uid, _, ok := Current()
            opt uid 既知 & rtdb != nil
                Tick->>RTDB: Update /users/{uid}<br/>{current_bpm, updated_at}
            end
        else stale
            Note over Tick: RTDB に書かない（最後の値が残る）
        end
    end
```

**ポイント**: BPM の RTDB 書き込みは **Apple Watch の送信レートに依存せず、daemon 内部の 1Hz ticker から発火**します。これにより「1 秒ごとに `/users/{uid}/current_bpm` を更新」という仕様を Apple Watch のスペックを問わず保証しています。

---

### 3-2. コミット結果の流れ（git hook → RTDB）

```mermaid
sequenceDiagram
    autonumber
    actor Dev as 🧑‍💻 開発者
    participant Hook as 🪝 pre-commit hook
    participant PostC as 🛡️ daemon POST /commits
    participant SQLite as 📦 SQLite
    participant VSC as 📝 VS Code 拡張
    participant Session as 🪪 Session
    participant RTDB as 🔥 RTDB

    Dev->>Hook: git commit -m "..."
    Hook->>PostC: POST /commits<br/>{repo_path, commit_hash, bpm, result}
    PostC->>SQLite: SaveCommitAttempt()
    PostC->>VSC: WS broadcast<br/>{"type":"commit_result", result, bpm}

    PostC->>Session: uid, _, ok := Current()
    opt uid 既知 & rtdb != nil
        PostC->>RTDB: Push /commits/{uid}<br/>{repo_path, commit_hash, bpm,<br/> result, attempted_at}
        Note over RTDB: push-id 自動採番
    end

    PostC-->>Hook: 201 Created
```

---

## 4. 認証フロー（dashboard → daemon に UID を渡す）

```mermaid
sequenceDiagram
    autonumber
    actor User as 🧑 ユーザー
    participant DB_UI as 🖥️ Dashboard UI
    participant Auth as 🔐 AuthProvider
    participant Google as 🔵 Google (Firebase Auth)
    participant useDaemon as ⚙️ useDaemon hook
    participant WS as 🛡️ daemon /ws/vscode
    participant Session as 🪪 Session

    User->>DB_UI: ログインボタン
    DB_UI->>Auth: signIn()
    Auth->>Google: signInWithPopup()
    Google-->>Auth: User { uid, displayName }
    Auth-->>DB_UI: user 状態を更新

    Note over DB_UI,useDaemon: user 変更 effect が発火
    useDaemon->>WS: send {"type":"auth_sync",<br/>"uid":"abc", "displayName":"oto"}
    WS->>Session: SetAuth(uid, displayName)

    Note over Session: 以降の Tick/PostC は<br/>この uid を使って RTDB に書く
```

ログアウト時は空 uid を送って `Session.Clear()` が呼ばれます。
WS が再接続するたびに `open` ハンドラ内で `auth_sync` を再送する設計（user が変わってもズレない）。

---

## 5. 読み取りフロー（dashboard 側）

### 5-1. 状態機械（useDaemon の接続状態）

```mermaid
stateDiagram-v2
    [*] --> connecting

    connecting --> connected: WS open
    connecting --> disconnected: WS close/error

    connected --> disconnected: WS close
    connected --> connected: bpm/commit_result<br/>受信

    disconnected --> connecting: 5秒後に再接続
    disconnected --> cloud: 3秒経過 +<br/>user & db あり

    cloud --> connected: WS 復活
    cloud --> cloud: onSnapshot<br/>受信

    note right of cloud
      ☁ CLOUD ステータス表示
      Firestore onSnapshot を購読
      ※ daemon は RTDB に書くので
        実際にはここで何も来ない
    end note
```

### 5-2. BPM 取得シーケンス

```mermaid
sequenceDiagram
    autonumber
    participant Hook as ⚙️ useDaemon
    participant WS as 🛡️ daemon WS
    participant FS as 🗂️ Firestore<br/>(現コード)
    participant RTDB as 🔥 RTDB<br/>(本来あるべき)

    Hook->>WS: new WebSocket()
    activate WS
    WS-->>Hook: open → setStatus("connected")
    WS-->>Hook: message {bpm: 152}
    WS-->>Hook: message {commit_result}

    Note over WS: ❌ daemon 停止 / 切断
    WS-->>Hook: close → setStatus("disconnected")
    deactivate WS

    Hook->>Hook: 3 秒タイマー開始

    alt 現在のコード
        Hook->>FS: onSnapshot(doc("users", uid))
        Note over FS: 誰も書いてないので<br/>data = null
        FS-->>Hook: snap.data() = undefined
        Hook->>Hook: setBpm(null), setStale(true)
    else あるべき実装
        Hook->>RTDB: onValue(ref("users/" + uid))
        RTDB-->>Hook: {current_bpm: 150, updated_at: ...}
        Hook->>Hook: setBpm(150)
    end
```

---

## 6. データスキーマの「2 つの世界」

ここが**一番混乱する部分**です。`docs/rtdb-schema.md`（daemon の私が書いた）と `docs/firebase-database-design.md` + `dashboard/lib/firebaseTypes.ts`（dashboard チームが書いた）で別物のスキーマが定義されています。

### 6-1. daemon が実際に書く形（`docs/rtdb-schema.md`）

```mermaid
erDiagram
    USERS {
        string uid PK
        number current_bpm "snake_case"
        number updated_at "Unix ms"
    }
    COMMITS_NODE["/commits/{uid}/{push-id}"] {
        string push_id PK "Firebase 自動採番"
        string uid FK
        string repo_path
        string commit_hash
        number bpm
        string result "accepted/rejected"
        number attempted_at "Unix ms"
    }
    USERS ||--o{ COMMITS_NODE : "1人につき複数コミット"
```

### 6-2. dashboard チームが期待する形（`firebaseTypes.ts`）

```mermaid
erDiagram
    MEMBERS {
        string uid PK
        string name "camelCase"
        string email
        number joinedAt
    }
    HEARTBEAT {
        string uid PK
        number bpm "← current_bpm ではない"
        string status "ok/stale/offline"
        number updatedAt
    }
    COMMITS {
        string pushId PK
        string uid FK
        number bpm
        string result
        string repo "← repo_path ではない"
        string hash "← commit_hash ではない"
        number committedAt "← attempted_at ではない"
    }
    STATS {
        string uid PK
        number deadCount
        number totalAccepted
        number maxBpm
        number lastCommitAt
    }
    HEATMAP {
        string uid PK
        string date PK
        number accepted
        number rejected
        number maxBpm
    }

    MEMBERS ||--o| HEARTBEAT : "1対1"
    MEMBERS ||--o{ COMMITS : "1対多"
    MEMBERS ||--o| STATS : "1対1"
    MEMBERS ||--o{ HEATMAP : "日別"
```

### 6-3. 差分まとめ

| 項目 | daemon が書く形 | dashboard が想定する形 |
|---|---|---|
| **BPM のパス** | `/users/{uid}` | `/heartbeat/{uid}` |
| **BPM のフィールド名** | `current_bpm`, `updated_at` | `bpm`, `status`, `updatedAt` |
| **コミットのフィールド** | `repo_path`, `commit_hash`, `attempted_at` | `repo`, `hash`, `committedAt` |
| **命名規則** | snake_case | camelCase |
| **メンバー一覧** | 想定なし | `/members/{uid}` |
| **集計** | 想定なし | `/stats/{uid}` (DEAD カウントなど) |
| **ヒートマップ** | 想定なし | `/heatmap/{uid}/{YYYY-MM-DD}` |
| **status フィールド** | 無い | `"ok" / "stale" / "offline"` |

```mermaid
flowchart LR
    subgraph daemon["🛡️ daemon が書く"]
        D1["/users/{uid}/current_bpm"]
        D2["/commits/{uid}/{push-id}"]
    end

    subgraph dashboard["🖥️ dashboard が読みたい"]
        S1["/members/{uid}"]
        S2["/heartbeat/{uid}"]
        S3["/commits/{uid}/{pushId}"]
        S4["/stats/{uid}"]
        S5["/heatmap/{uid}/{date}"]
    end

    D1 -.->|"パス・フィールド不一致"| S2
    D2 -.->|"フィールド名 6 個ズレ"| S3
    S1 -.->|"daemon が書いてない"| nothing1[" "]
    S4 -.->|"daemon が書いてない"| nothing2[" "]
    S5 -.->|"daemon が書いてない"| nothing3[" "]

    style nothing1 fill:none,stroke:none
    style nothing2 fill:none,stroke:none
    style nothing3 fill:none,stroke:none
```

---

## 7. 3 つの不整合（再掲・要対応）

### 不整合 ①: daemon=RTDB / dashboard=Firestore

```mermaid
flowchart LR
    daemon["🛡️ daemon"] -- "RTDB に書き込み" --> RTDB[("🔥 RTDB")]
    dashboard["🖥️ dashboard hook"] -. "Firestore から読もうとする" .-> Firestore[("🗂️ Firestore<br/>(空)")]
    RTDB ~~~ X{ }
    X ~~~ Firestore
    style X fill:none,stroke:none
```
→ **WS 切断時に dashboard のフォールバックが空振りする**。`feature/dashboard-rtdb-sync` ブランチ（コミット `ad6101c`）が解決策。

### 不整合 ②: 2 つの RTDB スキーマが並立

`docs/rtdb-schema.md`（daemon） と `firebaseTypes.ts` + `docs/firebase-database-design.md`（dashboard）の間でパス・フィールド・命名規則すべて不一致。
→ どちらかに統一する設計判断が必要。

### 不整合 ③: Firestore コードが残っている

| 残置箇所 | 状態 |
|---|---|
| `daemon/internal/store/firebase.go` + テスト | dormant（呼ばれない） |
| `daemon/internal/api/handler.go` の `fs` フィールド | 受け取るが使わない |
| `daemon/cmd/ddd/main.go` の `OpenFirestore` 呼び出し | 起動時に走るが結果は使われない |
| `dashboard/lib/firebase.ts` の `db: Firestore` export | hooks が import している（ただし RTDB 切替後は不要） |
| `dashboard/app/hooks/useDaemon.ts` の `onSnapshot` | 動くが daemon の書き込み先と違う |
| `dashboard/app/hooks/useCommits.ts` の Firestore クエリ | 同上 |

---

## 8. ファイル別マップ

### daemon 側

```mermaid
flowchart TB
    main["cmd/ddd/main.go<br/>📍 エントリポイント"]
    main --> store_open["store.Open()<br/>SQLite を開く"]
    main --> fs_open["store.OpenFirestore()<br/>💤 結果未使用"]
    main --> rtdb_open["store.OpenRTDB()<br/>✅ ここから RTDB へ"]
    main --> handler_new["api.NewHandler(buf, db, fs, rtdb, session)"]
    main --> ticker["1Hz ticker goroutine<br/>→ h.WriteCurrentBpmToRTDB()"]

    handler["internal/api/handler.go"]
    handler --> ws_iphone["WS /ws<br/>iPhone から BPM"]
    handler --> ws_vscode["WS /ws/vscode<br/>auth_sync 受信 + bpm 配信"]
    handler --> post_commit["POST /commits<br/>SQLite + RTDB に書く"]

    session["internal/api/session.go<br/>🪪 uid 保持"]
    rtdb_file["internal/store/rtdb.go<br/>🔥 SetCurrentBpm / AddCommit"]
    firestore_file["internal/store/firebase.go<br/>💤 UpsertUserBpm / AddUserCommit<br/>(誰も呼ばない)"]
    store_file["internal/store/store.go<br/>📦 SQLite ラッパー"]

    handler --> session
    handler --> rtdb_file
    handler --> firestore_file
    handler --> store_file

    classDef dormant stroke:#888,stroke-dasharray: 5 5
    class fs_open,firestore_file dormant
```

### dashboard 側

```mermaid
flowchart TB
    layout["app/layout.tsx<br/>📍 ルートレイアウト"]
    layout --> AuthProvider["app/auth/AuthProvider.tsx<br/>🔐 Google ログイン管理"]

    page["app/page.tsx<br/>📍 メイン画面"]
    page --> useDaemon["app/hooks/useDaemon.ts<br/>⚙️ BPM + commits リアルタイム"]
    page --> useCommits["app/hooks/useCommits.ts<br/>⚙️ コミット履歴 (HTTP)"]
    page --> useAuth["useAuth()"]
    page --> AuthButton["AuthButton.tsx"]
    page --> LoginBanner["LoginPromptBanner.tsx"]
    page --> BpmGauge["BpmGauge.tsx"]
    page --> CommitChart["CommitChart.tsx"]
    page --> PassionRanking["PassionRanking.tsx"]
    page --> SuccessRate["SuccessRateCard.tsx<br/>(PR #93 で追加)"]
    page --> MostPassionate["MostPassionateCommit.tsx<br/>(PR #93 で追加)"]

    AuthProvider --> firebase_lib["lib/firebase.ts<br/>🔐 app, auth, db, rtdb"]
    useDaemon --> firebase_lib
    useCommits --> firebase_lib

    types["lib/firebaseTypes.ts<br/>🗂️ Member/Heartbeat/CommitRecord/<br/>UserStats/HeatmapDay"]

    classDef notWired stroke:#f80,stroke-dasharray: 5 5
    class types notWired
```

> ⚠️ `firebaseTypes.ts` は型定義だけ存在し、**まだどこのコードからも import されていない**。

---

## 9. 直近のマージ履歴

```mermaid
gitGraph
    commit id: "main 初期"
    commit id: "graph #64"
    branch realtime-bpm
    commit id: "リアルタイムBPM"
    commit id: "ランキングUI"
    checkout main
    merge realtime-bpm tag: "#88"
    commit id: "schema docs #91"
    commit id: "hybrid auth #89"
    branch firestore-sync
    commit id: "Firestore client + Session"
    checkout main
    branch daemon-rtdb
    commit id: "RTDB client + handler 配線"
    checkout main
    merge daemon-rtdb tag: "#94"
    branch dashboard-rtdb
    commit id: "hooks を RTDB に切替"
    checkout main
    branch phase2
    commit id: "SuccessRate / MostPassionate"
    checkout main
    merge phase2 tag: "#93"
```

---

## 10. 推奨アクション（優先順）

```mermaid
flowchart TD
    A["① スキーマ統一の意思決定"] --> B{"daemon を寄せる<br/>or<br/>dashboard を寄せる？"}
    B -->|"daemon を直す<br/>(推奨)"| C["daemon の rtdb.go を改修<br/>/heartbeat/{uid}, camelCase"]
    B -->|"dashboard を直す"| D["firebaseTypes.ts を<br/>snake_case + /users スキーマに修正"]

    C --> E["② dashboard hooks を RTDB に切替<br/>(feature/dashboard-rtdb-sync を活用)"]
    D --> E

    E --> F["③ Firestore コードを削除<br/>(daemon の firebase.go, dashboard の db export)"]
    F --> G["④ /members, /stats, /heatmap の<br/>書き込み実装 (新機能)"]

    G --> H["✅ チームランキング, ヒートマップ,<br/>1v1 対戦が機能する"]

    style A fill:#fee,stroke:#f00
    style E fill:#fef,stroke:#80f
    style H fill:#efe,stroke:#0a0
```

| 優先度 | 作業 | 担当目安 | 工数 |
|:-:|---|---|---|
| 🔴 必須 | ① スキーマ統一の方針決定 | 全員で MTG 30 分 | 0.5h |
| 🔴 必須 | ② dashboard hooks の RTDB 切替 | フロント | 1-2h（既にブランチあり） |
| 🟠 推奨 | ③ Firestore 残骸の削除 | バックエンド or フロント | 1h |
| 🟡 機能拡張 | ④ `/members`, `/stats`, `/heatmap` の daemon 書き込み | バックエンド | 3-4h |

---

## 11. 用語集

| 用語 | 意味 |
|---|---|
| **daemon** | ローカル常駐の Go プロセス。`mise run daemon:run` で起動 |
| **RTDB** | Firebase Realtime Database。JSON ツリー構造、書き込み回数課金なし |
| **Firestore** | Firebase の NoSQL DB。書き込み回数課金あり |
| **`auth_sync`** | dashboard → daemon WS メッセージ。ログイン UID を通知する |
| **Session** | daemon が `auth_sync` で受け取った uid をメモリ保持する仕組み |
| **fail-safe** | credentials 未設定でも crash せず機能を OFF にして起動継続する設計 |
| **fallback** | WS が届かない時に RTDB から読む経路（現在は Firestore を見てしまっている）|

---

## 12. 参考ファイル

| ファイル | 内容 |
|---|---|
| `docs/rtdb-schema.md` | daemon が実際に書く RTDB の形 |
| `docs/firebase-database-design.md` | dashboard 側の想定スキーマ（PR #91） |
| `docs/firebase-schema.json` | Firebase Console にインポートできるサンプル JSON |
| `docs/schema.md` | （古い）Firestore 前提のスキーマ案 |
| `docs/plans/firebase-sync-unified.md` | 統合計画書 |
| `docs/prs/feature-daemon-rtdb-sync.md` | daemon RTDB 側 PR の文案 |
| `docs/prs/feature-dashboard-rtdb-sync.md` | dashboard RTDB 切替 PR の文案 |
