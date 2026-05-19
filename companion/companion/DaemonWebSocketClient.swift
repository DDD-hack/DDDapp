import Foundation
 import Observation
 
 @Observable
 @MainActor
 class DaemonWebSocketClient: NSObject {
     private var task: URLSessionWebSocketTask?
     private var urlSession: URLSession!
     var isConnected = false

     override init() {
         super.init()
         urlSession = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
     }
 
     func connect(host: String, port: Int = 8765) {
         disconnect()
         guard let url = URL(string: "ws://\(host):\(port)/ws") else { return }
         task = urlSession.webSocketTask(with: URLRequest(url: url))
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
         Task { [weak self] in
             do {
                 try await task.send(.string(json))
             } catch {
                 self?.isConnected = false
             }
         }
     }

     private func startReceiveLoop() {
         Task { [weak self] in
             guard let self, let task = self.task else { return }
             do {
                 _ = try await task.receive()
                 self.startReceiveLoop()
             } catch {
                 self.isConnected = false
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
