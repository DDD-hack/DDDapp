import SwiftUI

@main
struct companionApp: App {
    @State private var connectivity = PhoneConnectivityManager()
    @State private var daemonClient = DaemonWebSocketClient()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(connectivity)
                .environment(daemonClient)
                .onAppear {
                    connectivity.onBPMReceived = { bpm in
                        daemonClient.send(bpm: bpm)
                    }
                }
        }
    }
}
