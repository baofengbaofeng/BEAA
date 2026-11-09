import Foundation

enum PermitCloseReason: String, Codable {
    case parentClosed, expired, budgetExhausted, clockRollback, guardianBlocked, quietHours
    var label: String {
        switch self {
        case .parentClosed: return "家长结束"
        case .expired: return "已到期"
        case .budgetExhausted: return "预算已用完"
        case .clockRollback: return "检测到时间回拨"
        case .quietHours: return "每周禁用时段"
        case .guardianBlocked: return "规则优先限制"
        }
    }
}
struct TemporaryPermit: Codable {
    var id = UUID()
    let issuedAt: Date
    let expiresAt: Date
    let budgetSeconds: Int
    var usedSeconds = 0
    var lastObservedAt: Date
    var closedReason: PermitCloseReason?
    func validate() throws {
        guard (60...1800).contains(budgetSeconds), budgetSeconds % 60 == 0,
              (0...budgetSeconds).contains(usedSeconds),
              expiresAt.timeIntervalSince(issuedAt) == Double(budgetSeconds),
              lastObservedAt >= issuedAt,
              closedReason != nil || (usedSeconds < budgetSeconds && lastObservedAt < expiresAt),
              closedReason != .expired || lastObservedAt >= expiresAt,
              closedReason != .budgetExhausted || usedSeconds == budgetSeconds else { throw LearningError.invalidState }
    }
    var active: Bool { closedReason == nil }
    func remaining(now: Date) -> Int {
        guard active, now >= lastObservedAt, now < expiresAt else { return 0 }
        return max(0, min(budgetSeconds - usedSeconds, Int(expiresAt.timeIntervalSince(now))))
    }
}
struct PermitAudit: Codable, Identifiable {
    var id = UUID()
    let date: Date
    let event: String
    let budgetSeconds: Int
    let usedSeconds: Int
}
extension LearningState {
    mutating func issuePermit(minutes: Int, now: Date = Date()) throws {
        guard !isQuiet(now: now), (1...30).contains(minutes), phase == .available,
              minutes * 60 <= policy.periodMinutes * 60 - cycleSeconds,
              minutes * 60 <= policy.dailyMinutes * 60 - dailySeconds,
              !permitMode else { throw LearningError.invalidAction }
        permitMode = true
        permit = TemporaryPermit(issuedAt: now, expiresAt: now.addingTimeInterval(Double(minutes * 60)), budgetSeconds: minutes * 60, lastObservedAt: now)
        appendPermitAudit(event: "issued", now: now)
    }
    mutating func observePermit(now: Date = Date(), usedSeconds: Int = 0) {
        guard var current = permit, current.active else { return }
        if now < current.lastObservedAt { current.closedReason = .clockRollback }
        else if now >= current.expiresAt { current.lastObservedAt = now; current.closedReason = .expired }
        else {
            current.lastObservedAt = now
            current.usedSeconds = min(current.budgetSeconds, current.usedSeconds + max(0, usedSeconds))
            if current.usedSeconds == current.budgetSeconds { current.closedReason = .budgetExhausted }
            else if phase != .available { current.closedReason = .guardianBlocked }
        }
        permit = current
        if current.closedReason != nil { appendPermitAudit(event: current.closedReason!.rawValue, now: now) }
    }
    mutating func endPermit(now: Date = Date()) {
        observePermit(now: now)
        let wasMode = permitMode
        permitMode = false
        if permit?.active == true { permit?.closedReason = .parentClosed }
        if wasMode { appendPermitAudit(event: PermitCloseReason.parentClosed.rawValue, now: now) }
    }
    private mutating func appendPermitAudit(event: String, now: Date) {
        guard let current = permit else { return }
        permitAudit.append(PermitAudit(date: now, event: event, budgetSeconds: current.budgetSeconds, usedSeconds: current.usedSeconds))
        permitAudit = Array(permitAudit.suffix(100))
    }
}
