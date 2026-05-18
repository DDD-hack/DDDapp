import Combine
import WatchConnectivity

class WatchSessionManager: NSObject, WCSessionDelegate, ObservableObject {
    static let shared = WatchSessionManager()

    func setup() {
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    func send(bpm: Double) {
        let payload: [String: Any] = ["bpm": bpm, "ts": Date().timeIntervalSince1970]
        if WCSession.default.isReachable {
            // iPhoneアプリがフォアグラウンド → 即時送信
            WCSession.default.sendMessage(payload, replyHandler: nil, errorHandler: { [weak self] _ in
                // 送信失敗時はキューに積む
                WCSession.default.transferUserInfo(payload)
                _ = self // suppress warning
            })
        } else {
            // バックグラウンド・画面ロック時 → キュー経由で配信
            WCSession.default.transferUserInfo(payload)
        }
    }

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: (any Error)?) {}
}
