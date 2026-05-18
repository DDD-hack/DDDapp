//
//  companion_Watch_AppApp.swift
//  companion Watch App Watch App
//
//  Created by 乙津孝太朗 on 2026/05/17.
//

import SwiftUI

@main
struct companion_Watch_App_Watch_AppApp: App {
    @StateObject private var workoutManager = HeartRateWorkoutManager()

    init() {
        WatchSessionManager.shared.setup()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(workoutManager)
                .onAppear {
                    workoutManager.requestAuthorizationAndStart()
                }
        }
    }
}
