import SwiftUI

struct QuietHoursEditor: View {
    @EnvironmentObject private var model: AppModel
    @State private var days: Set<Int> = []
    @State private var start = Calendar.current.startOfDay(for: Date())
    @State private var end = Calendar.current.startOfDay(for: Date()).addingTimeInterval(3600)
    private let labels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]
    private func minute(_ date: Date) -> Int {
        let parts = Calendar.current.dateComponents([.hour, .minute], from: date)
        return (parts.hour ?? 0) * 60 + (parts.minute ?? 0)
    }
    private func time(_ value: Int) -> String { String(format: "%02d:%02d", value / 60, value % 60) }
    var body: some View {
        LearningCard {
            PinyinText("每周禁用时段", large: true)
            PinyinText("按本机本地时间暂停应用内计时与学习；跨午夜时段归开始的星期。空列表表示关闭，最多十四条。可在任何学习阶段修改。")
            ForEach(1...7, id: \.self) { day in
                Toggle(isOn: Binding(get: { days.contains(day) }, set: { selected in
                    if selected { days.insert(day) } else { days.remove(day) }
                })) { PinyinText(labels[day - 1]) }
            }
            DatePicker(selection: $start, displayedComponents: .hourAndMinute) { PinyinText("开始时间") }
            DatePicker(selection: $end, displayedComponents: .hourAndMinute) { PinyinText("结束时间") }
            ActionButton(title: "添加时段") {
                model.saveQuietWindows(model.state.policy.quietWindows + [QuietWindow(days: days.sorted(), startMinute: minute(start), endMinute: minute(end))])
            }.disabled(days.isEmpty || minute(start) == minute(end) || model.state.policy.quietWindows.count >= 14)
            if model.state.policy.quietWindows.isEmpty { PinyinText("当前未设置禁用时段") }
            ForEach(Array(model.state.policy.quietWindows.enumerated()), id: \.offset) { index, window in
                PinyinText(window.days.map { labels[$0 - 1] }.joined(separator: "、") + " " + time(window.startMinute) + " — " + time(window.endMinute) + (window.endMinute < window.startMinute ? " 次日" : ""))
                Button { var windows = model.state.policy.quietWindows; windows.remove(at: index); model.saveQuietWindows(windows) } label: { PinyinText("删除时段") }
            }
        }
    }
}
