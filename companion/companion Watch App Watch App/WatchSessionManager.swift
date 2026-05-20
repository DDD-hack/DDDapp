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
        let isReachable = WCSession.default.isReachable
        let activationState = WCSession.default.activationState
        print("[WatchWC] send bpm=\(Int(bpm)) isReachable=\(isReachable) activation=\(activationState.rawValue)")
        let payload: [String: Any] = ["bpm": bpm, "ts": Date().timeIntervalSince1970]
        if isReachable {
            WCSession.default.sendMessage(payload, replyHandler: nil, errorHandler: { error in
                print("[WatchWC] sendMessage失敗(\(error.localizedDescription)) → updateApplicationContextにフォールバック")
                try? WCSession.default.updateApplicationContext(payload)
            })
        } else {
            print("[WatchWC] isReachable=false → updateApplicationContext")
            try? WCSession.default.updateApplicationContext(payload)
        }
    }

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: (any Error)?) {
        print("[WatchWC] activation: \(activationState.rawValue) error=\(error?.localizedDescription ?? "nil")")
    }
}
