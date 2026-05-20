import WatchConnectivity
import Combine

@MainActor
final class WatchConnectivityManager: ObservableObject {
    private(set) var currentBPM: Double? = nil
    private(set) var lastUpdated: Date? = nil

    var onBPMUpdate: ((Double) -> Void)?

    private let sessionHandler = WCSessionHandler()

    init() {
        sessionHandler.onBPMReceived = { [weak self] bpm in
            Task { @MainActor in
                guard let self else { return }
                self.objectWillChange.send()
                self.currentBPM = bpm
                self.lastUpdated = Date()
                print("[WatchManager] onBPMReceived → bpm=\(Int(bpm)) onBPMUpdate=\(self.onBPMUpdate != nil ? "set" : "nil❌")")
                self.onBPMUpdate?(bpm)
            }
        }
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = sessionHandler
        WCSession.default.activate()
    }
}

private final class WCSessionHandler: NSObject, WCSessionDelegate {
    var onBPMReceived: ((Double) -> Void)?

    func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: (any Error)?) {
        print("[WC] activation: \(state.rawValue) error=\(error?.localizedDescription ?? "nil")")
    }
    func sessionDidBecomeInactive(_ session: WCSession) { print("[WC] sessionDidBecomeInactive") }
    func sessionDidDeactivate(_ session: WCSession) {
        print("[WC] sessionDidDeactivate → reactivate")
        WCSession.default.activate()
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        print("[WC] ✅ didReceiveMessage (即時) bpm=\(message["bpm"] ?? "nil")")
        guard let bpm = message["bpm"] as? Double else {
            print("[WC] ⚠️ didReceiveMessage: bpmのキャスト失敗 type=\(type(of: message["bpm"]))")
            return
        }
        onBPMReceived?(bpm)
    }

    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any]) {
        print("[WC] 🟡 didReceiveUserInfo (キュー経由) bpm=\(userInfo["bpm"] ?? "nil")")
        guard let bpm = userInfo["bpm"] as? Double else {
            print("[WC] ⚠️ didReceiveUserInfo: bpmのキャスト失敗 type=\(type(of: userInfo["bpm"]))")
            return
        }
        onBPMReceived?(bpm)
    }
}
