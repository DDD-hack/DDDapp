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
                    healthKitManager.requestAuthorizationIfNeeded()
                    watchManager.onBPMUpdate = { bpm in
                        daemonClient.latestBPM = bpm
                    }
                    healthKitManager.onBPMUpdate = { bpm in
                        guard watchManager.currentBPM == nil else { return }
                        daemonClient.latestBPM = bpm
                    }
                }
        }
    }
}
