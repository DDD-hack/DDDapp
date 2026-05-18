import WatchConnectivity
import Combine

@MainActor
class WatchConnectivityManager: NSObject, ObservableObject {
    @Published var currentBPM: Double? = nil
    @Published var lastUpdated: Date? = nil

    func setup() {
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }
}

extension WatchConnectivityManager: WCSessionDelegate {
    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: (any Error)?) {}

    func sessionDidBecomeInactive(_ session: WCSession) {}
    func sessionDidDeactivate(_ session: WCSession) {
        WCSession.default.activate()
    }

    nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        guard let bpm = message["bpm"] as? Double else { return }
        Task { @MainActor [weak self] in
            self?.currentBPM = bpm
            self?.lastUpdated = Date()
        }
    }
}
