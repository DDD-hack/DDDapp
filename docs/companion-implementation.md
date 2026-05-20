# companion アプリ 実装解説

## 全体アーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│                      Apple Watch                            │
│  HealthKit (HKLiveWorkoutBuilder)                           │
│    ↓ リアルタイム心拍（ワークアウト中のみ）                     │
│  HeartRateWorkoutManager                                    │
│    ↓ onBPMUpdate コールバック                                │
│  WatchSessionManager ──(sendMessage)──→  WatchConnectivity  │
│  DaemonDirectClient ──(WebSocket)──→ Mac daemon (直接)       │
└─────────────────────────────────────────────────────────────┘
                              ↓ WatchConnectivity
┌─────────────────────────────────────────────────────────────┐
│                        iPhone                               │
│  WatchConnectivityManager                                   │
│    ↓ onBPMUpdate コールバック                                │
│  DaemonWebSocketClient ──(WebSocket ws://host:8765/ws)──→   │
│                                       Mac daemon            │
│                                                             │
│  HealthKitManager（バックアップ）                             │
│    Watch→iPhone HealthKit 同期経由で取得（遅延あり）           │
└─────────────────────────────────────────────────────────────┘
```

メインの経路は **Watch → WatchConnectivity → iPhone → WebSocket → daemon** です。`DaemonDirectClient`（Watch 直接接続）と `HealthKitManager`（HealthKit 同期）はバックアップ経路として機能します。

---

## Watch アプリ

### HeartRateWorkoutManager

`HKWorkoutSession` + `HKLiveWorkoutBuilder` を使ってリアルタイム心拍を取得します。

**なぜ HKWorkoutSession が必要か**

Apple Watch で心拍をリアルタイムに取得するには、アクティブなワークアウトセッションが必要です。`HKObserverQuery` だけでは数分単位の遅延が発生します。ワークアウトセッション中は Watch がセンサーを継続的に動かし続け、`HKLiveWorkoutBuilder` のデリゲートに秒単位で値が届きます。

```swift
// toShare に workoutType を含めることが必須
// これがないとセッション作成が失敗する
let shareTypes: Set<HKSampleType> = [HKObjectType.workoutType()]
store.requestAuthorization(toShare: shareTypes, read: types)
```

**データ受信の流れ**

```
session.startActivity()
  → delegate: didChangeTo .running
  → builder.beginCollection() 開始
  → センサー計測スタート（数秒〜十数秒かかる）
  → workoutBuilder(_:didCollectDataOf:) が毎秒呼ばれる
  → currentBPM 更新 → onBPMUpdate コールバック発火
```

起動直後は `currentBPM == 0` のため UI に "---" が表示されますが、センサーが安定するまでの正常な状態です。

`keepAliveTimer`（1秒間隔）は、新しい値が来なくても定期的に最後の値を再送するための仕組みです。Watch を外した後など一時的にデータが止まっても、最後の値を送り続けます。

---

### WatchSessionManager

Watch 側の WatchConnectivity 送信担当です。

```swift
func send(bpm: Double) {
    if isReachable {
        WCSession.default.sendMessage(...)  // 即時送信（iPhone フォアグラウンド時）
    } else {
        WCSession.default.transferUserInfo(...)  // キュー送信（遅延あり）
    }
}
```

**sendMessage と transferUserInfo の使い分け**

| メソッド | 条件 | 遅延 |
|---------|------|------|
| `sendMessage` | iPhone アプリがフォアグラウンドで `isReachable = true` | ほぼ即時（〜1秒） |
| `transferUserInfo` | 常に使用可能 | 数秒〜数十秒（キュー処理） |

`sendMessage` が失敗した場合（iPhone がバックグラウンドなど）は `errorHandler` で `transferUserInfo` にフォールバックします。

**WatchConnectivity が安定して動く条件**

- Watch と iPhone が **同じ WiFi ネットワーク**に接続されていること（WiFi 経由になり信頼性が上がる）
- iPhone アプリが起動していること（バックグラウンドでも動くが、フォアグラウンドが最安定）
- `WCSession.default.activate()` が両端で呼ばれていること

---

### DaemonDirectClient

Watch から Mac daemon に直接 WebSocket 接続するクライアントです。WatchConnectivity を介さないため、iPhone アプリの状態に依存しない独立した経路になります。

```
Watch WiFi → Mac IP:8765/ws（WebSocket）
```

**接続条件**: Watch と Mac が **同じ WiFi ネットワーク**に接続されている必要があります。Personal Hotspot 経由（Watch が Bluetooth で iPhone に繋ぎ、iPhone がテザリングで Mac と接続）の構成では Watch から Mac へのルーティングが通らず接続できません。

自動再接続は exponential backoff（1秒→2秒→4秒…最大 60 秒）で実装されています。接続後は 1 秒間隔のタイマーで最新 BPM を送信します。

---

## iPhone アプリ

### WatchConnectivityManager

Watch から受信した BPM を `DaemonWebSocketClient` に渡す橋渡し役です。

`WCSessionDelegate` の実装を内部クラス `WCSessionHandler` に分離しているのは、`@MainActor` 制約と `NSObject` 継承の組み合わせによるコンパイルエラーを避けるためです。

```swift
@MainActor
final class WatchConnectivityManager: ObservableObject {
    // @MainActor をつけたいが、WCSessionDelegate は非 MainActor で呼ばれる
    private let sessionHandler = WCSessionHandler()  // 内部クラスに分離
}
```

受信経路は2種類あり、どちらも同じ `onBPMReceived` コールバックに集約されます：

- `didReceiveMessage`：`sendMessage` 経由（即時）
- `didReceiveUserInfo`：`transferUserInfo` 経由（キュー）

---

### HealthKitManager

Watch からの WatchConnectivity が届かない場合のバックアップです。iPhone の HealthKit に同期された心拍データを取得します。

**同期遅延について**

HealthKit の Watch→iPhone 同期はバッチ処理で行われます。特に iOS/watchOS ベータ版では遅延が大きく（数十秒〜数分）、リアルタイム送信には適していません。

このため `companionApp.swift` でフォールバック制御をしています：

```swift
healthKitManager.onBPMUpdate = { bpm in
    guard watchManager.currentBPM == nil else { return }  // Watch から値が来ていれば無視
    daemonClient.latestBPM = bpm
}
```

Watch 経由の値がある場合は HealthKit の値を捨て、Watch 直接値を優先します。

`fetchLatestSample()` は UI の「更新」ボタンからも手動で呼べます。また 2 秒ポーリングタイマーが内部で動いており、HealthKit への新しいサンプル到着を検出します。

---

### DaemonWebSocketClient

iPhone から Mac daemon への WebSocket クライアントです。Watch から受け取った BPM を 1 秒ごとに daemon に送信します。

```
iPhone WiFi → ws://192.168.x.x:8765/ws
```

`latestBPM` に値をセットすると、内部の 1 秒タイマーが自動的に daemon に送信します。接続が切れた場合は自動再接続します。

---

### ContentView（iPhone）

BPM の表示源は優先順位付きで決定されます：

```swift
private var bpm: Double? {
    watchManager.currentBPM ?? healthKitManager.currentBPM
}
```

Watch 経由の値が `nil`（未受信）の場合のみ HealthKit の値にフォールバックします。

---

## ネットワーク要件

| 経路 | 必要な条件 |
|------|-----------|
| Watch → iPhone（WatchConnectivity） | Watch・iPhone のペアリング、双方でアプリ起動 |
| iPhone → Mac daemon（WebSocket） | 同じ WiFi ネットワーク |
| Watch → Mac daemon（DaemonDirectClient） | Watch・Mac が同じ WiFi ネットワーク |

**推奨構成**: Mac・iPhone・Watch 全て同じ WiFi ルーターに接続。Personal Hotspot 構成では Watch → Mac 直接接続が利用不可。

---

## デモ用スクリプト

実機 Watch が使えない場合は daemon に直接 BPM を注入できます：

```bash
./scripts/demo.sh high   # 130bpm 送信ループ（git commit 許可状態）
./scripts/demo.sh low    # 60bpm 送信ループ（git commit 拒否状態）
```
