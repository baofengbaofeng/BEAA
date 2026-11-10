import Foundation
import SwiftUI
import FamilyControls
import ManagedSettings
import DeviceActivity

@MainActor
final class ScreenTimeController: ObservableObject {
    @Published var selection = FamilyActivitySelection()
    @Published private(set) var status = "设备管控默认关闭"
    @Published private(set) var running = false
    var generation: String? { try? PlatformScreenTimeBridge().transaction { $0.configuration?.generation } }
    var monitoringActive: Bool { running }
    var isAuthorized: Bool { PlatformScreenTimeBridge.configured && AuthorizationCenter.shared.authorizationStatus == .approved }
    /// Durable user intent survives authorization loss and inaccessible App Group storage.
    var monitoringRequested: Bool {
        do {
            let active = try PlatformScreenTimeBridge().transaction { $0.configuration?.active == true }
            return active || UserDefaults.standard.bool(forKey: "BEAA.platform.requested")
        } catch { return UserDefaults.standard.bool(forKey: "BEAA.platform.requested") }
    }
    var currentDayKey: String { PlatformUsagePlanner.day() }
    var accountedBaselineSeconds = 0
    var currentCycleSeconds = 0
    private lazy var center = DeviceActivityCenter()
    private lazy var settings = ManagedSettingsStore(named: .init("BEAA.selected"))
    func requestAuthorization() async {
        guard PlatformScreenTimeBridge.configured else { status = PlatformServiceError.configuration.localizedDescription; return }
        do {
            try await AuthorizationCenter.shared.requestAuthorization(for: .individual)
            status = AuthorizationCenter.shared.authorizationStatus == .approved
                ? "已授权，请选择范围" : PlatformServiceError.authorization.localizedDescription
        } catch { running = false; status = "设备管控操作未完成，请联系家长" }
    }
    func start(policy: Policy, baselineSeconds: Int? = nil, currentCycleSeconds: Int? = nil) throws {
        try policy.validate()
        guard AuthorizationCenter.shared.authorizationStatus == .approved else { throw PlatformServiceError.authorization }
        guard !selection.applicationTokens.isEmpty || !selection.categoryTokens.isEmpty || !selection.webDomainTokens.isEmpty else { throw PlatformServiceError.selection }
        let bridge = try PlatformScreenTimeBridge()
        // Replacing a live monitor could erase the system's accumulated threshold accounting.
        let existing = try bridge.transaction { $0.configuration }
        guard existing?.active != true else {
            running = true
            status = "监控已运行；停止后重启会重新计量"
            return
        }
        let baseline = baselineSeconds ?? accountedBaselineSeconds
        let cycle = currentCycleSeconds ?? self.currentCycleSeconds
        guard baseline >= 0, baseline < policy.dailyMinutes * 60, (0...86400).contains(cycle) else { throw PlatformServiceError.selection }
        let quietWindows = policy.quietWindows.map { PlatformQuietWindow(days: $0.days, startMinute: $0.startMinute, endMinute: $0.endMinute) }
        let quietSchedules = try PlatformUsagePlanner.quietSchedules(quietWindows)
        let generation = UUID().uuidString
        let config = PlatformMonitorConfiguration(generation: generation, day: PlatformUsagePlanner.day(),
            selection: try JSONEncoder().encode(selection), currentCycleSeconds: cycle, baselineSeconds: baseline, cycleMinutes: policy.periodMinutes,
            dailyMinutes: policy.dailyMinutes, active: true, blocked: existing?.blocked ?? false,
            hostBlocked: existing?.hostBlocked ?? false, thresholdBlocked: existing?.thresholdBlocked ?? false,
            quietWindows: quietWindows)
        try bridge.transaction {
            guard $0.receipts.isEmpty else { throw PlatformServiceError.storage }
            $0.configuration = config
        }
        UserDefaults.standard.set(true, forKey: "BEAA.platform.requested")
        // If monitoring begins inside a quiet interval, request its shield immediately.
        // Starting the schedule alone is not proof that a boundary callback has already arrived.
        try bridge.transaction { state in
            guard var current = state.configuration, current.generation == generation else { throw PlatformServiceError.staleGeneration }
            let effective = current.hostBlocked || current.thresholdBlocked || PlatformUsagePlanner.quietBlocks(current.quietWindows) || (current.allowanceExpiresAt.map { Date() >= $0 } ?? false)
            if effective {
                settings.shield.applications = selection.applicationTokens
                settings.shield.applicationCategories = .specific(selection.categoryTokens)
                settings.shield.webDomains = selection.webDomainTokens
                settings.shield.webDomainCategories = .specific(selection.categoryTokens)
            }
            current.blocked = effective
            state.configuration = current
        }
        var events: [DeviceActivityEvent.Name: DeviceActivityEvent] = [:]
        let thresholds = PlatformUsagePlanner.events(periodMinutes: policy.periodMinutes,
            dailyMinutes: policy.dailyMinutes, baselineSeconds: baseline, currentCycleSeconds: cycle)
        for entry in thresholds {
            events[.init(entry.name)] = DeviceActivityEvent(applications: selection.applicationTokens,
                categories: selection.categoryTokens, webDomains: selection.webDomainTokens,
                threshold: DateComponents(second: entry.seconds))
        }
        // One day interval; next day requires app reconciliation/parent acknowledged day rollover.
        let now = Date(), calendar = Calendar.current
        let start = calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: now)
        let midnight = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: now))!
        let end = calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: midnight)
        do {
            try center.startMonitoring(.init("BEAA." + generation), during: DeviceActivitySchedule(intervalStart: start, intervalEnd: end, repeats: false), events: events)
            for (index, quiet) in quietSchedules.enumerated() {
                try center.startMonitoring(.init("BEAA.Q.\(generation).\(index)"), during:
                    DeviceActivitySchedule(intervalStart: quiet.start, intervalEnd: quiet.end, repeats: true))
            }
            running = true
            status = "已请求所选范围监控；限制效果待真机验收"
        } catch {
            center.stopMonitoring([.init("BEAA." + generation)] + quietSchedules.indices.map { .init("BEAA.Q.\(generation).\($0)") })
            do {
                try bridge.transaction { $0.configuration?.active = false }
                UserDefaults.standard.set(false, forKey: "BEAA.platform.requested")
            } catch {
                // Preserve requested intent when durable monitor state cannot be safely cleared.
            }
            throw error
        }
    }
    /// Caller must durably apply and acknowledge pending receipts before replacing generation.
    /// Keeps the currently requested shield throughout monitor replacement.
    func rearm(policy: Policy, baselineSeconds: Int, currentCycleSeconds: Int = 0) throws {
        let bridge = try PlatformScreenTimeBridge()
        let previous = try bridge.transaction { state -> PlatformMonitorConfiguration? in
            guard state.receipts.isEmpty else { throw PlatformServiceError.storage }
            let previous = state.configuration
            state.configuration?.active = false
            return previous
        }
        do {
            if let previous {
                selection = try JSONDecoder().decode(FamilyActivitySelection.self, from: previous.selection)
                center.stopMonitoring(activityNames(previous))
            }
            running = false
            try start(policy: policy, baselineSeconds: baselineSeconds, currentCycleSeconds: currentCycleSeconds)
            if previous?.blocked == true { try bridge.transaction { $0.configuration?.blocked = true } }
        } catch {
            running = false
            UserDefaults.standard.set(true, forKey: "BEAA.platform.requested")
            status = "设备监控重启未完成，请联系家长"
            throw error
        }
    }
    func reconcile(blocked: Bool, reason: String) {
        do {
            let bridge = try PlatformScreenTimeBridge()
            guard AuthorizationCenter.shared.authorizationStatus == .approved else {
                running = false
                status = PlatformServiceError.authorization.localizedDescription
                return
            }
            let configuration = try bridge.transaction { $0.configuration }
            guard let configuration, configuration.active else { running = false; return }
            guard activityNames(configuration).allSatisfy({ center.activities.contains($0) }) else {
                running = false
                status = "设备监控已中断，请联系家长"
                return
            }
            guard configuration.day == currentDayKey else {
                running = false
                status = "需家长确认新一天"
                return
            }
            let effectiveBlock = try bridge.transaction { state -> Bool in
                guard var current = state.configuration, current.active,
                      current.generation == configuration.generation else { throw PlatformServiceError.staleGeneration }
                let blockingEvents = Set(PlatformUsagePlanner.events(periodMinutes: current.cycleMinutes,
                    dailyMinutes: current.dailyMinutes, baselineSeconds: current.baselineSeconds,
                    currentCycleSeconds: current.currentCycleSeconds).filter(\.blocks).map(\.name))
                let uncommittedBlock = PlatformUsagePlanner.hasPendingBlock(state.receipts,
                    generation: current.generation, blockingEvents: blockingEvents)
                current.hostBlocked = blocked
                if !uncommittedBlock && !blocked { current.thresholdBlocked = false }
                let quiet = PlatformUsagePlanner.quietBlocks(current.quietWindows)
                let effective = blocked || current.thresholdBlocked || uncommittedBlock || quiet || (current.allowanceExpiresAt.map { Date() >= $0 } ?? false)
                let selected = try JSONDecoder().decode(FamilyActivitySelection.self, from: current.selection)
                selection = selected
                current.blocked = effective
                state.configuration = current
                settings.shield.applications = effective ? selected.applicationTokens : nil
                settings.shield.applicationCategories = effective ? .specific(selected.categoryTokens) : nil
                settings.shield.webDomains = effective ? selected.webDomainTokens : nil
                settings.shield.webDomainCategories = effective ? .specific(selected.categoryTokens) : nil
                return effective
            }
            running = true
            status = effectiveBlock ? "已请求限制：\(reason)" : "已请求解除所选限制"
        } catch { running = false; status = "设备管控操作未完成，请联系家长" }
    }
    /// Register before requesting any temporary unshield. The OS callback, not a foreground timer,
    /// requests the shield at expiration. Actual past-start schedule behavior requires device acceptance.
    func configureAllowanceExpiry(_ date: Date?) throws {
        do { try registerAllowanceExpiry(date) }
        catch {
            running = false
            status = "短时授权到期保护未完成，请联系家长"
            if PlatformScreenTimeBridge.configured {
                UserDefaults.standard.set(true, forKey: "BEAA.platform.requested")
                let persisted = try? PlatformScreenTimeBridge().transaction { state -> FamilyActivitySelection? in
                    guard let data = state.configuration?.selection else { return nil }
                    return try JSONDecoder().decode(FamilyActivitySelection.self, from: data)
                }
                let selected = persisted ?? selection
                if !selected.applicationTokens.isEmpty || !selected.categoryTokens.isEmpty || !selected.webDomainTokens.isEmpty {
                    settings.shield.applications = selected.applicationTokens
                    settings.shield.applicationCategories = .specific(selected.categoryTokens)
                    settings.shield.webDomains = selected.webDomainTokens
                    settings.shield.webDomainCategories = .specific(selected.categoryTokens)
                }
            }
            throw error
        }
    }
    private func registerAllowanceExpiry(_ date: Date?) throws {
        let bridge = try PlatformScreenTimeBridge()
        let previous = try bridge.transaction { $0.configuration }
        guard let previous, previous.active else { throw PlatformServiceError.configuration }
        guard previous.allowanceExpiresAt != date else { return }
        if let date, (!date.timeIntervalSinceReferenceDate.isFinite || date <= Date()) {
            throw PlatformServiceError.configuration
        }
        do {
            if date != nil, try PlatformUsagePlanner.quietSchedules(previous.quietWindows).count > 18 {
                throw PlatformServiceError.deadlineCapacity
            }
            if let date {
                let interval = PlatformUsagePlanner.allowanceDeadline(date)
                let calendar = Calendar.current
                let start = calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: interval.start)
                let end = calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: interval.end)
                // Persist first so a promptly delivered extension callback recognizes the deadline.
                try bridge.transaction { state in
                    guard state.configuration?.generation == previous.generation else { throw PlatformServiceError.staleGeneration }
                    state.configuration?.allowanceExpiresAt = date
                }
                try center.startMonitoring(deadlineName(previous.generation, date), during:
                    DeviceActivitySchedule(intervalStart: start, intervalEnd: end, repeats: false))
            } else {
                try bridge.transaction { $0.configuration?.allowanceExpiresAt = nil }
            }
            if let old = previous.allowanceExpiresAt { center.stopMonitoring([deadlineName(previous.generation, old)]) }
        } catch {
            running = false
            status = "短时授权到期保护未完成，请联系家长"
            // A failed background deadline must not be followed by an unshield request.
            try? bridge.transaction { state in
                guard var current = state.configuration else { throw PlatformServiceError.storage }
                current.thresholdBlocked = true
                current.blocked = true
                let selected = try JSONDecoder().decode(FamilyActivitySelection.self, from: current.selection)
                settings.shield.applications = selected.applicationTokens
                settings.shield.applicationCategories = .specific(selected.categoryTokens)
                settings.shield.webDomains = selected.webDomainTokens
                settings.shield.webDomainCategories = .specific(selected.categoryTokens)
                state.configuration = current
            }
            throw error
        }
    }
    private func deadlineName(_ generation: String, _ expiry: Date) -> DeviceActivityName {
        .init("BEAA.D.\(generation).\(Int(expiry.timeIntervalSince1970))")
    }
    func stop() {
        do {
            let bridge = try PlatformScreenTimeBridge()
            let configuration = try bridge.transaction { state -> PlatformMonitorConfiguration? in
                let value = state.configuration
                state.configuration?.active = false
                return value
            }
            if let configuration { center.stopMonitoring(activityNames(configuration)) }
            settings.clearAllSettings()
            UserDefaults.standard.set(false, forKey: "BEAA.platform.requested")
            running = false
            status = "已请求停止；重新开始会重计所选用时"
        } catch { running = false; status = "设备管控操作未完成，请联系家长" }
    }
    private func activityNames(_ configuration: PlatformMonitorConfiguration) -> [DeviceActivityName] {
        let count = (try? PlatformUsagePlanner.quietSchedules(configuration.quietWindows).count) ?? 0
        var names: [DeviceActivityName] = [.init("BEAA." + configuration.generation)] + (0..<count).map { .init("BEAA.Q.\(configuration.generation).\($0)") }
        if let expiry = configuration.allowanceExpiresAt { names.append(deadlineName(configuration.generation, expiry)) }
        return names
    }
    /// Read without removing; acknowledge only after the learning state was durably committed.
    func drainReceipts() throws -> [PlatformUsageReceipt] { try PlatformScreenTimeBridge().transaction { $0.receipts } }
    func acknowledge(_ ids: Set<String>) throws {
        try PlatformScreenTimeBridge().transaction { $0.receipts.removeAll { ids.contains($0.id) } }
    }
}

