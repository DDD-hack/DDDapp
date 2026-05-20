import Foundation
import Observation

@Observable
class DaemonWebSocketClient: NSObject {
    enum Status {
        case disconnected, connecting, connected, reconnecting
        var label: String {
            switch self {
            case .disconnected:  return "未接続"
            case .connecting:    return "接続中..."
            case .connected:     return "接続済み"
            case .reconnecting:  return "再接続中..."
            }
        }
    }

    var status: Status = .disconnected

    private var task: URLSessionWebSocketTask?
    private var urlSession: URLSession!
    private var sendTimer: Timer?
    private var reconnectTimer: Timer?
    private var reconnectDelay: TimeInterval = 1.0
    private var currentHost: String = ""
    private var currentPort: Int = 8765

    var latestBPM: Double? = nil

    override init() {
        super.init()
        urlSession = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
    }

    func connect(host: String, port: Int = 8765) {
        currentHost = host
        currentPort = port
        reconnectDelay = 1.0
        reconnectTimer?.invalidate()
        reconnectTimer = nil
        openConnection()
    }

    func disconnect() {
        reconnectTimer?.invalidate()
        reconnectTimer = nil
        stopSendTimer()
        task?.cancel(with: .normalClosure, reason: nil)
        task = nil
        status = .disconnected
        print("[Daemon] disconnected")
    }

    private func openConnection() {
        guard !currentHost.isEmpty,
              let url = URL(string: "ws://\(currentHost):\(currentPort)/ws") else { return }
        print("[Daemon] connecting to \(url)")
        status = .connecting
        task = urlSession.webSocketTask(with: url)
        task?.resume()
        listenForClose()
    }

    private func scheduleReconnect() {
        guard status != .disconnected else { return }
        print("[Daemon] reconnecting in \(Int(reconnectDelay))s...")
        status = .reconnecting
        stopSendTimer()
        reconnectTimer = Timer.scheduledTimer(withTimeInterval: reconnectDelay, repeats: false) { [weak self] _ in
            guard let self else { return }
            Task { @MainActor in
                self.reconnectDelay = min(self.reconnectDelay * 2, 60.0)
                self.openConnection()
            }
        }
    }

    private func startSendTimer() {
        sendTimer?.invalidate()
        sendTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            guard let self else { return }
            Task { @MainActor in self.sendLatestBPM() }
        }
    }

    private func stopSendTimer() {
        sendTimer?.invalidate()
        sendTimer = nil
    }

    private func sendLatestBPM() {
        guard let bpm = latestBPM else {
            print("[Daemon] ⚠️ sendLatestBPM: latestBPM=nil (WatchConnectivityから値未受信)")
            return
        }
        guard status == .connected else {
            print("[Daemon] ⚠️ sendLatestBPM: status=\(status.label) (未接続)")
            return
        }
        guard let task else {
            print("[Daemon] ⚠️ sendLatestBPM: task=nil")
            return
        }
        let payload: [String: Any] = [
            "bpm": Int(bpm),
            "timestamp": ISO8601DateFormatter().string(from: Date())
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return }
        print("[Daemon] ✅ sent bpm=\(Int(bpm))")
        task.send(.string(json)) { [weak self] error in
            guard let self, error != nil else { return }
            print("[Daemon] send error: \(error!)")
            Task { @MainActor in self.scheduleReconnect() }
        }
    }

    private func listenForClose() {
        task?.receive { [weak self] result in
            guard let self else { return }
            if case .failure(let error) = result {
                print("[Daemon] connection lost: \(error)")
                Task { @MainActor in self.scheduleReconnect() }
            } else {
                Task { @MainActor in self.listenForClose() }
            }
        }
    }
}

extension DaemonWebSocketClient: URLSessionWebSocketDelegate {
    nonisolated func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        print("[Daemon] connected ✅")
        Task { @MainActor in
            self.status = .connected
            self.reconnectDelay = 1.0
            self.startSendTimer()
        }
    }

    nonisolated func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        print("[Daemon] closed (code=\(closeCode.rawValue))")
        Task { @MainActor in self.scheduleReconnect() }
    }
}
