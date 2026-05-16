//
//  ContentView.swift
//  companion
//
//  Created by 乙津孝太朗 on 2026/05/17.
//

import SwiftUI
import HealthKit

struct ContentView: View {
    @EnvironmentObject private var healthKitManager: HealthKitManager

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "heart.fill")
                .imageScale(.large)
                .foregroundStyle(.red)

            Text(statusText)
                .multilineTextAlignment(.center)

            if let error = healthKitManager.errorMessage {
                Text(error)
                    .foregroundStyle(.red)
                    .font(.caption)
                    .multilineTextAlignment(.center)
            }
        }
        .padding()
    }

    private var statusText: String {
        switch healthKitManager.authStatus {
        case .sharingAuthorized:
            return "HealthKit: 許可済み"
        case .sharingDenied:
            return "HealthKit: 拒否されました\n設定アプリから許可してください"
        case .notDetermined:
            return "HealthKit: 権限確認中..."
        @unknown default:
            return "HealthKit: 不明な状態"
        }
    }
}

#Preview {
    ContentView()
        .environmentObject(HealthKitManager())
}
