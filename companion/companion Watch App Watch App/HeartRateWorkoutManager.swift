import Combine
import HealthKit

class HeartRateWorkoutManager: NSObject, ObservableObject {
    private let store = HKHealthStore()
    private let heartRateType = HKQuantityType(.heartRate)
    private let bpmUnit = HKUnit(from: "count/min")

    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?
    private var keepAliveTimer: Timer?

    @Published var currentBPM: Double = 0
    @Published var errorMessage: String? = nil

    func requestAuthorizationAndStart() {
        let types: Set<HKSampleType> = [heartRateType]
        store.requestAuthorization(toShare: [], read: types) { [weak self] _, error in
            if let error {
                DispatchQueue.main.async {
                    self?.errorMessage = "認証エラー: \(error.localizedDescription)"
                }
                return
            }
            DispatchQueue.main.async {
                self?.startWorkout()
            }
        }
    }

    private func startWorkout() {
        let config = HKWorkoutConfiguration()
        config.activityType = .other
        config.locationType = .unknown

        do {
            session = try HKWorkoutSession(healthStore: store, configuration: config)
            builder = session?.associatedWorkoutBuilder()
        } catch {
            errorMessage = "WorkoutSession作成エラー: \(error.localizedDescription)"
            return
        }

        builder?.dataSource = HKLiveWorkoutDataSource(healthStore: store, workoutConfiguration: config)
        builder?.delegate = self
        session?.delegate = self

        session?.startActivity(with: Date())
        builder?.beginCollection(withStart: Date()) { _, _ in }

        startKeepAliveTimer()
    }

    func stopWorkout() {
        keepAliveTimer?.invalidate()
        keepAliveTimer = nil
        session?.end()
        builder?.endCollection(withEnd: Date()) { _, _ in
            self.builder?.finishWorkout { _, _ in }
        }
    }

    // 測定が途切れた場合でも最後の値を再送
    private func startKeepAliveTimer() {
        keepAliveTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            guard let self, self.currentBPM > 0 else { return }
            WatchSessionManager.shared.send(bpm: self.currentBPM)
        }
    }
}

extension HeartRateWorkoutManager: HKLiveWorkoutBuilderDelegate {
    func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}

    func workoutBuilder(_ builder: HKLiveWorkoutBuilder, didCollectDataOf types: Set<HKSampleType>) {
        guard types.contains(heartRateType) else { return }
        guard let bpm = builder.statistics(for: heartRateType)?
            .mostRecentQuantity()?
            .doubleValue(for: bpmUnit) else { return }

        DispatchQueue.main.async { [weak self] in
            self?.currentBPM = bpm
            WatchSessionManager.shared.send(bpm: bpm)
        }
    }
}

extension HeartRateWorkoutManager: HKWorkoutSessionDelegate {
    func workoutSession(_ workoutSession: HKWorkoutSession, didChangeTo toState: HKWorkoutSessionState, from fromState: HKWorkoutSessionState, date: Date) {}

    func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: any Error) {
        DispatchQueue.main.async { [weak self] in
            self?.errorMessage = "WorkoutSessionエラー: \(error.localizedDescription)"
        }
    }
}
