import Foundation

@MainActor
class DaemonWebSocketClient: ObservableObject {
    private var task: URLSessionWebSocketTask?
    @Published var isConnected = false

    func connect(host: String, port: Int = 8765) {
        disconnect()
        guard let url = URL(string: "ws://\(host):\(port)/ws") else { return }
        task = URLSession.shared.webSocketTask(with: URLRequest(url: url))
        task?.resume()
        isConnected = true
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
}
