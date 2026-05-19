import SwiftUI

@main
struct companion_Watch_App_Watch_AppApp: App {
    @State private var workoutManager = WorkoutManager()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(workoutManager)
        }
    }
}
