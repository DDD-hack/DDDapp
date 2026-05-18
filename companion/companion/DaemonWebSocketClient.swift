import Foundation

@MainActor
class DaemonWebSocketClient: NSObject, ObservableObject {
    private var task: URLSessionWebSocketTask?
    private lazy var session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
    @Published var isConnected = false

    func connect(host: String, port: Int = 8765) {
        disconnect()
        guard let url = URL(string: "ws://\(host):\(port)/ws") else { return }
        task = session.webSocketTask(with: URLRequest(url: url))
        task?.resume()
        startReceiveLoop()
    }

    func disconnect() {
        task?.cancel(with: .normalClosure, reason: nil)
        task = nil
        isConnected = false
    }

    func send(bpm: Int) {
        guard let task else { return }
        let payload: [String: Any] = [
            "bpm": bpm,
            "timestamp": ISO8601DateFormatter().string(from: Date())
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return }
        task.send(.string(json)) { [weak self] error in
            if error != nil {
                Task { @MainActor in self?.isConnected = false }
            }
        }
    }

    // サーバ起点の切断を検知するための受信ループ
    private func startReceiveLoop() {
        task?.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .success:
                self.startReceiveLoop()
            case .failure:
                Task { @MainActor in self.isConnected = false }
            }
        }
    }
}

extension DaemonWebSocketClient: URLSessionWebSocketDelegate {
    nonisolated func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        Task { @MainActor in self.isConnected = true }
    }

    nonisolated func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        Task { @MainActor in self.isConnected = false }
    }
}
