import Combine
import HealthKit

@MainActor
class HealthKitManager: ObservableObject {
    private let store = HKHealthStore()
    private let heartRateType = HKQuantityType(.heartRate)
    private let bpmUnit = HKUnit(from: "count/min")

    @Published var currentBPM: Double? = nil
    @Published var lastUpdated: Date? = nil
    @Published var errorMessage: String? = nil

    private var anchor: HKQueryAnchor? = nil
    private var anchoredQuery: HKAnchoredObjectQuery? = nil
    private var observerQuery: HKObserverQuery? = nil

    func requestAuthorizationIfNeeded() {
        guard HKHealthStore.isHealthDataAvailable() else {
            errorMessage = "このデバイスはHealthKitに対応していません"
            return
        }

        // READ権限はauthorizationStatus()が常にnotDeterminedを返す（Apple仕様）
        // 既に監視中なら再起動しない
        guard anchoredQuery == nil else { return }

        Task {
            do {
                try await store.requestAuthorization(toShare: [], read: [heartRateType])
                startHeartRateMonitoring()
            } catch {
                errorMessage = "HealthKit認証に失敗しました: \(error.localizedDescription)"
            }
        }
    }

    func startHeartRateMonitoring() {
        enableBackgroundDelivery()
        startObserverQuery()
        startAnchoredQuery()
    }

    func stopHeartRateMonitoring() {
        if let q = anchoredQuery { store.stop(q); anchoredQuery = nil }
        if let q = observerQuery { store.stop(q); observerQuery = nil }
    }

    // MARK: - Private

    private func enableBackgroundDelivery() {
        store.enableBackgroundDelivery(for: heartRateType, frequency: .immediate) { [weak self] _, error in
            if let error {
                Task { @MainActor [weak self] in
                    self?.errorMessage = "バックグラウンド配信エラー: \(error.localizedDescription)"
                }
            }
        }
    }

    // バックグラウンドwakeup時に最新サンプルを取得
    private func startObserverQuery() {
        let query = HKObserverQuery(sampleType: heartRateType, predicate: nil) { [weak self] _, completionHandler, error in
            guard error == nil else { completionHandler(); return }
            Task { @MainActor [weak self] in self?.fetchLatestSample() }
            completionHandler()
        }
        observerQuery = query
        store.execute(query)
    }

    // フォアグラウンドのリアルタイム監視
    private func startAnchoredQuery() {
        let query = HKAnchoredObjectQuery(
            type: heartRateType,
            predicate: nil,
            anchor: anchor,
            limit: HKObjectQueryNoLimit
        ) { [weak self] _, samples, _, newAnchor, _ in
            Task { @MainActor [weak self] in
                self?.handleSamples(samples, newAnchor: newAnchor)
            }
        }
        query.updateHandler = { [weak self] _, samples, _, newAnchor, _ in
            Task { @MainActor [weak self] in
                self?.handleSamples(samples, newAnchor: newAnchor)
            }
        }
        anchoredQuery = query
        store.execute(query)
    }

    private func handleSamples(_ samples: [HKSample]?, newAnchor: HKQueryAnchor?) {
        anchor = newAnchor
        guard let samples = samples as? [HKQuantitySample], !samples.isEmpty else { return }
        // 最新のサンプルを日付で選択
        let latest = samples.max(by: { $0.endDate < $1.endDate })!
        currentBPM = latest.quantity.doubleValue(for: bpmUnit)
        lastUpdated = latest.endDate
    }

    // ObserverQuery wakeup時に1件取得
    private func fetchLatestSample() {
        let sort = NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)
        let query = HKSampleQuery(sampleType: heartRateType, predicate: nil, limit: 1, sortDescriptors: [sort]) { [weak self] _, samples, _ in
            guard let sample = (samples as? [HKQuantitySample])?.first else { return }
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.currentBPM = sample.quantity.doubleValue(for: self.bpmUnit)
                self.lastUpdated = sample.endDate
            }
        }
        store.execute(query)
    }
}
