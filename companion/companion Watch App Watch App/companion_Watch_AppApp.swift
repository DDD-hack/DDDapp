import SwiftUI

@main
struct companion_Watch_App_Watch_AppApp: App {
    @StateObject private var workoutManager = HeartRateWorkoutManager()
    @State private var daemonClient = DaemonDirectClient()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(workoutManager)
                .environment(daemonClient)
                .onAppear {
                    WatchSessionManager.shared.setup()
                    workoutManager.requestAuthorizationAndStart()
                    workoutManager.onBPMUpdate = { bpm in
                        // WatchConnectivity 経由で iPhone に送信（iPhone → daemon の流れに乗る）
                        WatchSessionManager.shared.send(bpm: bpm)
                        // WiFi 直接接続できていれば daemon にも直送
                        daemonClient.latestBPM = bpm
                    }
                }
        }
    }
}
