import SwiftUI

@main struct BEAAApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var model = AppModel()
    @Environment(\.scenePhase) private var scenePhase
    var body: some Scene {
        WindowGroup {
            RootView().environmentObject(model)
                .onChange(of: scenePhase) { _, phase in model.setActive(phase == .active) }
                .onOpenURL { model.receiveShare($0) }
                .onAppear { appDelegate.bind(model); model.setActive(true) }
                .onReceive(model.cloud.$enabled.removeDuplicates()) { enabled in
                    if enabled { UIApplication.shared.registerForRemoteNotifications() }
                    else { UIApplication.shared.unregisterForRemoteNotifications() }
                }
        }
    }
}

struct PinyinText: View {
    let text: String
    var large = false
    init(_ text: String, large: Bool = false) { self.text = text; self.large = large }
    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            if text.unicodeScalars.contains(where: { (0x3400...0x9FFF).contains(Int($0.value)) }) {
                Text(ChineseReading.pinyin(text))
                    .font(large ? .subheadline : .caption).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true).accessibilityHidden(true)
            }
            Text(text).font(large ? .title2.bold() : .body).fixedSize(horizontal: false, vertical: true)
        }.accessibilityElement(children: .ignore).accessibilityLabel(text)
    }
}
struct LearningCard<Content: View>: View {
    let content: Content
    init(@ViewBuilder content: () -> Content) { self.content = content() }
    var body: some View {
        VStack(alignment: .leading, spacing: 18) { content }
            .frame(maxWidth: .infinity, alignment: .leading).padding(22)
            .background(.background, in: RoundedRectangle(cornerRadius: 24))
    }
}
struct ActionButton: View {
    let title: String
    let action: () -> Void
    var body: some View {
        Button(action: action) { PinyinText(title).frame(maxWidth: .infinity, minHeight: 48) }
            .buttonStyle(.borderedProminent).tint(Color(red: 0.08, green: 0.43, blue: 0.40))
    }
}
struct RootView: View {
    @EnvironmentObject private var model: AppModel
    @State private var selection = 0
    private let timer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()
    var body: some View {
        TabView(selection: $selection) {
            NavigationStack { HomeView() }.tag(0)
            NavigationStack { LearningReviewView(state: model.state, disabled: model.blocked || model.quietBlocked) }.tag(1)
            NavigationStack { ParentView() }.tag(2)
        }.toolbar(.hidden, for: .tabBar)
            .safeAreaInset(edge: .bottom) {
                HStack(spacing: 8) {
                    navigationItem("学习", icon: "leaf.fill", index: 0)
                    navigationItem("复习", icon: "book.fill", index: 1)
                    navigationItem("家长", icon: "person.crop.circle", index: 2)
                }.padding(12).background(.regularMaterial)
            }
            .tint(Color(red: 0.08, green: 0.43, blue: 0.40))
            .onReceive(timer) { _ in model.tick() }
    }
    private func navigationItem(_ title: String, icon: String, index: Int) -> some View {
        Button { selection = index } label: {
            VStack(spacing: 5) { Image(systemName: icon); PinyinText(title) }
                .frame(maxWidth: .infinity, minHeight: 64)
                .background(selection == index ? Color.teal.opacity(0.12) : Color.clear, in: RoundedRectangle(cornerRadius: 16))
        }.accessibilityAddTraits(selection == index ? [.isSelected] : [])
    }

}
struct HomeView: View {
    @EnvironmentObject private var model: AppModel
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                PinyinText("学知守护", large: true)
                PinyinText("学习有节奏，成长有陪伴")
                if !model.notice.isEmpty { LearningCard { PinyinText(model.notice) } }
                if model.blocked {
                    LearningCard { Image(systemName: "exclamationmark.shield.fill").font(.largeTitle); PinyinText("记录保护中", large: true) }
                } else {
                    ViewThatFits(in: .horizontal) {
                        HStack(alignment: .top, spacing: 20) { statusCard.frame(minWidth: 340); summaryCard.frame(minWidth: 280) }
                        VStack(spacing: 20) { statusCard; summaryCard }
                    }
                    if model.quietBlocked { LearningCard { PinyinText("每周禁用时段，计时与学习已暂停", large: true); PinyinText("依据本机本地星期与时间判断，不代表设备系统限制。进度保持不变，家长可修改时段。") } }
                    if !model.state.questions.isEmpty && !model.quietBlocked { QuizView().id(model.state.roundID) }
                }
                NavigationLink { CapabilityView() } label: { PinyinText("查看设备能力与计时说明") }
            }.padding(24).frame(maxWidth: 1050)
                .frame(maxWidth: .infinity)
        }.background(Color(red: 0.94, green: 0.97, blue: 0.96))
            .toolbar(.hidden, for: .navigationBar)
    }
    private var statusCard: some View {
        LearningCard {
            Image(systemName: model.state.phase == .restRequired ? "cup.and.saucer.fill" : "leaf.circle.fill")
                .font(.system(size: 48)).foregroundStyle(.teal)
            switch model.state.phase {
            case .available:
                PinyinText(model.state.permitMode && model.state.permit?.active != true ? "临时使用已停止" : "专注时光", large: true)
                Text(duration(max(0, model.state.policy.periodMinutes * 60 - model.state.cycleSeconds)))
                    .font(.system(size: 56, weight: .semibold, design: .rounded)).monospacedDigit()
                PinyinText(model.state.permitMode && model.state.permit?.active != true ? "请由家长结束临时使用模式。计时已暂停，原有累计保持不变。" : model.usageSourceDescription)
            case .challengeRequired:
                PinyinText("到学习时间啦", large: true)
                PinyinText("完成本轮练习，再给眼睛一个休息时间。")
                if model.state.emergencyGrant?.active == true {
                    PinyinText("家长应急授权剩余 \(duration(model.state.emergencyRemaining()))；开始挑战会结束授权。")
                    PinyinText(model.usageSourceDescription)
                }
                ActionButton(title: "开始学习挑战") { model.startChallenge() }
                    .disabled(model.quietBlocked || model.state.permitMode || model.state.bank.filter { model.state.policy.matches($0) }.count < model.state.policy.questionCount)
                if model.state.permitMode { PinyinText("请由家长先结束临时使用模式。") }
                if model.state.bank.filter({ model.state.policy.matches($0) }).count < model.state.policy.questionCount {
                    PinyinText("匹配题目不足，请家长导入题库。")
                }
            case .challengeActive:
                PinyinText("认真思考，慢慢作答", large: true)
                PinyinText("每题首次有效作答计入成绩，答题进度自动保存。")
            case .restRequired:
                PinyinText("挑战通过，先休息吧", large: true)
                Text(duration(max(0, model.state.policy.restMinutes * 60 - model.state.restSeconds)))
                    .font(.system(size: 56, weight: .semibold, design: .rounded)).monospacedDigit()
                PinyinText("下一轮资格待生效。请放下设备、看看远处；系统模式可依据同次开机内的连续计时恢复已请求保护期间的休息，但不能证明眼睛离屏。练习模式只累计前台休息。")
                ActionButton(title: "完成休息，开始下一轮") { model.change { try $0.finishRest() } }
                    .disabled(model.quietBlocked || model.state.restSeconds < model.state.policy.restMinutes * 60)
            case .dailyLocked:
                PinyinText("今天的练习时间已用完", large: true)
                PinyinText("答题不能突破每日上限。去发现屏幕之外的精彩吧。")
            }
        }
    }
    private var summaryCard: some View {
        LearningCard {
            PinyinText("今日足迹", large: true)
            PinyinText(model.usageSourceDescription)
            PinyinText("已使用 \(model.state.dailySeconds / 60) 分钟")
            ProgressView(value: Double(model.state.dailySeconds), total: Double(model.state.policy.dailyMinutes * 60)).tint(.teal)
            PinyinText("每日上限 \(model.state.policy.dailyMinutes) 分钟")
            Divider()
            PinyinText("每轮 \(model.state.policy.periodMinutes) 分钟 · 休息 \(model.state.policy.restMinutes) 分钟")
            PinyinText("本轮 \(model.state.policy.questionCount) 题 · 至少答对 \(model.state.policy.requiredCorrect) 题")
            PinyinText(QuestionBank.bundledNotice)
            if let permit = model.state.permit {
                Divider()
                PinyinText("临时使用记录", large: true)
                PinyinText(permit.active ? "剩余 \(duration(permit.remaining(now: Date())))" : (permit.closedReason?.label ?? "已结束"))
                PinyinText("不增加本轮或每日额度；系统限制请求的实际效果仍需真机确认。")
            }
        }
    }
}
func duration(_ seconds: Int) -> String { String(format: "%02d:%02d", seconds / 60, seconds % 60) }

