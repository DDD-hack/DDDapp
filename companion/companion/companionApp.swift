import SwiftUI

@main
struct companionApp: App {
    @StateObject private var connectivity = PhoneConnectivityManager()
    @StateObject private var daemonClient = DaemonWebSocketClient()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(connectivity)
                .environmentObject(daemonClient)
                .onAppear {
                    connectivity.onBPMReceived = { bpm in
                        daemonClient.send(bpm: bpm)
                    }
                }
        }
    }
}
