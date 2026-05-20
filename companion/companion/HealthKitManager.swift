import HealthKit
import Combine

@MainActor
class HealthKitManager: ObservableObject {
    private(set) var currentBPM: Double? = nil
    private(set) var lastUpdated: Date? = nil
    private(set) var errorMessage: String? = nil

    var onBPMUpdate: ((Double) -> Void)?

    private let store = HKHealthStore()
    private let heartRateType = HKQuantityType(.heartRate)
    private let bpmUnit = HKUnit(from: "count/min")
    private var anchor: HKQueryAnchor? = nil
    private var anchoredQuery: HKAnchoredObjectQuery? = nil
    private var observerQuery: HKObserverQuery? = nil
    private var pollTimer: Timer? = nil

    func requestAuthorizationIfNeeded() {
        guard HKHealthStore.isHealthDataAvailable() else {
            objectWillChange.send()
            errorMessage = "このデバイスはHealthKitに対応していません"
            return
        }
        guard anchoredQuery == nil else { return }
        Task {
            do {
                try await store.requestAuthorization(toShare: [], read: [heartRateType])
                await MainActor.run { startHeartRateMonitoring() }
            } catch {
                await MainActor.run {
                    self.objectWillChange.send()
                    self.errorMessage = "HealthKit認証に失敗しました: \(error.localizedDescription)"
                }
            }
        }
    }

    func startHeartRateMonitoring() {
        enableBackgroundDelivery()
        startObserverQuery()
        startAnchoredQuery()
        startPollTimer()
    }

    func stopHeartRateMonitoring() {
        if let q = anchoredQuery { store.stop(q); anchoredQuery = nil }
        if let q = observerQuery { store.stop(q); observerQuery = nil }
        pollTimer?.invalidate()
        pollTimer = nil
    }

    private func startPollTimer() {
        pollTimer?.invalidate()
        pollTimer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                print("[HKManager] ⏱ poll tick")
                self?.fetchLatestSample()
            }
        }
        print("[HKManager] ✅ pollTimer started")
    }

    private func enableBackgroundDelivery() {
        store.enableBackgroundDelivery(for: heartRateType, frequency: .immediate) { [weak self] _, error in
            if let error {
                Task { @MainActor [weak self] in
                    guard let self else { return }
                    self.objectWillChange.send()
                    self.errorMessage = "バックグラウンド配信エラー: \(error.localizedDescription)"
                }
            }
        }
    }

    private func startObserverQuery() {
        let query = HKObserverQuery(sampleType: heartRateType, predicate: nil) { [weak self] _, completionHandler, error in
            guard error == nil else { completionHandler(); return }
            Task { @MainActor [weak self] in self?.fetchLatestSample() }
            completionHandler()
        }
        observerQuery = query
        store.execute(query)
    }

    private func startAnchoredQuery() {
        let query = HKAnchoredObjectQuery(
            type: heartRateType, predicate: nil, anchor: anchor, limit: HKObjectQueryNoLimit
        ) { [weak self] _, samples, _, newAnchor, _ in
            Task { @MainActor [weak self] in self?.handleSamples(samples, newAnchor: newAnchor) }
        }
        query.updateHandler = { [weak self] _, samples, _, newAnchor, _ in
            Task { @MainActor [weak self] in self?.handleSamples(samples, newAnchor: newAnchor) }
        }
        anchoredQuery = query
        store.execute(query)
    }

    private func handleSamples(_ samples: [HKSample]?, newAnchor: HKQueryAnchor?) {
        anchor = newAnchor
        guard let samples = samples as? [HKQuantitySample], !samples.isEmpty else { return }
        let latest = samples.max(by: { $0.endDate < $1.endDate })!
        let bpm = latest.quantity.doubleValue(for: bpmUnit)
        let lag = Date().timeIntervalSince(latest.endDate)
        print("[HKManager] handleSamples bpm=\(Int(bpm)) サンプル時刻から\(Int(lag))秒遅延")
        objectWillChange.send()
        currentBPM = bpm
        lastUpdated = latest.endDate
        onBPMUpdate?(bpm)
    }

    func fetchLatestSample() {
        let sort = NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)
        let query = HKSampleQuery(sampleType: heartRateType, predicate: nil, limit: 1, sortDescriptors: [sort]) { [weak self] _, samples, error in
            if let error {
                print("[HKManager] ❌ fetchLatestSample error: \(error)")
                return
            }
            guard let sample = (samples as? [HKQuantitySample])?.first else {
                print("[HKManager] ⚠️ サンプルなし")
                return
            }
            Task { @MainActor [weak self] in
                guard let self else { return }
                let bpm = sample.quantity.doubleValue(for: self.bpmUnit)
                let lag = Date().timeIntervalSince(sample.endDate)
                print("[HKManager] 取得 bpm=\(Int(bpm)) \(Int(lag))秒前 前回=\(self.currentBPM.map{"\(Int($0))"}  ?? "nil")")
                guard bpm != self.currentBPM || self.lastUpdated != sample.endDate else {
                    print("[HKManager] 変化なし → スキップ")
                    return
                }
                self.objectWillChange.send()
                self.currentBPM = bpm
                self.lastUpdated = sample.endDate
                self.onBPMUpdate?(bpm)
            }
        }
        store.execute(query)
    }
}
