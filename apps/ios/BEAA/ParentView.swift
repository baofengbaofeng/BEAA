import SwiftUI
import UniformTypeIdentifiers

struct ParentView: View {
    @EnvironmentObject private var model: AppModel
    @State private var pin = ""
    @State private var confirmation = ""
    @State private var policy = Policy()
    @State private var enrolled = true
    @State private var permitMinutes = 5
    @State private var importing = false
    @State private var exporting = false
    @State private var report: ReportDocument?
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                PinyinText("家长空间", large: true)
                if !model.notice.isEmpty { LearningCard { PinyinText(model.notice) } }
                if !model.parentAuthorized {
                    LearningCard {
                        PinyinText(enrolled ? "验证家长密码" : "首次设置家长密码", large: true)
                        PinyinText("请由家长操作。使用六位数字，五次错误后暂停五分钟；退出应用立即结束授权。")
                        PinyinText("六位数字密码")
                        SecureField("", text: $pin).keyboardType(.numberPad).textContentType(.password)
                            .textFieldStyle(.roundedBorder).accessibilityLabel("六位数字密码")
                        if !enrolled {
                            PinyinText("再次输入密码")
                            SecureField("", text: $confirmation).keyboardType(.numberPad).textFieldStyle(.roundedBorder).accessibilityLabel("再次输入密码")
                        }
                        ActionButton(title: enrolled ? "验证" : "设置并进入") {
                            model.authenticate(pin: pin, confirmation: confirmation)
                            pin = ""; confirmation = ""
                            policy = model.state.policy
                            enrolled = (try? model.vault.read()) != nil
                        }
                    }
                    Button { Task { await model.authenticateBiometrics() } } label: { PinyinText("使用本机生物识别验证") }
                    NavigationLink { PINRecoveryView(vault: model.vault, completed: model.credentialsChanged) } label: { PinyinText("忘记密码，使用单次恢复码") }
                } else if model.blocked {
                    LearningCard {
                        PinyinText("本机记录保护", large: true)
                        PinyinText("身份验证不会重置账本。请重试安全读取，或检查保留密钥的本机最新加密备份。")
                        ActionButton(title: "重试安全读取") { model.retryRead() }
                        NavigationLink { ParentSessionView(allowBlocked: true) { BackupRecoveryView(store: model.secureStore, parentAllowed: { model.parentAuthorized }, restored: model.acceptRestored) } } label: { PinyinText("检查加密备份") }
                    }
                } else {
                    featureLinks
                    QuietHoursEditor()
                    LearningCard {
                        PinyinText("时间与挑战规则", large: true)
                        PinyinText("授权五分钟后失效。内置九十道小学语数英入门样题。可导入离线题库，并按年级和学科筛选。")
                        Stepper(value: $policy.periodMinutes, in: 5...120, step: 5) { PinyinText("每轮 \(policy.periodMinutes) 分钟") }
                        Stepper(value: $policy.dailyMinutes, in: 15...600, step: 15) { PinyinText("每日 \(policy.dailyMinutes) 分钟") }
                        Stepper(value: $policy.restMinutes, in: 0...60) { PinyinText("休息 \(policy.restMinutes) 分钟") }
                        Stepper(value: $policy.questionCount, in: 1...20) { PinyinText("每轮 \(policy.questionCount) 题") }
                            .onChange(of: policy.questionCount) { _, count in policy.requiredCorrect = min(count, policy.requiredCorrect) }
                        Stepper(value: $policy.requiredCorrect, in: 1...policy.questionCount) { PinyinText("至少答对 \(policy.requiredCorrect) 题") }
                        Stepper(value: $policy.grade, in: 1...6) { PinyinText("参考年级：小学 \(policy.grade) 年级") }
                        ForEach(["语文", "数学", "英语"], id: \.self) { subject in
                            Toggle(isOn: Binding(get: { policy.subjects.contains(subject) }, set: { enabled in
                                if enabled { if !policy.subjects.contains(subject) { policy.subjects.append(subject) } }
                                else if policy.subjects.count > 1 { policy.subjects.removeAll { $0 == subject } }
                            })) { PinyinText(subject) }
                        }
                        Toggle(isOn: Binding(get: { policy.topics.isEmpty }, set: { all in
                            policy.topics = all ? [] : model.state.availableTopics
                        })) { PinyinText("全部知识主题") }
                        ForEach(model.state.availableTopics, id: \.self) { topic in
                            Toggle(isOn: Binding(get: { policy.topics.contains(topic) }, set: { selected in
                                if selected { if !policy.topics.contains(topic) { policy.topics.append(topic) } }
                                else { policy.topics.removeAll { $0 == topic } }
                            })) { PinyinText(topicLabel(topic)) }
                            .disabled(policy.topics.isEmpty)
                        }
                        PinyinText("当前题库 \(model.state.bank.count) 题；新挑战需有足够的匹配题目。")
                        ActionButton(title: "导入离线题库") { importing = true }
                        ActionButton(title: "导出学习摘要") {
                            guard model.parentAuthorized, !model.blocked else { return }
                            report = ReportDocument(state: model.state, usageSourceDescription: model.usageSourceDescription); exporting = true
                        }
                        ActionButton(title: "保存规则") { model.savePolicy(policy) }
                        ActionButton(title: "确认新的一天") { model.acknowledgeNewDay() }
                        Button { model.setActive(false); model.setActive(true) } label: { PinyinText("退出家长空间") }
                    }
                    EmergencyGrantView(state: model.state, issue: model.issueEmergency, close: model.endEmergency)
                    LearningCard {
                        PinyinText("临时使用记录", large: true)
                        PinyinText("仅在当前可用额度内记录一段使用，不增加时间。挑战、休息和每日上限始终优先。后台继续按自然时间到期，但不推算后台用时。到期、用完或时间异常后计时暂停，须由家长结束此模式后恢复。")
                        Stepper(value: $permitMinutes, in: 1...30) { PinyinText("记录 \(permitMinutes) 分钟") }
                        ActionButton(title: "开始临时使用记录") { model.issuePermit(minutes: permitMinutes) }
                            .disabled(model.quietBlocked || model.state.phase != .available || model.state.permitMode)
                        if let permit = model.state.permit {
                            PinyinText(permit.active ? "当前剩余 \(duration(permit.remaining(now: Date())))" : (permit.closedReason?.label ?? "已结束"))
                            PinyinText("预算 \(permit.budgetSeconds / 60) 分钟 · 已计入 \(permit.usedSeconds) 秒")
                            ActionButton(title: "结束临时使用记录") { model.endPermit() }.disabled(!model.state.permitMode)
                        }
                        ForEach(model.state.permitAudit.reversed()) { event in
                            Text(event.date, format: .dateTime.month().day().hour().minute()).font(.caption)
                            PinyinText(permitEventLabel(event.event))
                            PinyinText("预算 \(event.budgetSeconds / 60) 分钟 · 已计入 \(event.usedSeconds) 秒")
                        }
                    }
                    LearningCard {
                        PinyinText("学习记录", large: true)
                        if model.state.records.isEmpty { PinyinText("暂无记录") }
                        ForEach(model.state.records.reversed()) { record in
                            VStack(alignment: .leading, spacing: 6) {
                                Text(record.date, format: .dateTime.year().month().day().hour().minute()).font(.caption).foregroundStyle(.secondary)
                                PinyinText("答对 \(record.answers.filter(\.correct).count) / \(record.questions.count) 题 · \(record.passed ? "通过" : "继续练习")")
                                ForEach(record.answers, id: \.questionID) { answer in
                                    if let question = record.questions.first(where: { $0.id == answer.questionID }) {
                                        PinyinText(question.prompt)
                                        PinyinText(question.explanation)
                                    }
                                }
                            }
                            Divider()
                        }
                    }
                }
                NavigationLink { CapabilityView() } label: { PinyinText("计时与设备能力说明") }
            }.padding(24).frame(maxWidth: 850).frame(maxWidth: .infinity)
        }.background(Color(.systemGroupedBackground))
            .onAppear { policy = model.state.policy; enrolled = (try? model.vault.read()) != nil }
            .fileImporter(isPresented: $importing, allowedContentTypes: [.json]) { result in
                guard model.parentAuthorized, !model.blocked else { return }
                do {
                    let url = try result.get()
                    let access = url.startAccessingSecurityScopedResource()
                    defer { if access { url.stopAccessingSecurityScopedResource() } }
                    let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
                    guard size <= 2_000_000 else { model.notice = "文件过大，请选择较小的题库。"; return }
                    model.importBank(try Data(contentsOf: url))
                } catch { model.notice = "未能读取题库文件，请重新选择。" }
            }
            .fileExporter(isPresented: $exporting, document: report, contentType: .json, defaultFilename: "learning-summary") { result in
                if case .failure = result { model.notice = "摘要导出未完成。" }
            }
            .onDisappear { pin = ""; confirmation = "" }
    }
    private var featureLinks: some View {
        LearningCard {
            PinyinText("家长工具", large: true)
            if model.state.pendingPolicy != nil { PinyinText("有待生效的规则，当前挑战和休息不会被跳过。") }
            NavigationLink { ParentSessionView { SecuritySettingsView(vault: model.vault, parentAllowed: { model.parentAuthorized }, onCredentialsChanged: model.credentialsChanged) } } label: { PinyinText("密码、恢复码与生物识别") }
            NavigationLink { ParentSessionView { ScrollView { BackupRecoveryView(store: model.secureStore, parentAllowed: { model.parentAuthorized }, restored: model.acceptRestored) } } } label: { PinyinText("加密备份与恢复") }
            NavigationLink { ParentSessionView { SystemControlsView(notifications: model.notifications) } } label: { PinyinText("系统使用范围与通知") }
            NavigationLink {
                ParentSessionView {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 18) {
                            if model.pendingShareURL != nil {
                                PinyinText("收到分享邀请，请确认来源后接受。")
                                Button { Task { await model.acceptPendingShare() } } label: { PinyinText("接受待确认的家庭邀请") }
                            }
                            RemoteParentView(coordinator: model.cloud, parentAllowed: { model.parentAuthorized && !model.blocked }, localRevision: { model.controlRevision }, summary: { model.makeCloudSummary() }, apply: model.applyRemote, onBankDownloaded: model.importCloudBank, currentPolicy: { model.state.policy })
                        }.padding()
                    }
                }
            } label: { PinyinText("家庭分享与远程家长") }
            NavigationLink { ParentSessionView { LearningDashboardView(state: model.state) } } label: { PinyinText("学习进展与学科统计") }
        }
    }
}

