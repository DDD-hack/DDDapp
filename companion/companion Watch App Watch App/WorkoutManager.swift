import Foundation
import HealthKit
import Observation
import WatchConnectivity

@Observable
class WorkoutManager: NSObject {
    var isRunning = false
    var currentBPM: Int = 0
    var errorMessage: String?

    private let healthStore = HKHealthStore()
    private var workoutSession: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?

    override init() {
        super.init()
        if WCSession.isSupported() {
            WCSession.default.delegate = self
            WCSession.default.activate()
        }
    }

    func requestAuthorizationAndStart() {
        let heartRateType = HKQuantityType(.heartRate)
        Task {
            do {
                try await healthStore.requestAuthorization(toShare: [HKObjectType.workoutType()], read: [heartRateType])
                startWorkout()
            } catch {
                errorMessage = "HealthKit 認証失敗: \(error.localizedDescription)"
            }
        }
    }

    private func startWorkout() {
        let config = HKWorkoutConfiguration()
        config.activityType = .other
        config.locationType = .indoor

        do {
            let session = try HKWorkoutSession(healthStore: healthStore, configuration: config)
            let builder = session.associatedWorkoutBuilder()
            builder.dataSource = HKLiveWorkoutDataSource(healthStore: healthStore, workoutConfiguration: config)
            builder.delegate = self
            session.delegate = self
            workoutSession = session
            self.builder = builder
            session.startActivity(with: Date())
            builder.beginCollection(withStart: Date()) { [weak self] success, error in
                Task { @MainActor in
                    guard let self else { return }
                    if success {
                        self.isRunning = true
                        self.errorMessage = nil
                    } else {
                        self.errorMessage = "収集開始失敗: \(error?.localizedDescription ?? "unknown error")"
                        self.workoutSession?.end()
                        self.workoutSession = nil
                        self.builder = nil
                    }
                }
            }
        } catch {
            errorMessage = "ワークアウト開始失敗: \(error.localizedDescription)"
        }
    }

    func stop() {
        workoutSession?.end()
        builder?.endCollection(withEnd: Date()) { _, _ in }
        isRunning = false
        currentBPM = 0
    }

    private func sendBPM(_ bpm: Int) {
        currentBPM = bpm
        guard WCSession.default.activationState == .activated,
              WCSession.default.isReachable else { return }
        WCSession.default.sendMessage(["bpm": bpm], replyHandler: nil)
    }
}

extension WorkoutManager: HKWorkoutSessionDelegate {
    nonisolated func workoutSession(_ session: HKWorkoutSession, didChangeTo toState: HKWorkoutSessionState, from fromState: HKWorkoutSessionState, date: Date) {}
    nonisolated func workoutSession(_ session: HKWorkoutSession, didFailWithError error: Error) {
        Task { @MainActor in self.errorMessage = error.localizedDescription }
    }
}

extension WorkoutManager: HKLiveWorkoutBuilderDelegate {
    nonisolated func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}

    nonisolated func workoutBuilder(_ workoutBuilder: HKLiveWorkoutBuilder, didCollectDataOf collectedTypes: Set<HKSampleType>) {
        guard collectedTypes.contains(HKQuantityType(.heartRate)) else { return }
        let bpm = workoutBuilder
            .statistics(for: HKQuantityType(.heartRate))?
            .mostRecentQuantity()?
            .doubleValue(for: HKUnit(from: "count/min"))
        guard let bpm else { return }
        Task { @MainActor in self.sendBPM(Int(bpm)) }
    }
}

extension WorkoutManager: WCSessionDelegate {
    nonisolated func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?) {}
}