struct ScreenTimeControlsView: View {
    @ObservedObject var controller: ScreenTimeController
    let policy: Policy
    let parentAllowed: () -> Bool
    var baselineSeconds: Int = 0
    var currentCycleSeconds: Int = 0
    var startAction: (() -> Void)? = nil
    var stopAction: (() -> Void)? = nil
    @State private var authorizedSelection = FamilyActivitySelection()
    @State private var picker = false
    @State private var error = ""
    var body: some View {
        Section {
            PinyinText(controller.status)
            PinyinText("仅覆盖所选应用、类别和网站；回执是用时下界")
            Button { if parentAllowed() { Task { await controller.requestAuthorization() } } } label: { PinyinText("申请系统授权") }
            Button {
                if parentAllowed() { authorizedSelection = controller.selection; picker = true }
            } label: { PinyinText("选择范围") }.disabled(controller.running)
            Button {
                guard parentAllowed() else { return }
                if let startAction { startAction(); return }
                do { try controller.start(policy: policy, baselineSeconds: baselineSeconds, currentCycleSeconds: currentCycleSeconds) }
                catch { self.error = "设备管控操作未完成，请联系家长" }
            } label: { PinyinText("开始监控") }.disabled(controller.running)
            Button {
                guard parentAllowed() else { return }
                if let stopAction { stopAction() } else { controller.stop() }
            } label: { PinyinText("停止监控") }
            if !error.isEmpty { PinyinText(error) }
        } header: { PinyinText("设备管控") }
        .familyActivityPicker(isPresented: $picker, selection: $controller.selection)
        .onChange(of: picker) { presented in
            if !presented && !parentAllowed() { controller.selection = authorizedSelection }
        }
    }
}