/// Re-evaluated on model ticks; expired sessions remove sensitive child views and their state.
private struct ParentSessionView<Content: View>: View {
    @EnvironmentObject private var model: AppModel
    let allowBlocked: Bool
    let content: Content
    init(allowBlocked: Bool = false, @ViewBuilder content: () -> Content) { self.allowBlocked = allowBlocked; self.content = content() }
    var body: some View {
        Group {
            if model.parentAuthorized && (allowBlocked || !model.blocked) { content }
            else { PinyinText("家长授权已结束，请返回家长空间重新验证。", large: true).padding() }
        }
    }
}
private struct SystemControlsView: View {
    @EnvironmentObject private var model: AppModel
    @ObservedObject var notifications: NotificationCoordinator
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                ScreenTimeControlsView(controller: model.screenTime, policy: model.state.policy, parentAllowed: { model.parentAuthorized && !model.blocked }, baselineSeconds: model.state.dailySeconds, currentCycleSeconds: model.state.cycleSeconds, startAction: model.startSystemMonitoring, stopAction: model.stopSystemMonitoring)
                LearningCard {
                    PinyinText("用时提醒", large: true)
                    PinyinText(notifications.status)
                    PinyinText("提醒默认关闭。练习模式根据前台累计提醒；系统模式由所选范围阈值回调提醒。通知是否显示由系统设置决定。")
                    Button { guard model.parentAuthorized else { return }; Task { await notifications.requestAuthorization(); await model.notifications.refreshStatus() } } label: { PinyinText("申请通知权限") }
                }
                LearningCard {
                    PinyinText("计入预算的含义", large: true)
                    PinyinText(model.usageSourceDescription)
                    PinyinText("停止监控或修改时间与禁用时段会保守结算当前尚未确认的预算，可能提前进入挑战，不会返还为新额度。系统授权和限制效果需要家长在设备上确认。")
                }
            }.padding()
        }.task { await notifications.refreshStatus() }
    }
}
private struct PINRecoveryView: View {
    let vault: ParentVault
    let completed: () -> Void
    @State private var code = ""
    @State private var pin = ""
    @State private var confirmation = ""
    @State private var message = ""
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            PinyinText("单次恢复码", large: true)
            PinyinText("需要此前由家长保存的恢复码。成功后恢复码失效，学习记录和已用额度保持。")
            SecureField("", text: $code).textInputAutocapitalization(.characters).autocorrectionDisabled()
            PinyinText("新的六位家长密码")
            SecureField("", text: $pin).keyboardType(.numberPad)
            PinyinText("再次输入新密码")
            SecureField("", text: $confirmation).keyboardType(.numberPad)
            Button {
                do { try vault.recoverPIN(code: code, new: pin, confirmation: confirmation); completed(); message = "密码已恢复，请返回重新验证。" }
                catch { message = "恢复未完成，请检查恢复码和六位新密码，或等待冷却结束。" }
                code = ""; pin = ""; confirmation = ""
            } label: { PinyinText("确认恢复家长密码") }
            if !message.isEmpty { PinyinText(message) }
        }.padding().onDisappear { code = ""; pin = ""; confirmation = "" }
    }
}

private func topicLabel(_ topic: String) -> String {
    ["arithmetic": "计算", "geometry": "图形", "poetry": "古诗", "vocabulary": "词汇", "general": "综合", "division": "除法", "addition_subtraction": "加减法"][topic] ?? topic
}
private func permitEventLabel(_ event: String) -> String {
    if event == "issued" { return "家长开始临时使用记录" }
    return PermitCloseReason(rawValue: event)?.label ?? "记录已结束"
}
