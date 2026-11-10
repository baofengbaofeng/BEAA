import SwiftUI

struct LearningSummary {
    let records: [LearningRecord]
    var attempts: Int { records.reduce(0) { $0 + $1.answers.count } }
    var correct: Int { records.reduce(0) { $0 + $1.answers.filter(\.correct).count } }
    var corrected: Int { records.reduce(0) { $0 + $1.answers.filter(\.corrected).count } }
    var days: [(String, Int)] {
        let format = DateFormatter(); format.dateFormat = "yyyy-MM-dd"
        return Dictionary(grouping: records, by: { format.string(from: $0.date) }).map { ($0.key, $0.value.count) }.sorted { $0.0 > $1.0 }
    }
    var subjects: [(String, Int, Int)] {
        ["语文", "数学", "英语"].map { subject in
            let pairs = records.flatMap { record in zip(record.questions, record.answers).filter { $0.0.subject == subject } }
            return (subject, pairs.count, pairs.filter { $0.1.correct }.count)
        }
    }
}
struct LearningDashboardView: View {
    let state: LearningState
    var body: some View {
        let summary = LearningSummary(records: state.records)
        LearningCard {
            PinyinText("阶段学习统计", large: true)
            PinyinText("仅统计本机保存的最近一百轮，最多显示一百轮；首次有效答案计分，订正不改分。")
            PinyinText("已保存 \(state.records.count) 轮 · 首答正确 \(summary.correct)/\(summary.attempts) · 已订正 \(summary.corrected) 题")
            ForEach(summary.subjects, id: \.0) { item in PinyinText("\(item.0)：首答正确 \(item.2)/\(item.1)") }
            ForEach(summary.days, id: \.0) { item in PinyinText("\(item.0)：\(item.1) 轮") }
        }
    }
}
struct LearningReviewView: View {
    let state: LearningState
    var disabled = false
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                PinyinText("温故知新", large: true)
                LearningDashboardView(state: state)
                PinyinText("以下为最近一百轮全部错题，可反复练习；练习不改变首答成绩或使用资格。家长详细记录需验证后查看。")
                if state.records.isEmpty { PinyinText("完成一次挑战后，这里会出现复习内容。") }
                ForEach(state.records.reversed()) { record in
                    let wrong = record.answers.enumerated().filter { !$0.element.correct }
                    ForEach(wrong, id: \.offset) { item in
                        if record.questions.indices.contains(item.offset) {
                            LearningReviewQuestion(question: record.questions[item.offset], disabled: disabled)
                                .id("\(record.id)-\(item.offset)")
                        }
                    }
                }
            }.padding(24).frame(maxWidth: 800).frame(maxWidth: .infinity)
        }.background(Color(.systemGroupedBackground))
    }
}
private struct LearningReviewQuestion: View {
    let question: Question
    let disabled: Bool
    @State private var result: Bool?
    var body: some View {
        LearningCard {
            PinyinText(question.subject)
            PinyinText(question.prompt, large: true)
            if question.type.isTextResponse { NumericReviewView(question: question, disabled: disabled) }
            else {
                ForEach(question.options.indices, id: \.self) { index in
                    Button { result = index == question.correct } label: { PinyinText(question.options[index]).frame(maxWidth: .infinity, minHeight: 48, alignment: .leading) }.buttonStyle(.bordered).disabled(disabled)
                }
                if let result { PinyinText(result ? "答对啦" : "再想一想"); PinyinText(question.explanation) }
            }
        }
    }
}
