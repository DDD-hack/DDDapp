import Combine
import HealthKit

@MainActor
class HealthKitManager: ObservableObject {
    private let store = HKHealthStore()
    private let heartRateType = HKQuantityType(.heartRate)

    @Published var authStatus: HKAuthorizationStatus = .notDetermined
    @Published var errorMessage: String? = nil

    func requestAuthorizationIfNeeded() {
        guard HKHealthStore.isHealthDataAvailable() else {
            errorMessage = "このデバイスはHealthKitに対応していません"
            return
        }

        let currentStatus = store.authorizationStatus(for: heartRateType)
        guard currentStatus == .notDetermined else {
            authStatus = currentStatus
            return
        }

        Task {
            do {
                try await store.requestAuthorization(toShare: [], read: [heartRateType])
                authStatus = store.authorizationStatus(for: heartRateType)
            } catch {
                errorMessage = "HealthKit認証に失敗しました: \(error.localizedDescription)"
            }
        }
    }
}
