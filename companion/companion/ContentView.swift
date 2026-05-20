import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var watchManager: WatchConnectivityManager
    @EnvironmentObject private var healthKitManager: HealthKitManager
    @Environment(DaemonWebSocketClient.self) private var daemonClient

    @AppStorage("daemonHost") private var daemonHost = "192.168.1.1"

    private var bpm: Double? { watchManager.currentBPM ?? healthKitManager.currentBPM }
    private var lastUpdated: Date? { watchManager.lastUpdated ?? healthKitManager.lastUpdated }

    var body: some View {
        VStack(spacing: 24) {
            heartRateView
            daemonView
        }
        .padding()
    }

    @ViewBuilder
    private var heartRateView: some View {
        VStack(spacing: 8) {
            Image(systemName: "heart.fill")
                .font(.system(size: 48))
                .foregroundStyle(.red)

            if let bpm {
                Text("\(Int(bpm))")
                    .font(.system(size: 72, weight: .bold, design: .rounded))
                Text("bpm")
                    .font(.title3)
                    .foregroundStyle(.secondary)
            } else {
                Text("---")
                    .font(.system(size: 72, weight: .bold, design: .rounded))
                    .foregroundStyle(.secondary)
                Text("bpm")
                    .font(.title3)
                    .foregroundStyle(.secondary)
            }

            if let updated = lastUpdated {
                Text("最終取得: \(updated.formatted(.dateTime.hour().minute().second()))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Button {
                healthKitManager.fetchLatestSample()
            } label: {
                Label("更新", systemImage: "arrow.clockwise")
                    .font(.caption)
            }
            .buttonStyle(.bordered)
        }
    }

    @ViewBuilder
    private var daemonView: some View {
        VStack(spacing: 12) {
            HStack {
                TextField("Daemon IP", text: $daemonHost)
                    .keyboardType(.decimalPad)
                    .autocorrectionDisabled()
                    .textFieldStyle(.roundedBorder)

                Button(daemonClient.status == .connected ? "切断" : "接続") {
                    if daemonClient.status == .connected {
                        daemonClient.disconnect()
                    } else {
                        daemonClient.connect(host: daemonHost)
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(daemonClient.status == .connected ? .gray : .blue)
            }

            HStack {
                Circle()
                    .fill(statusColor)
                    .frame(width: 8, height: 8)
                Text("Daemon: \(daemonClient.status.label)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
            }
        }
        .padding(.horizontal, 4)
    }

    private var statusColor: Color {
        switch daemonClient.status {
        case .connected:                 return .green
        case .connecting, .reconnecting: return .orange
        case .disconnected:              return .secondary
        }
    }
}

#Preview {
    ContentView()
        .environmentObject(WatchConnectivityManager())
        .environmentObject(HealthKitManager())
        .environment(DaemonWebSocketClient())
}
