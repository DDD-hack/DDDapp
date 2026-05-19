import Foundation
import Observation

@Observable
class DaemonWebSocketClient: NSObject {
    private var task: URLSessionWebSocketTask?
    private var session: URLSession!
    var isConnected = false

    override init() {
        super.init()
        session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
    }

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

    private func startReceiveLoop() {
        task?.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .success:
                Task { @MainActor in self.startReceiveLoop() }
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