struct QuizView: View {
    @EnvironmentObject private var model: AppModel
    @State private var feedback: Question?
    @State private var wasCorrect = false
    var body: some View {
        LearningCard {
            if let feedback {
                PinyinText(wasCorrect ? "答对啦" : "再想一想", large: true)
                PinyinText(feedback.explanation)
                ActionButton(title: "继续") { self.feedback = nil }
            } else if model.state.questionIndex < model.state.questions.count {
                let q = model.state.questions[model.state.questionIndex]
                PinyinText("\(q.subject) · 第 \(model.state.questionIndex + 1) / \(model.state.questions.count) 题")
                ProgressView(value: Double(model.state.answers.count), total: Double(model.state.questions.count))
                PinyinText(q.type == .trueFalse ? "判断题" : q.type == .numeric ? "数值填空" : "单选题")
                PinyinText(q.prompt, large: true)
                if q.type.isTextResponse {
                    NumericResponseView(question: q, disabled: model.blocked || model.quietBlocked || model.state.phase != .challengeActive) { input in
                        guard let value = TextAnswer.normalize(input, type: q.type) else { return false }
                        let priorIndex = model.state.questionIndex
                        let priorAnswers = model.state.answers.count
                        model.change { try $0.answerText(questionID: q.id, input: input) }
                        let accepted = !model.blocked && (model.state.questionIndex != priorIndex || model.state.answers.count != priorAnswers)
                        if accepted { wasCorrect = TextAnswer.matches(value, question: q); feedback = q }
                        return accepted
                    }.id(q.id)
                }
                ForEach(q.options.indices.filter { model.state.questionIndex == model.state.answers.count || $0 == q.correct }, id: \.self) { index in
                    Button {
                        model.change { try $0.answer(questionID: q.id, choice: index) }
                        if !model.blocked { wasCorrect = index == q.correct; feedback = q }
                    } label: {
                        HStack { Text(String(UnicodeScalar(65 + index)!)).bold(); PinyinText(q.options[index]); Spacer(); Image(systemName: "chevron.right") }
                            .padding(16).frame(maxWidth: .infinity, minHeight: 60)
                    }.buttonStyle(.bordered).disabled(model.quietBlocked || model.blocked || model.state.phase != .challengeActive)
                }
            }
        }
    }
}
struct ReviewView: View {
    @EnvironmentObject private var model: AppModel
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                PinyinText("温故知新", large: true)
                PinyinText("最近一轮的错题。完整历史请由家长验证后查看。")
                if let record = model.state.records.last {
                    let wrong = record.answers.filter { !$0.correct }
                    if wrong.isEmpty { LearningCard { PinyinText("暂时没有错题，继续保持好奇心。") } }
                    ForEach(wrong, id: \.questionID) { answer in
                        if let q = record.questions.first(where: { $0.id == answer.questionID }) {
                            LearningCard {
                                PinyinText(q.prompt, large: true)
                                if let value = answer.numericValue { PinyinText("首次答案：\(value)") }
                                if q.type.isTextResponse { NumericReviewView(question: q, disabled: model.blocked || model.quietBlocked) }
                                else { PinyinText(q.explanation) }
                            }
                        }
                    }
                } else { LearningCard { PinyinText("完成一次挑战后，这里会出现复习内容。") } }
            }.padding(24).frame(maxWidth: 800).frame(maxWidth: .infinity)
        }.background(Color(.systemGroupedBackground))
    }
}

