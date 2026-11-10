import Foundation
import Darwin

struct ProtectedRestAnchor: Codable {
    let date: Date
    let continuousSeconds: Double
    let bootID: String
    let generation: String
    let controlRevision: Int
}
enum NativeContinuousTime {
    static func sample() -> (seconds: Double, boot: String)? {
        var boot = timeval(); var size = MemoryLayout<timeval>.size
        guard sysctlbyname("kern.boottime", &boot, &size, nil, 0) == 0 else { return nil }
        var scale = mach_timebase_info_data_t()
        guard mach_timebase_info(&scale) == KERN_SUCCESS, scale.denom > 0 else { return nil }
        let seconds = Double(mach_continuous_time()) * Double(scale.numer) / Double(scale.denom) / 1_000_000_000
        guard seconds.isFinite else { return nil }
        return (seconds, "\(boot.tv_sec):\(boot.tv_usec)")
    }
}
extension LearningState {
    /// Run before ANY observation or operation that can close a system allowance.
    mutating func settleEndedSystemAllowance(now: Date = Date()) throws {
        guard (permit?.active == true || emergencyGrant?.active == true), !canUse(now: now) else { return }
        try settleUnmeasuredScope(now: now)
    }
    /// A matching committed system deadline closes the grant even after wall-clock rollback.
    mutating func applyAllowanceDeadline(event: String) throws {
        guard event.hasPrefix("allowance.end."), let epoch = Int(event.dropFirst("allowance.end.".count)) else { return }
        if let grant = emergencyGrant, grant.active, Int(grant.expiresAt.timeIntervalSince1970) == epoch {
            try settleUnmeasuredScope(now: max(grant.expiresAt, grant.lastObservedAt))
            observeEmergency(now: max(grant.expiresAt, grant.lastObservedAt))
        }
        if let current = permit, current.active, Int(current.expiresAt.timeIntervalSince1970) == epoch {
            try settleUnmeasuredScope(now: max(current.expiresAt, current.lastObservedAt))
            observePermit(now: max(current.expiresAt, current.lastObservedAt))
        }
    }
    mutating func advanceControlRevision() throws {
        let value = controlRevision ?? 0
        guard value >= 0, value < Int.max else { throw LearningError.invalidState }
        controlRevision = value + 1
    }
    func validateControlState() throws {
        guard controlRevision == nil || controlRevision! >= 0 else { throw LearningError.invalidState }
        try pendingPolicy?.validate()
        if let anchor = protectedRestAnchor {
            guard phase == .restRequired, anchor.continuousSeconds.isFinite, anchor.continuousSeconds >= 0,
                  anchor.date.timeIntervalSinceReferenceDate.isFinite, !anchor.bootID.isEmpty,
                  !anchor.generation.isEmpty, anchor.controlRevision >= 0 else { throw LearningError.invalidState }
        }
    }
    /// On monitor replacement, unknown usage is charged conservatively, never returned as allowance.
    mutating func settleUnmeasuredScope(now: Date = Date()) throws {
        let remaining = max(0, policy.dailyMinutes * 60 - dailySeconds)
        var charge = 0
        if phase == .available {
            charge = min(remaining, max(0, policy.periodMinutes * 60 - cycleSeconds))
            if permitMode, let permit { charge = min(charge, max(0, permit.budgetSeconds - permit.usedSeconds)) }
            cycleSeconds += charge
            if permitMode, let previous = permit { permit?.usedSeconds = min(previous.budgetSeconds, previous.usedSeconds + charge); observePermit(now: now) }
        } else if phase == .challengeRequired, let grant = emergencyGrant {
            charge = min(remaining, max(0, grant.budgetSeconds - grant.usedSeconds))
            emergencyGrant?.usedSeconds = grant.usedSeconds + charge
        }
        dailySeconds += charge
        if dailySeconds >= policy.dailyMinutes * 60 { phase = .dailyLocked }
        else if phase == .available && cycleSeconds >= policy.periodMinutes * 60 { phase = .challengeRequired }
        observeEmergency(now: now)
        if permitMode { observePermit(now: now) }
    }
    mutating func requestPolicy(_ proposed: Policy, now: Date = Date()) throws {
        try proposed.validate()
        guard bank.filter({ proposed.matches($0) }).count >= proposed.questionCount else { throw LearningError.invalidPolicy }
        observeEmergency(now: now)
        try setQuietWindows(proposed.quietWindows, now: now)
        observeEmergency(now: now)
        var next = proposed; next.quietWindows = policy.quietWindows
        let safeSelection = phase == .challengeRequired && next.periodMinutes == policy.periodMinutes &&
            next.dailyMinutes == policy.dailyMinutes && next.restMinutes == policy.restMinutes && emergencyGrant?.active != true && !permitMode
        let safeAvailable = phase == .available && !permitMode && cycleSeconds < next.periodMinutes * 60 && dailySeconds < next.dailyMinutes * 60
        if safeSelection || safeAvailable { policy = next; pendingPolicy = nil }
        else { pendingPolicy = next }
        try advanceControlRevision()
    }
    mutating func activatePendingPolicyIfReady() throws {
        guard let next = pendingPolicy, phase == .available, !permitMode, emergencyGrant?.active != true,
              dailySeconds < next.dailyMinutes * 60, cycleSeconds < next.periodMinutes * 60,
              bank.filter({ next.matches($0) }).count >= next.questionCount else { return }
        var update = next; update.quietWindows = policy.quietWindows
        policy = update; pendingPolicy = nil; try advanceControlRevision()
    }
}
