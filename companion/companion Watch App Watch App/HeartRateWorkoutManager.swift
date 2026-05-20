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

    var onBPMUpdate: ((Double) -> Void)?

    func requestAuthorizationAndStart() {
        let types: Set<HKSampleType> = [heartRateType]
        let shareTypes: Set<HKSampleType> = [HKObjectType.workoutType()]
        store.requestAuthorization(toShare: shareTypes, read: types) { [weak self] _, error in
            guard let self else { return }
            if let error {
                DispatchQueue.main.async {
                    self.errorMessage = "認証エラー: \(error.localizedDescription)"
                }
                return
            }
            DispatchQueue.main.async {
                self.startWorkout()
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
        print("[HRM] startActivity called — waiting for .running state")
    }

    func stopWorkout() {
        keepAliveTimer?.invalidate()
        keepAliveTimer = nil
        session?.end()
        builder?.endCollection(withEnd: Date()) { [weak self] _, error in
            if let error {
                DispatchQueue.main.async { self?.errorMessage = "endCollectionエラー: \(error.localizedDescription)" }
                return
            }
            self?.builder?.finishWorkout { [weak self] _, error in
                if let error {
                    DispatchQueue.main.async { self?.errorMessage = "finishWorkoutエラー: \(error.localizedDescription)" }
                }
            }
        }
    }

    func forceResend() {
        guard currentBPM > 0 else { return }
        onBPMUpdate?(currentBPM)
    }

    private func startKeepAliveTimer() {
        keepAliveTimer?.invalidate()
        keepAliveTimer = nil
        keepAliveTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            guard let self, self.currentBPM > 0 else { return }
            self.onBPMUpdate?(self.currentBPM)
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
            self?.onBPMUpdate?(bpm)
        }
    }
}

extension HeartRateWorkoutManager: HKWorkoutSessionDelegate {
    func workoutSession(_ workoutSession: HKWorkoutSession, didChangeTo toState: HKWorkoutSessionState, from fromState: HKWorkoutSessionState, date: Date) {
        print("[HRM] state: \(fromState.rawValue) → \(toState.rawValue)")
        if toState == .running {
            builder?.beginCollection(withStart: date) { [weak self] _, error in
                if let error {
                    DispatchQueue.main.async { self?.errorMessage = "beginCollectionエラー: \(error.localizedDescription)" }
                    return
                }
            }
            DispatchQueue.main.async { [weak self] in
                self?.startKeepAliveTimer()
            }
        }
    }

    func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: any Error) {
        DispatchQueue.main.async { [weak self] in
            self?.errorMessage = "WorkoutSessionエラー: \(error.localizedDescription)"
        }
    }
}
