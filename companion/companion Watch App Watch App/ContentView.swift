import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var workoutManager: HeartRateWorkoutManager
    @Environment(DaemonDirectClient.self) private var daemonClient
    @AppStorage("macDaemonHost") private var daemonHost = ""

    var body: some View {
        ScrollView {
            VStack(spacing: 6) {
                Image(systemName: "heart.fill")
                    .foregroundStyle(.red)

                if workoutManager.currentBPM > 0 {
                    Text("\(Int(workoutManager.currentBPM))")
                        .font(.system(size: 48, weight: .bold, design: .rounded))
                    Text("bpm")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    Text("---")
                        .font(.system(size: 48, weight: .bold, design: .rounded))
                        .foregroundStyle(.secondary)
                }

                if let error = workoutManager.errorMessage {
                    Text(error)
                        .font(.system(size: 10))
                        .foregroundStyle(.red)
                        .multilineTextAlignment(.center)
                }

                Divider()

                HStack(spacing: 4) {
                    Circle()
                        .fill(statusColor)
                        .frame(width: 6, height: 6)
                    Text(daemonClient.status.label)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }

                TextField("Mac IP (例: 192.168.0.33)", text: $daemonHost)
                    .font(.caption2)
                    .multilineTextAlignment(.center)

                Button(daemonClient.status == .connected ? "切断" : "接続") {
                    if daemonClient.status == .connected {
                        daemonClient.disconnect()
                    } else {
                        daemonClient.connect(host: daemonHost)
                    }
                }
                .font(.caption)
                .buttonStyle(.borderedProminent)
                .tint(daemonClient.status == .connected ? .gray : .blue)
                .disabled(daemonHost.isEmpty && daemonClient.status != .connected)

                Button("再送信") {
                    workoutManager.forceResend()
                }
                .font(.caption)
                .buttonStyle(.bordered)
                .disabled(workoutManager.currentBPM <= 0)
            }
            .padding(.horizontal, 4)
        }
    }

    private var statusColor: Color {
        switch daemonClient.status {
        case .connected:                 return .green
        case .connecting, .reconnecting: return .orange
        case .disconnected:              return .secondary
        }
    }
}
