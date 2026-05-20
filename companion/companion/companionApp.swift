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
@                    #if DEBUG
                    print("[App] onAppear: コールバック登録")
                    #endif
                    healthKitManager.requestAuthorizationIfNeeded()
                    watchManager.onBPMUpdate = { bpm in
                        #if DEBUG
                        print("[App] watchManager.onBPMUpdate → daemonClient.latestBPM=\(Int(bpm))")
                        #endif
                        daemonClient.latestBPM = bpm
                    }
                    healthKitManager.onBPMUpdate = { bpm in
                        guard watchManager.currentBPM == nil else {
                            #if DEBUG
                            print("[App] healthKitManager.onBPMUpdate → watchBPMあり(\(Int(watchManager.currentBPM!)))なのでスキップ")
                            #endif
                            return
                        }
                        #if DEBUG
                        print("[App] healthKitManager.onBPMUpdate → daemonClient.latestBPM=\(Int(bpm))")
                        #endif
                        daemonClient.latestBPM = bpm
                    }
                }
        }
    }
}
