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
                self.objectWillChange.send()   // @Published合成に頼らず明示的に通知
                self.currentBPM = bpm
                self.lastUpdated = Date()
                self.onBPMUpdate?(bpm)
                print("[Watch] received bpm=\(Int(bpm))")
            }
        }
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = sessionHandler
        WCSession.default.activate()
    }
}

private final class WCSessionHandler: NSObject, WCSessionDelegate {
    var onBPMReceived: ((Double) -> Void)?

    func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: (any Error)?) {}
    func sessionDidBecomeInactive(_ session: WCSession) {}
    func sessionDidDeactivate(_ session: WCSession) { WCSession.default.activate() }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        guard let bpm = message["bpm"] as? Double else { return }
        onBPMReceived?(bpm)
    }

    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any]) {
        guard let bpm = userInfo["bpm"] as? Double else { return }
        onBPMReceived?(bpm)
    }
}