struct NumericResponseView: View {
    let question: Question
    var disabled = false
    let submit: (String) -> Bool
    @State private var draft = ""
    @State private var invalid = false
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            PinyinText(question.type == .fraction ? "输入分数答案" : "输入数字答案")
            TextField("", text: $draft)
                .accessibilityLabel("数字答案")
                .keyboardType(.numbersAndPunctuation).submitLabel(.done)
                .textFieldStyle(.roundedBorder).font(.title2)
                .onSubmit { send() }
            if question.type == .fraction { PinyinText("使用分子/分母格式，分母不能为零；分子分母绝对值不超过十亿。") }
            else { PinyinText("可输入正负小数，最多十二位整数和六位小数。") }
            if let tolerance = question.absoluteTolerance { PinyinText("允许绝对误差：\(tolerance)") }
            if invalid { PinyinText("请检查数字格式；答错后请重新思考并输入正确答案。") }
            ActionButton(title: "提交答案") { send() }
        }.disabled(disabled)
    }
    private func send() {
        guard !disabled else { return }
        guard TextAnswer.normalize(draft, type: question.type) != nil else { invalid = true; return }
        if submit(draft) { draft = ""; invalid = false } else { invalid = true }
    }
}
struct NumericReviewView: View {
    let question: Question
    let disabled: Bool
    @State private var result: Bool?
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            NumericResponseView(question: question, disabled: disabled) { input in
                guard !disabled, let value = TextAnswer.normalize(input, type: question.type) else { return false }
                result = TextAnswer.matches(value, question: question)
                return true
            }
            if let result {
                PinyinText(result ? "答对啦" : "再想一想")
                PinyinText(question.explanation)
            }
        }
    }
}
