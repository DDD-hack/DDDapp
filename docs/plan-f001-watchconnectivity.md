# F001 リアルタイム心拍取得 — WatchConnectivity 実装計画

> 作成日: 2026-05-18  
> 対象ブランチ: `feature/f001-heartrate-monitor`  
> 関連 issue: #7, #8

---

## なぜ WatchConnectivity が必要か

| 方式 | 遅延 | 理由 |
|---|---|---|
| iPhone が HealthKit をポーリング（現状） | 約3分 | Apple Watch → iPhone の HealthKit 同期間隔が長い |
| **Watch アプリ → WatchConnectivity → iPhone** | **約1秒** | Watch が直接センサーを読みリアルタイム送信 |

---

## アーキテクチャ

```
Apple Watch アプリ
  └── HKWorkoutSession（センサーを常時 ON）
       └── HKLiveWorkoutBuilder
            └── 心拍データ更新（~1Hz）
                 └── WCSession.sendMessage(["bpm": 72.0])
                          │
                          │ WatchConnectivity（Wi-Fi / Bluetooth）
                          │
iPhone アプリ
  └── WCSessionDelegate.didReceiveMessage
       └── currentBPM を更新 → UI 反映
            └── (次の issue #8) WebSocket で PC へ 1Hz 送信
```

---

## ファイル構成

### 新規作成（Watch アプリ側）

```
companion/companion Watch App Watch App/
  ├── HeartRateWorkoutManager.swift   # HKWorkoutSession + 心拍取得
  ├── WatchSessionManager.swift       # WCSession でiPhoneへ送信
  └── ContentView.swift               # BPM デバッグ表示（更新）
```

### 新規作成（iPhone アプリ側）

```
companion/companion/
  └── WatchConnectivityManager.swift  # WCSession でWatch から受信
```

### 変更（iPhone アプリ側）

```
companion/companion/
  ├── HealthKitManager.swift          # フォールバック用として残す（簡略化）
  ├── ContentView.swift               # WatchConnectivityManager を参照
  └── companionApp.swift              # WatchConnectivityManager を初期化
```

---

## タスク一覧

### Watch アプリ側

- [ ] **T1** WCSession セットアップ（`WatchSessionManager.swift`）
- [ ] **T2** HKWorkoutSession 開始ロジック（`HeartRateWorkoutManager.swift`）
- [ ] **T3** HKLiveWorkoutBuilder で心拍を購読・BPM 抽出
- [ ] **T4** WCSession.sendMessage で iPhone へ送信（1Hz タイマー）
- [ ] **T5** Watch の ContentView をデバッグ UI に更新
- [ ] **T6** Watch アプリ起動時に自動でワークアウト開始

### iPhone アプリ側

- [ ] **T7** WCSession セットアップ（`WatchConnectivityManager.swift`）
- [ ] **T8** didReceiveMessage で BPM 受信・@Published 更新
- [ ] **T9** companionApp に WatchConnectivityManager を追加
- [ ] **T10** ContentView を WatchConnectivityManager に切り替え
- [ ] **T11** HealthKitManager をフォールバック（Watch未接続時）として整理

### ビルド・テスト

- [ ] **T12** Watch アプリのシミュレータビルド確認
- [ ] **T13** iPhone 実機 + Apple Watch 実機での通しテスト

---

## 各タスクの詳細

### T1: WatchSessionManager.swift（Watch側）

```swift
// WCSession を activate し、iPhone へメッセージ送信
class WatchSessionManager: NSObject, WCSessionDelegate, ObservableObject {
    static let shared = WatchSessionManager()

    func setup() {
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    func send(bpm: Double) {
        guard WCSession.default.isReachable else { return }
        WCSession.default.sendMessage(["bpm": bpm], replyHandler: nil)
    }
}
```

### T2-T3: HeartRateWorkoutManager.swift（Watch側）

```swift
// HKWorkoutSession でセンサーを常時 ON にして心拍を取得
class HeartRateWorkoutManager: NSObject, ObservableObject {
    private let store = HKHealthStore()
    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?

    @Published var currentBPM: Double = 0

    func startWorkout() {
        // WorkoutConfiguration（心拍計測用途に Other を使用）
        let config = HKWorkoutConfiguration()
        config.activityType = .other

        session = try? HKWorkoutSession(healthStore: store, configuration: config)
        builder = session?.associatedWorkoutBuilder()
        builder?.dataSource = HKLiveWorkoutDataSource(healthStore: store, workoutConfiguration: config)
        builder?.delegate = self

        session?.startActivity(with: Date())
        builder?.beginCollection(withStart: Date()) { _, _ in }
    }
}

// HKLiveWorkoutBuilderDelegate で心拍更新を受け取る
extension HeartRateWorkoutManager: HKLiveWorkoutBuilderDelegate {
    func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}

    func workoutBuilder(_ builder: HKLiveWorkoutBuilder, didCollectDataOf types: Set<HKSampleType>) {
        guard types.contains(HKQuantityType(.heartRate)) else { return }

        let stats = builder.statistics(for: HKQuantityType(.heartRate))
        let bpm = stats?.mostRecentQuantity()?.doubleValue(for: HKUnit(from: "count/min")) ?? 0
        DispatchQueue.main.async {
            self.currentBPM = bpm
            WatchSessionManager.shared.send(bpm: bpm)
        }
    }
}
```

### T4: 1Hz タイマー送信

`didCollectDataOf` は心拍測定のたびに呼ばれる（~1Hz）ので追加タイマーは不要。  
ただし測定が途切れた場合の保険として最後の値を5秒ごとに再送する。

```swift
// HeartRateWorkoutManager 内
private var heartbeatTimer: Timer?

func startKeepAliveTimer() {
    heartbeatTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
        guard let self, self.currentBPM > 0 else { return }
        WatchSessionManager.shared.send(bpm: self.currentBPM)
    }
}
```

### T7-T8: WatchConnectivityManager.swift（iPhone側）

```swift
class WatchConnectivityManager: NSObject, WCSessionDelegate, ObservableObject {
    @Published var currentBPM: Double? = nil
    @Published var lastUpdated: Date? = nil

    func setup() {
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    // Watch から受信
    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        guard let bpm = message["bpm"] as? Double else { return }
        DispatchQueue.main.async {
            self.currentBPM = bpm
            self.lastUpdated = Date()
        }
    }
}
```

---

## 完了条件

- [ ] Apple Watch アプリ起動 → 自動でワークアウト開始（ユーザー操作不要）
- [ ] iPhone アプリで BPM がリアルタイムに表示される（遅延1秒以内）
- [ ] Apple Watch を腕から外す → 数秒以内に `---` 表示に戻る
- [ ] iPhone をバックグラウンドにしても受信し続ける（issue #8 の WebSocket 送信に必要）

---

## 注意事項

- `HKWorkoutSession` は実機のみ動作（シミュレータ不可）
- Watch アプリのビルドターゲットを `companion Watch App Watch App` に切り替えてビルド
- Watch と iPhone が **同じ Apple ID** でペアリングされていること
- `WCSession.isReachable` は iPhone アプリが foreground のときのみ `true`  
  → background 受信は `transferUserInfo` を使う必要があるが MVP では foreground 前提で OK
- HealthKit の Workout 権限を Watch の entitlements にも追加が必要な場合あり

---

## 実装優先順位

```
T1 → T2 → T3 → T7 → T8 → T9 → T10   // コアフロー（これだけで動く）
T4 → T5 → T6 → T11 → T12 → T13      // 品質向上・テスト
```
