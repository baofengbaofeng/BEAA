import SwiftUI

@MainActor final class AppModel: ObservableObject {
    @Published private(set) var state = LearningState()
    @Published private(set) var blocked = false
    @Published private(set) var storageRevision = 0
    @Published var notice = ""
    @Published private(set) var parentUntil: TimeInterval = 0
    @Published var pendingShareURL: URL?
    let vault = ParentVault()
    let secureStore: SecureStateStore
    let screenTime = ScreenTimeController()
    let notifications = NotificationCoordinator()
    let cloud: CloudCoordinator
    let deviceID: String
    private var clock = ForegroundClock()
    private var lastTick: Date?
    private var appActive = false
    private var platformFault = false
    private var lastCloudPoll = Date.distantPast
    private var processingPlatform = false
    private var monitorPlanDirty = false
    var parentAuthorized: Bool { ProcessInfo.processInfo.systemUptime < parentUntil }
    var quietBlocked: Bool { state.isQuiet() }
    var controlRevision: Int { state.controlRevision ?? 0 }
    var platformReady: Bool { !screenTime.monitoringRequested || (screenTime.monitoringActive && screenTime.isAuthorized && !platformFault) }
    var canUse: Bool { !blocked && platformReady && businessAllowsUse && !quietBlocked }
    var usageSourceDescription: String {
        screenTime.monitoringRequested ? "已计入所选范围预算；系统回执是下界，保守结算不是整机精确用时。" : "本应用前台练习计时，离开后暂停；不代表其他应用用时。"
    }
    private var dayCurrent: Bool { Calendar.current.isDate(state.dayStarted, inSameDayAs: Date()) }
    private var businessAllowsUse: Bool {
        guard state.dailySeconds < state.policy.dailyMinutes * 60 else { return false }
        if screenTime.monitoringRequested && !dayCurrent { return false }
        if state.phase == .challengeRequired { return state.emergencyRemaining() > 0 }
        return state.phase == .available && (!state.permitMode || (state.permit?.remaining(now: Date()) ?? 0) > 0)
    }
    init(store: SecureStateStore? = nil) {
        let defaults = UserDefaults.standard
        let existing = defaults.string(forKey: "BEAA.deviceID").flatMap(UUID.init(uuidString:))
        deviceID = (existing ?? UUID()).uuidString
        defaults.set(deviceID, forKey: "BEAA.deviceID")
        cloud = CloudCoordinator(deviceID: deviceID)
        let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        secureStore = store ?? SecureStateStore(url: directory.appendingPathComponent("BEAA/state.json"))
        do { state = try secureStore.load(); storageRevision = secureStore.revision }
        catch { blocked = true; notice = "记录需要恢复。已保留原文件，使用和资格均已暂停。请家长验证后检查本机加密备份。" }
    }
    private func commit(_ operation: (inout LearningState) throws -> Void) throws {
        guard !blocked else { throw SecureStoreError.unavailable }
        var next = state
        if screenTime.monitoringRequested { try next.settleEndedSystemAllowance() }
        try operation(&next)
        next.enforceQuiet(); next.observeEmergency()
        if next.phase != .restRequired { next.protectedRestAnchor = nil }
        try next.activatePendingPolicyIfReady()
        let changedPlan = next.policy.periodMinutes != state.policy.periodMinutes || next.policy.dailyMinutes != state.policy.dailyMinutes ||
            next.policy.quietWindows != state.policy.quietWindows || (state.phase != .available && next.phase == .available)
        try secureStore.save(next)
        state = next; storageRevision = secureStore.revision
        if changedPlan { monitorPlanDirty = true }
    }
    @discardableResult func change(_ operation: (inout LearningState) throws -> Void) -> Bool {
        do { try commit(operation); updatePlatform(); return true }
        catch LearningError.invalidAction { notice = "当前条件不允许此操作，请查看最新进度。" }
        catch LearningError.invalidPolicy { notice = "规则无效或匹配题量不足，请检查时间、筛选和通过条件。" }
        catch { failStorage() }
        return false
    }
    private func failStorage() {
        blocked = true; parentUntil = 0; platformFault = true
        notice = "未能安全保存记录，已停止使用与新资格。请保留文件并由家长恢复，不会自动重置额度。"
        screenTime.reconcile(blocked: true, reason: "记录保护")
        notifications.pauseAndClear()
    }
    func setActive(_ active: Bool) {
        appActive = active
        if !active {
            prepareProtectedRest()
            parentUntil = 0
            if !screenTime.monitoringRequested { notifications.pauseAndClear() }
        }
        lastTick = active ? Date() : nil
        clock.start(at: active ? ProcessInfo.processInfo.systemUptime : nil)
        if active {
            drainPlatformReceipts(); updatePlatform(); recoverProtectedRest()
            Task { [weak self] in
                guard let self else { return }
                await self.notifications.refreshStatus()
                await self.cloud.resumeIfEnabled()
                await self.refreshCloud()
            }
        }
    }
    func tick() {
        objectWillChange.send()
        guard appActive, !blocked else { return }
        let now = Date(), previous = lastTick; lastTick = now
        drainPlatformReceipts()
        guard !blocked else { return }
        let seconds = clock.consume(at: ProcessInfo.processInfo.systemUptime)
        if !screenTime.monitoringRequested, seconds > 0,
           QuietHours.canCredit(state.policy.quietWindows, from: previous, to: now, elapsed: seconds) {
            if state.canUse(now: now) { _ = change { try $0.recordUsage(seconds: seconds, now: now) } }
            else if state.phase == .restRequired && !quietBlocked { _ = change { try $0.recordRest(seconds: seconds, now: now) } }
        } else if screenTime.monitoringRequested, platformReady, state.phase == .restRequired, seconds > 0,
                  QuietHours.canCredit(state.policy.quietWindows, from: previous, to: now, elapsed: seconds) {
            _ = change { try $0.recordRest(seconds: seconds, now: now) }
        }
        if state.permit?.active == true || state.emergencyGrant?.active == true {
            _ = change {
                if screenTime.monitoringRequested && !$0.canUse(now: now) { try $0.settleUnmeasuredScope(now: now) }
                $0.enforceQuiet(now: now); $0.observePermit(now: now); $0.observeEmergency(now: now)
            }
        }
        updatePlatform()
        if !screenTime.monitoringRequested { notifications.observe(state: state, active: !quietBlocked) }
        if cloud.enabled && now.timeIntervalSince(lastCloudPoll) >= 30 {
            lastCloudPoll = now
            Task { [weak self] in await self?.refreshCloud() }
        }
    }
    func authenticate(pin: String, confirmation: String) {
        guard !blocked else { authenticateForRecovery(pin: pin); return }
        do {
            if try vault.read() == nil {
                guard pin == confirmation else { notice = "两次输入不一致，请重新输入。"; return }
                try vault.enroll(pin)
            } else { try vault.verify(pin) }
            parentUntil = ProcessInfo.processInfo.systemUptime + 300; notice = ""
        } catch { notice = "验证未完成。请检查六位密码，或等待冷却结束后重试。" }
    }
    func authenticateForRecovery(pin: String) {
        do {
            guard try vault.read() != nil else { throw VaultError.unavailable }
            try vault.verify(pin); parentUntil = ProcessInfo.processInfo.systemUptime + 300
            notice = "已验证家长身份，可以检查备份或重试读取；不会创建新账本。"
        } catch { notice = "无法验证已有家长身份。请检查密码或使用此前保存的单次恢复码。" }
    }
    func authenticateBiometrics() async {
        do { try await vault.verifyBiometrics(); guard appActive else { return }; parentUntil = ProcessInfo.processInfo.systemUptime + 300; notice = "" }
        catch { notice = "生物识别不可用，请使用家长密码。" }
    }
    func credentialsChanged() { parentUntil = 0; notice = "家长凭据已更新，请重新验证。" }
    func retryRead() {
        guard parentAuthorized else { return }
        do { let loaded = try secureStore.load(); acceptRestored(loaded); notice = "记录已安全读取，已有累计保持。" }
        catch { notice = "记录仍无法验证。请保留文件并检查最新本机加密备份。" }
    }
    func acceptRestored(_ restored: LearningState) {
        guard parentAuthorized else { return }
        state = restored; blocked = false; platformFault = false; storageRevision = secureStore.revision
        parentUntil = 0; lastTick = Date(); clock.start(at: appActive ? ProcessInfo.processInfo.systemUptime : nil)
        monitorPlanDirty = true; updatePlatform()
    }
    func startChallenge() {
        guard !blocked, !quietBlocked, state.phase == .challengeRequired else { return }
        if screenTime.monitoringRequested && state.emergencyGrant?.active == true {
            guard change({ try $0.settleUnmeasuredScope() }) else { return }
            guard state.phase == .challengeRequired else { return }
        }
        guard state.bank.filter({ state.policy.matches($0) }).count >= state.policy.questionCount else { notice = "匹配题目不足，请家长调整筛选或导入题库。"; return }
        _ = change { try $0.startChallenge() }
    }
    func savePolicy(_ policy: Policy) {
        guard parentAuthorized, !blocked else { return }
        if screenTime.monitoringRequested && (policy.periodMinutes != state.policy.periodMinutes || policy.dailyMinutes != state.policy.dailyMinutes || policy.quietWindows != state.policy.quietWindows) {
            guard change({ try $0.settleUnmeasuredScope() }) else { return }
        }
        if change({ try $0.requestPolicy(policy) }) {
            notice = state.pendingPolicy == nil ? "规则已保存，原有累计保持。" : "新时间与题目规则已暂存，将在安全阶段生效；禁用时段立即生效。"
        }
    }
    func saveQuietWindows(_ windows: [QuietWindow]) {
        guard parentAuthorized, !blocked else { return }
        if change({ if screenTime.monitoringRequested && windows != $0.policy.quietWindows { try $0.settleUnmeasuredScope() }; try $0.setQuietWindows(windows); $0.observeEmergency(); $0.pendingPolicy?.quietWindows = windows; try $0.advanceControlRevision() }) {
            lastTick = Date(); clock.start(at: ProcessInfo.processInfo.systemUptime)
            notice = "每周禁用时段已保存，原有进度保持。"
        }
    }
    func acknowledgeNewDay() {
        guard parentAuthorized, !blocked else { return }
        drainPlatformReceipts()
        if change({ try $0.rollDay(to: Date()); $0.protectedRestAnchor = nil; try $0.advanceControlRevision() }) {
            monitorPlanDirty = true; updatePlatform()
        }
    }
    func importBank(_ data: Data) {
        do { try importCloudBank(data); notice = "题库已保存；当前挑战保留原题，新挑战读取新题库。" }
        catch { notice = "未能导入，请检查题库、家长授权和本机记录。" }
    }
    func importCloudBank(_ data: Data) throws {
        guard parentAuthorized, !blocked else { throw SecureStoreError.unauthorized }
        let bank = try QuestionBank.decode(data)
        try commit { $0.bank = bank; try $0.advanceControlRevision() }
        updatePlatform()
    }
    func issuePermit(minutes: Int) {
        guard parentAuthorized, !blocked, platformReady else { return }
        _ = change { try $0.issuePermit(minutes: minutes); try $0.advanceControlRevision() }
    }
    func endPermit() {
        guard parentAuthorized, !blocked else { return }
        _ = change { if screenTime.monitoringRequested { try $0.settleUnmeasuredScope() }; $0.endPermit(); try $0.advanceControlRevision() }
    }
    func issueEmergency(minutes: Int) {
        guard parentAuthorized, !blocked, platformReady else { return }
        _ = change { try $0.issueEmergency(minutes: minutes); try $0.advanceControlRevision() }
    }
    func endEmergency() {
        guard parentAuthorized, !blocked else { return }
        _ = change { if screenTime.monitoringRequested { try $0.settleUnmeasuredScope() }; $0.endEmergency(); try $0.advanceControlRevision() }
    }
    func startSystemMonitoring() {
        guard parentAuthorized, !blocked, dayCurrent else { notice = "请先由家长确认今天的记录。"; return }
        drainPlatformReceipts()
        do {
            if screenTime.monitoringRequested {
                try commit { try $0.settleUnmeasuredScope() }
                try screenTime.rearm(policy: state.policy, baselineSeconds: state.dailySeconds, currentCycleSeconds: state.cycleSeconds)
            } else {
                try screenTime.start(policy: state.policy, baselineSeconds: state.dailySeconds, currentCycleSeconds: state.cycleSeconds)
            }
            monitorPlanDirty = false; platformFault = false; updatePlatform()
        } catch { platformFault = true; notice = "无法开始系统监控，请检查授权、所选范围和时段限制。" }
    }
    func stopSystemMonitoring() {
        guard parentAuthorized, !blocked else { return }
        drainPlatformReceipts()
        guard change({ try $0.settleUnmeasuredScope(); try $0.advanceControlRevision() }) else { return }
        screenTime.stop(); platformFault = false
        notice = "已请求停止监控。无法精确确认的剩余当前预算按已用结算，避免重启监控获得额外额度。"
    }
    private func drainPlatformReceipts() {
        guard !blocked, !processingPlatform, PlatformScreenTimeBridge.configured else { return }
        processingPlatform = true; defer { processingPlatform = false }
        do {
            let receipts = try screenTime.drainReceipts(); guard !receipts.isEmpty else { return }
            let generation = screenTime.generation
            let day = PlatformUsagePlanner.day(state.dayStarted)
            let current = receipts.filter { $0.generation == generation && $0.dayKey == day }
            let terminal = current.filter { $0.event.hasPrefix("allowance.end.") }
            let maximum = dayCurrent ? current.map(\.absoluteSeconds).max() : nil
            if !terminal.isEmpty || (maximum ?? 0) > state.dailySeconds {
                try commit { state in
                    // Terminal settlement precedes usage observations that might close an allowance.
                    for receipt in terminal { try state.applyAllowanceDeadline(event: receipt.event) }
                    if let maximum { try state.applySystemUsage(totalSeconds: maximum, dayDate: state.dayStarted) }
                }
            }
            // Different-day/generation receipts are never transferred into a new day's allowance.
            try screenTime.acknowledge(Set(receipts.map(\.eventID)))
        } catch { platformFault = true; notice = "用时回执尚未安全处理，系统范围使用保持暂停。" }
    }
    private func updatePlatform() {
        guard PlatformScreenTimeBridge.configured else { return }
        guard !processingPlatform else { return }
        if monitorPlanDirty && screenTime.monitoringRequested && !blocked && dayCurrent {
            do {
                try screenTime.rearm(policy: state.policy, baselineSeconds: state.dailySeconds, currentCycleSeconds: state.cycleSeconds)
                monitorPlanDirty = false; platformFault = false
            } catch { platformFault = true }
        }
        if screenTime.monitoringRequested {
            do {
                let deadline = state.emergencyGrant?.active == true ? state.emergencyGrant?.expiresAt : state.permit?.active == true ? state.permit?.expiresAt : nil
                try screenTime.configureAllowanceExpiry(deadline)
            } catch { platformFault = true }
            screenTime.reconcile(blocked: blocked || platformFault || !businessAllowsUse, reason: blocked ? "记录保护" : "当前学习与额度规则")
        }
    }
    private func prepareProtectedRest() {
        guard !blocked, state.phase == .restRequired, platformReady, screenTime.monitoringRequested,
              let generation = screenTime.generation, let sample = NativeContinuousTime.sample(), !quietBlocked else { return }
        _ = change { $0.protectedRestAnchor = ProtectedRestAnchor(date: Date(), continuousSeconds: sample.seconds, bootID: sample.boot, generation: generation, controlRevision: $0.controlRevision ?? 0) }
    }
    private func recoverProtectedRest() {
        guard !blocked, let anchor = state.protectedRestAnchor else { return }
        let now = Date(), sample = NativeContinuousTime.sample()
        let valid = platformReady && screenTime.monitoringRequested && screenTime.generation == anchor.generation &&
            controlRevision == anchor.controlRevision && dayCurrent && !QuietHours.crossedQuiet(state.policy.quietWindows, from: anchor.date, to: now) &&
            sample?.boot == anchor.bootID && (sample?.seconds ?? -1) >= anchor.continuousSeconds
        _ = change {
            $0.protectedRestAnchor = nil
            if valid, let sample {
                let elapsed = sample.seconds - anchor.continuousSeconds
                guard elapsed <= 86400, abs(now.timeIntervalSince(anchor.date) - elapsed) <= 2 else { return }
                try $0.recordRest(seconds: Int(elapsed), now: now)
            }
        }
        if !valid { notice = "后台休息条件无法完整确认，已保留先前休息进度，未补发资格。" }
    }
    func makeCloudSummary() -> CloudSummary {
        CloudSummary(deviceID: deviceID, revision: controlRevision, date: Date(), answeredCount: state.records.reduce(0) { $0 + $1.answers.count }, correctCount: state.records.reduce(0) { $0 + $1.answers.filter(\.correct).count }, usedSeconds: state.dailySeconds, policy: state.policy)
    }
    func applyRemote(_ command: RemoteCommand) throws {
        guard !blocked, command.targetDeviceID == deviceID, command.expectedRevision == controlRevision else { throw RemoteError.stale }
        switch command.kind {
        case .setPolicy:
            guard let policy = command.policy else { throw RemoteError.invalid }
            try commit { if screenTime.monitoringRequested { try $0.settleUnmeasuredScope() }; try $0.requestPolicy(policy) }
        case .emergencyGrant:
            guard platformReady, let minutes = command.minutes else { throw RemoteError.invalid }
            try commit { try $0.issueEmergency(minutes: minutes); try $0.advanceControlRevision() }
        case .endGrant:
            try commit { if screenTime.monitoringRequested { try $0.settleUnmeasuredScope() }; $0.endEmergency(); $0.endPermit(); try $0.advanceControlRevision() }
        case .requestSummary: break
        }
        updatePlatform()
    }
    func refreshCloud() async {
        guard cloud.enabled, !blocked else { return }
        await cloud.process(revision: { self.controlRevision }, summary: { self.makeCloudSummary() }, apply: { try self.applyRemote($0) })
    }
    func receiveShare(_ url: URL) { pendingShareURL = url; notice = "收到家庭分享邀请，请由家长验证后确认。" }
    func acceptPendingShare() async {
        guard parentAuthorized, let url = pendingShareURL else { return }
        let accepted = await cloud.acceptShare(url: url, parentAllowed: { self.parentAuthorized })
        if accepted && pendingShareURL == url { pendingShareURL = nil }
    }
}
