import WatchConnectivity
import Combine

@MainActor
class WatchConnectivityManager: NSObject, ObservableObject {
    @Published var currentBPM: Double? = nil
    @Published var lastUpdated: Date? = nil

    override init() {
        super.init()
        // アプリ起動直後にactivateしてメッセージの取りこぼしを防ぐ
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    // onAppearから呼ばれても二重activateにならないよう残す
    func setup() {}

    private func update(bpm: Double) {
        currentBPM = bpm
        lastUpdated = Date()
    }
}

extension WatchConnectivityManager: WCSessionDelegate {
    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: (any Error)?) {}

    func sessionDidBecomeInactive(_ session: WCSession) {}
    func sessionDidDeactivate(_ session: WCSession) {
        WCSession.default.activate()
    }

    // sendMessage で受信（フォアグラウンド時）
    nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        guard let bpm = message["bpm"] as? Double else { return }
        Task { @MainActor [weak self] in self?.update(bpm: bpm) }
    }

    // transferUserInfo で受信（バックグラウンド・ロック時）
    nonisolated func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any]) {
        guard let bpm = userInfo["bpm"] as? Double else { return }
        Task { @MainActor [weak self] in self?.update(bpm: bpm) }
    }
}
