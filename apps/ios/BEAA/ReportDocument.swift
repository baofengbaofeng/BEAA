import SwiftUI
import UniformTypeIdentifiers

struct ReportDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.json] }
    var data: Data
    init(state: LearningState, usageSourceDescription: String = "本机累计预算；来源可能为前台练习或所选范围系统下界，单独状态文件不能证明系统限制生效。") {
        // Deliberately omit PIN, answers, question text, and identifiers.
        var summary: [String: Any] = ["version": 1, "dailySeconds": state.dailySeconds,
            "completedRounds": state.records.count, "passedRounds": state.records.filter(\.passed).count,
            "capability": usageSourceDescription]
        let learning = LearningSummary(records: state.records)
        summary["learning"] = ["retainedRoundLimit": 100, "firstAttempts": learning.attempts, "firstCorrect": learning.correct, "corrected": learning.corrected,
            "subjects": learning.subjects.map { ["subject": $0.0, "attempts": $0.1, "correct": $0.2] as [String: Any] }] as [String: Any]
        summary["emergencyAudit"] = (state.emergencyAudit ?? []).map { ["event": $0.event, "budgetSeconds": $0.budgetSeconds, "usedSeconds": $0.usedSeconds] as [String: Any] }
        summary["temporaryPermit"] = state.permit.map { permit -> [String: Any] in
            ["budgetSeconds": permit.budgetSeconds, "usedSeconds": permit.usedSeconds,
             "status": permit.closedReason?.rawValue ?? "active", "modeAwaitingParentEnd": state.permitMode && !permit.active, "systemEnforcementVerified": false]
        } ?? ["status": "none", "systemEnforcementVerified": false]
        summary["permitAudit"] = state.permitAudit.map { event in
            ["event": event.event, "at": event.date.timeIntervalSince1970,
             "budgetSeconds": event.budgetSeconds, "usedSeconds": event.usedSeconds] as [String: Any]
        }
        data = (try? JSONSerialization.data(withJSONObject: summary, options: [.prettyPrinted, .sortedKeys])) ?? Data()
    }
    init(configuration: ReadConfiguration) throws { data = configuration.file.regularFileContents ?? Data() }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper { FileWrapper(regularFileWithContents: data) }
}
