import SwiftUI
import WatchConnectivity

@main
struct companion_Watch_App_Watch_AppApp: App {
    @StateObject private var workoutManager = WorkoutManager()

    init() {
        if WCSession.isSupported() {
            WCSession.default.delegate = _workoutManager.wrappedValue
            WCSession.default.activate()
        }
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(workoutManager)
        }
    }
}
