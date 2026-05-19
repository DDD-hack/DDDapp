import SwiftUI

struct ContentView: View {
    @Environment(PhoneConnectivityManager.self) private var connectivity
    @Environment(DaemonWebSocketClient.self) private var daemonClient

    @AppStorage("daemonHost") private var daemonHost = "192.168.1.1"

    var body: some View {
        NavigationStack {
            Form {
                Section("Daemon 接続先") {
                    HStack {
                        TextField("IP アドレス", text: $daemonHost)
                            .keyboardType(.decimalPad)
                            .autocorrectionDisabled()
                        Spacer()
                        Button(daemonClient.isConnected ? "切断" : "接続") {
                            if daemonClient.isConnected {
                                daemonClient.disconnect()
                            } else {
                                daemonClient.connect(host: daemonHost)
                            }
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(daemonClient.isConnected ? .gray : .blue)
                    }
                }

                Section("Apple Watch") {
                    HStack {
                        Text("Watch")
                        Spacer()
                        Text(connectivity.isWatchReachable ? "接続中" : "未接続")
                            .foregroundStyle(connectivity.isWatchReachable ? .green : .secondary)
                    }
                    HStack {
                        Text("心拍数")
                        Spacer()
                        if connectivity.latestBPM > 0 {
                            Text("\(connectivity.latestBPM) BPM")
                                .foregroundStyle(.red)
                                .fontWeight(.bold)
                        } else {
                            Text("--")
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                Section("ステータス") {
                    HStack {
                        Text("Daemon")
                        Spacer()
                        Text(daemonClient.isConnected ? "接続中" : "未接続")
                            .foregroundStyle(daemonClient.isConnected ? .green : .secondary)
                    }
                }
            }
            .navigationTitle("DDD Companion")
        }
    }
}

#Preview {
    ContentView()
        .environment(PhoneConnectivityManager())
        .environment(DaemonWebSocketClient())
}
