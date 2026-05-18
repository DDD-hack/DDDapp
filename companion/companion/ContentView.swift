import SwiftUI
import HealthKit

struct ContentView: View {
    @EnvironmentObject private var healthKitManager: HealthKitManager

    var body: some View {
        VStack(spacing: 24) {
            heartRateView
            statusView
        }
        .padding()
    }

    // MARK: - BPM表示

    @ViewBuilder
    private var heartRateView: some View {
        VStack(spacing: 8) {
            Image(systemName: "heart.fill")
                .font(.system(size: 48))
                .foregroundStyle(.red)

            if let bpm = healthKitManager.currentBPM {
                Text("\(Int(bpm))")
                    .font(.system(size: 72, weight: .bold, design: .rounded))
                    .foregroundStyle(.primary)
                Text("bpm")
                    .font(.title3)
                    .foregroundStyle(.secondary)
            } else {
                Text("---")
                    .font(.system(size: 72, weight: .bold, design: .rounded))
                    .foregroundStyle(.secondary)
                Text("bpm")
                    .font(.title3)
                    .foregroundStyle(.secondary)
            }

            if let updated = healthKitManager.lastUpdated {
                Text("最終取得: \(updated.formatted(.dateTime.hour().minute().second()))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    // MARK: - ステータス表示

    @ViewBuilder
    private var statusView: some View {
        VStack(spacing: 6) {
            Text(statusText)
                .font(.subheadline)
                .multilineTextAlignment(.center)
                .foregroundStyle(statusColor)

        }
    }

    private var statusText: String {
        if let error = healthKitManager.errorMessage {
            return error
        }
        return healthKitManager.currentBPM == nil
            ? "Apple Watch からのデータ待機中..."
            : "取得中"
    }

    private var statusColor: Color {
        healthKitManager.errorMessage != nil ? .red : .secondary
    }
}

#Preview {
    ContentView()
        .environmentObject(HealthKitManager())
}
