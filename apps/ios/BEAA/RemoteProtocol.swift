import Foundation

struct CloudSummary: Codable {
    let deviceID: String
    /// Monotonic control revision: policy/import/day/grant changes, not per-second usage writes.
    let revision: Int
    let date: Date
    let answeredCount: Int
    let correctCount: Int
    let usedSeconds: Int
    var policy: Policy? = nil
}
struct RemoteCommand: Codable {
    enum Kind: String, Codable { case setPolicy, emergencyGrant, endGrant, requestSummary }
    let id: UUID
    let targetDeviceID: String
    let senderRecordID: String
    let expectedRevision: Int
    let issuedAt: Date
    let expiresAt: Date
    let kind: Kind
    var policy: Policy? = nil
    var minutes: Int? = nil
}
struct CloudReceipt: Codable, Identifiable {
    let id: String
    let outcome: String
    let reason: String
    let revision: Int
}
struct CloudParticipant: Identifiable {
    let id: String
    let name: String
    let eligible: Bool
}
enum RemoteError: Error, LocalizedError {
    case disabled, configuration, accountUnavailable, unauthorized, invalid, replay, stale, expired, conflict
    var errorDescription: String? {
        switch self {
        case .disabled: return "云同步未开启"
        case .configuration: return "需要配置云端协作能力与权限"
        case .accountUnavailable: return "云账户不可用，请登录并检查账户权限"
        case .unauthorized: return "未通过本机家长确认的共享参与者"
        case .invalid: return "远程数据无效"
        case .replay: return "指令已经处理"
        case .stale: return "修订已变化，请重新获取摘要"
        case .expired: return "指令已过期或时间无效"
        case .conflict: return "云端版本冲突，请重新获取"
        }
    }
}
struct CloudSummaryGate {
    static func validate(_ summary: CloudSummary, creator: String?, modifier: String?, owner: String, recordName: String) throws {
        guard creator == owner, modifier == owner else { throw RemoteError.unauthorized }
        guard UUID(uuidString: summary.deviceID) != nil, recordName == "summary-\(summary.deviceID)",
              summary.revision >= 0, (0...1_000_000).contains(summary.answeredCount),
              (0...summary.answeredCount).contains(summary.correctCount),
              (0...36_000).contains(summary.usedSeconds), summary.date.timeIntervalSince1970.isFinite else { throw RemoteError.invalid }
        if let policy = summary.policy { try policy.validate() }
    }
}
struct RemoteCommandGate {
    /// Foreign-device commands are ignored before journal/receipt access in an account's shared zone.
    static func isTarget(_ command: RemoteCommand, deviceID: String) -> Bool { command.targetDeviceID == deviceID }

    static func validate(_ command: RemoteCommand, creator: String, modifier: String, eligible: Set<String>, trusted: Set<String>, deviceID: String, revision: Int, processed: Set<UUID>, now: Date) throws {
        guard modifier == creator, eligible.contains(creator), trusted.contains(creator), command.senderRecordID == creator else { throw RemoteError.unauthorized }
        guard command.targetDeviceID == deviceID else { throw RemoteError.invalid }
        guard !processed.contains(command.id) else { throw RemoteError.replay }
        guard command.expectedRevision == revision else { throw RemoteError.stale }
        guard command.issuedAt <= now, command.expiresAt > now, command.expiresAt > command.issuedAt,
              command.expiresAt.timeIntervalSince(command.issuedAt) <= 300 else { throw RemoteError.expired }
        switch command.kind {
        case .setPolicy:
            guard let policy = command.policy, command.minutes == nil else { throw RemoteError.invalid }
            try policy.validate()
        case .emergencyGrant:
            guard let minutes = command.minutes, (1...30).contains(minutes), command.policy == nil else { throw RemoteError.invalid }
        case .endGrant, .requestSummary:
            guard command.policy == nil, command.minutes == nil else { throw RemoteError.invalid }
        }
    }
}
