//
//  companionApp.swift
//  companion
//
//  Created by 乙津孝太朗 on 2026/05/17.
//

import SwiftUI

@main
struct companionApp: App {
    @StateObject private var watchManager = WatchConnectivityManager()
    @StateObject private var healthKitManager = HealthKitManager()

    init() {
        // WatchConnectivity を最優先でセットアップ
        // HealthKit はWatch未接続時のフォールバック
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(watchManager)
                .environmentObject(healthKitManager)
                .onAppear {
                    watchManager.setup()
                    healthKitManager.requestAuthorizationIfNeeded()
                }
        }
    }
}
