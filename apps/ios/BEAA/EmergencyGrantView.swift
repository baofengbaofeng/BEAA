import SwiftUI

struct EmergencyGrantView: View {
    let state: LearningState
    let issue: (Int) -> Void
    let close: () -> Void
    @State private var minutes = 5
    var body: some View {
        LearningCard {
            PinyinText("家长应急授权", large: true)
            PinyinText("仅在等待挑战时短时使用，不重置已耗尽的周期；每日上限、禁用时段、进行中的挑战和休息仍优先。开始挑战会结束应急授权。")
            if let grant = state.emergencyGrant {
                PinyinText(grant.active ? "剩余 \(duration(state.emergencyRemaining()))" : "应急授权已结束")
                if grant.active { ActionButton(title: "结束应急授权", action: close) }
            }
            Stepper(value: $minutes, in: 1...30) { PinyinText("授权 \(minutes) 分钟") }
            ActionButton(title: "确认应急授权") { issue(minutes) }
                .disabled(state.phase != .challengeRequired || state.permitMode || state.isQuiet() || state.emergencyGrant?.active == true || minutes * 60 > state.policy.dailyMinutes * 60 - state.dailySeconds)
            PinyinText("本机仅保留最近一百条应急审计，不包含凭据。")
            ForEach((state.emergencyAudit ?? []).reversed()) { event in
                PinyinText("\(label(event.event)) · 预算 \(event.budgetSeconds / 60) 分钟 · 使用 \(event.usedSeconds) 秒")
            }
        }
    }
    private func label(_ event: String) -> String {
        ["issued": "家长授权", "clockRollback": "时间回拨终止", "quietHours": "禁用时段终止", "dailyCap": "每日上限终止", "expired": "到期终止", "budgetExhausted": "预算用完", "phaseChanged": "学习阶段改变", "parentClosed": "家长结束"][event] ?? "已结束"
    }
}
