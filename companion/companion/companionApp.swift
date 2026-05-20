import SwiftUI

@main
struct companionApp: App {
    @StateObject private var watchManager = WatchConnectivityManager()
    @StateObject private var healthKitManager = HealthKitManager()
    @State private var daemonClient = DaemonWebSocketClient()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(watchManager)
                .environmentObject(healthKitManager)
                .environment(daemonClient)
                .onAppear {
                    print("[App] onAppear: コールバック登録")
                    healthKitManager.requestAuthorizationIfNeeded()
                    watchManager.onBPMUpdate = { bpm in
                        print("[App] watchManager.onBPMUpdate → daemonClient.latestBPM=\(Int(bpm))")
                        daemonClient.latestBPM = bpm
                    }
                    healthKitManager.onBPMUpdate = { bpm in
                        guard watchManager.currentBPM == nil else {
                            print("[App] healthKitManager.onBPMUpdate → watchBPMあり(\(Int(watchManager.currentBPM!)))なのでスキップ")
                            return
                        }
                        print("[App] healthKitManager.onBPMUpdate → daemonClient.latestBPM=\(Int(bpm))")
                        daemonClient.latestBPM = bpm
                    }
                }
        }
    }
}
