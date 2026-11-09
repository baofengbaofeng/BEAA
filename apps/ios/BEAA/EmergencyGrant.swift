import Foundation

struct EmergencyGrant: Codable {
    let issuedAt: Date
    let expiresAt: Date
    let budgetSeconds: Int
    var usedSeconds = 0
    var lastObservedAt: Date
    var closedReason: String?
    var active: Bool { closedReason == nil }
}
struct EmergencyAudit: Codable, Identifiable {
    var id = UUID()
    let date: Date
    let event: String
    let budgetSeconds: Int
    let usedSeconds: Int
}
extension LearningState {
    /// Eligibility only; system authorization and confirmed enforcement are separate platform state.
    func canUse(now: Date = Date()) -> Bool {
        guard !isQuiet(now: now), dailySeconds < policy.dailyMinutes * 60 else { return false }
        if phase == .challengeRequired { return emergencyRemaining(now: now) > 0 }
        guard phase == .available else { return false }
        return !permitMode || (permit?.remaining(now: now) ?? 0) > 0
    }
    var pendingLearningPhase: Phase { dailySuspendedPhase ?? phase }

    func emergencyRemaining(now: Date = Date()) -> Int {
        guard let grant = emergencyGrant, grant.active, now >= grant.lastObservedAt, now < grant.expiresAt,
              !isQuiet(now: now), phase == .challengeRequired else { return 0 }
        return max(0, min(grant.budgetSeconds - grant.usedSeconds, Int(grant.expiresAt.timeIntervalSince(now)), policy.dailyMinutes * 60 - dailySeconds))
    }
    mutating func issueEmergency(minutes: Int, now: Date = Date()) throws {
        observeEmergency(now: now)
        guard phase == .challengeRequired, !permitMode, !isQuiet(now: now),
              emergencyGrant?.active != true, (1...30).contains(minutes),
              minutes * 60 <= policy.dailyMinutes * 60 - dailySeconds else { throw LearningError.invalidAction }
        emergencyGrant = EmergencyGrant(issuedAt: now, expiresAt: now.addingTimeInterval(Double(minutes * 60)), budgetSeconds: minutes * 60, lastObservedAt: now)
        auditEmergency(event: "issued", now: now)
    }
    mutating func observeEmergency(now: Date = Date()) {
        guard var grant = emergencyGrant, grant.active else { return }
        let reason: String?
        if now < grant.lastObservedAt { reason = "clockRollback" }
        else if isQuiet(now: now) || QuietHours.crossedQuiet(policy.quietWindows, from: grant.lastObservedAt, to: now) { reason = "quietHours" }
        else if dailySeconds >= policy.dailyMinutes * 60 { reason = "dailyCap" }
        else if now >= grant.expiresAt { reason = "expired" }
        else if grant.usedSeconds >= grant.budgetSeconds { reason = "budgetExhausted" }
        else if phase != .challengeRequired { reason = "phaseChanged" }
        else { reason = nil }
        grant.lastObservedAt = max(now, grant.lastObservedAt); grant.closedReason = reason; emergencyGrant = grant
        if let reason { auditEmergency(event: reason, now: now) }
    }
    mutating func endEmergency(now: Date = Date()) {
        observeEmergency(now: now)
        guard emergencyGrant?.active == true else { return }
        emergencyGrant?.closedReason = "parentClosed"; auditEmergency(event: "parentClosed", now: now)
    }
    private mutating func auditEmergency(event: String, now: Date) {
        guard let grant = emergencyGrant else { return }
        emergencyAudit = Array(((emergencyAudit ?? []) + [EmergencyAudit(date: now, event: event, budgetSeconds: grant.budgetSeconds, usedSeconds: grant.usedSeconds)]).suffix(100))
    }
    func validateEmergency() throws {
        let events = ["issued", "clockRollback", "quietHours", "dailyCap", "expired", "budgetExhausted", "phaseChanged", "parentClosed"]
        guard (emergencyAudit?.count ?? 0) <= 100,
              Set((emergencyAudit ?? []).map(\.id)).count == (emergencyAudit?.count ?? 0),
              (emergencyAudit ?? []).allSatisfy({ events.contains($0.event) && (60...1800).contains($0.budgetSeconds) && $0.budgetSeconds % 60 == 0 && (0...$0.budgetSeconds).contains($0.usedSeconds) }) else { throw LearningError.invalidState }
        if let grant = emergencyGrant {
            guard (60...1800).contains(grant.budgetSeconds), grant.budgetSeconds % 60 == 0,
                  (0...grant.budgetSeconds).contains(grant.usedSeconds), grant.lastObservedAt >= grant.issuedAt,
                  grant.expiresAt.timeIntervalSince(grant.issuedAt) == Double(grant.budgetSeconds),
                  grant.closedReason == nil || events.contains(grant.closedReason!),
                  !grant.active || (phase == .challengeRequired && !permitMode && dailySeconds < policy.dailyMinutes * 60) else { throw LearningError.invalidState }
        }
        guard dailySuspendedPhase == nil || (phase == .dailyLocked && [.challengeActive, .restRequired].contains(dailySuspendedPhase!)) else { throw LearningError.invalidState }
    }
    /// A system receipt is an absolute lower bound for the parent-confirmed current day.
    mutating func applySystemUsage(totalSeconds: Int, dayDate: Date, now: Date = Date()) throws {
        let calendar = Calendar.current
        guard totalSeconds >= 0, totalSeconds <= 86400,
              calendar.isDate(dayDate, inSameDayAs: dayStarted), calendar.isDate(now, inSameDayAs: dayStarted), now >= dayStarted else { throw LearningError.invalidAction }
        observeEmergency(now: now)
        let next = min(totalSeconds, policy.dailyMinutes * 60)
        let delta = max(0, next - dailySeconds)
        if permitMode { observePermit(now: now, usedSeconds: delta) }
        // Receipts can exceed a grant: retain actual daily usage, debit only its bounded budget,
        // then close it. Repeated absolute receipts have delta zero and cannot extend eligibility.
        if phase == .challengeRequired, let grant = emergencyGrant, grant.active {
            emergencyGrant?.usedSeconds = min(grant.budgetSeconds, grant.usedSeconds + delta)
        }
        dailySeconds = max(dailySeconds, next)
        if phase == .available { cycleSeconds = min(policy.periodMinutes * 60, cycleSeconds + delta) }
        if dailySeconds >= policy.dailyMinutes * 60 {
            if [.challengeActive, .restRequired].contains(phase) { dailySuspendedPhase = phase }
            phase = .dailyLocked
        } else if phase == .available && cycleSeconds >= policy.periodMinutes * 60 { phase = .challengeRequired }
        observeEmergency(now: now)
        if permitMode { observePermit(now: now) }
    }
}
