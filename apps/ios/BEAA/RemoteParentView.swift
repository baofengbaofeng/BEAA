import SwiftUI
import UniformTypeIdentifiers

@MainActor struct RemoteParentView: View {
    @ObservedObject var coordinator: CloudCoordinator
    let parentAllowed: () -> Bool
    let localRevision: () -> Int
    let summary: () -> CloudSummary
    let apply: (RemoteCommand) throws -> Void
    var onBankDownloaded: ((Data) throws -> Void)? = nil
    var currentPolicy: () -> Policy? = { nil }
    @State private var shareURL = ""
    @State private var bankImporter = false
    @State private var grantMinutes = 5
    var body: some View {
        Section {
            PinyinText("家庭分享与远程家长", large: true)
            PinyinText(coordinator.status)
            PinyinText("仅分享学习摘要、题库与明确指令。不上传密码、恢复码或资格账本。远程指令五分钟后失效，孩子设备需上线检查。")
            if !coordinator.enabled {
                Button { Task { await coordinator.enable(parentAllowed: parentAllowed) } } label: { PinyinText("开启云端协作") }
            } else {
                Button { coordinator.disable() } label: { PinyinText("关闭云端协作") }
                Button { Task { await coordinator.invite(parentAllowed: parentAllowed) } } label: { PinyinText("邀请家长参与家庭分享") }
                TextField("https://…", text: $shareURL).textInputAutocapitalization(.never).autocorrectionDisabled()
                Button {
                    guard parentAllowed(), let url = URL(string: shareURL), url.scheme == "https" else { coordinator.status = "请先验证家长并填写有效分享链接"; return }
                    Task { await coordinator.acceptShare(url: url, parentAllowed: parentAllowed) }
                } label: { PinyinText("确认并接受分享链接") }
                Button { Task { await coordinator.refreshParticipants() } } label: { PinyinText("刷新分享参与者") }
                ForEach(coordinator.participants) { participant in
                    VStack(alignment: .leading) {
                        PinyinText(participant.name)
                        PinyinText(participant.eligible ? "已接受且可写" : "尚未具备可写权限")
                        if coordinator.isTrusted(participant.id) {
                            Button { coordinator.revoke(participant.id, parentAllowed: parentAllowed()) } label: { PinyinText("撤销本机确认") }
                        } else {
                            Button { coordinator.approve(participant, parentAllowed: parentAllowed()) } label: { PinyinText("本机家长确认此参与者") }.disabled(!participant.eligible)
                        }
                    }
                }
                Button { Task { await coordinator.publish(localSnapshot()) } } label: { PinyinText("上传学习摘要") }
                Button { Task { await coordinator.process(revision: localRevision, summary: localSnapshot, apply: apply) } } label: { PinyinText("检查远程指令并上传回执") }
                Button { if parentAllowed() { bankImporter = true } } label: { PinyinText("上传已审核题库") }
                Button { Task { await coordinator.fetchSharedSummaries() } } label: { PinyinText("获取共享设备摘要") }
                ForEach(coordinator.remoteReceipts) { receipt in
                    PinyinText("指令 \(receipt.id.prefix(8))：\(receipt.outcome == "applied" ? "已应用" : "已拒绝")，修订 \(receipt.revision)")
                    if receipt.outcome != "applied" { PinyinText(receipt.reason) }
                }
                Stepper(value: $grantMinutes, in: 1...30) { PinyinText("应急授权 \(grantMinutes) 分钟") }
                ForEach(coordinator.remoteSummaries.indices, id: \.self) { index in
                    let item = coordinator.remoteSummaries[index]
                    VStack(alignment: .leading) {
                        PinyinText("设备 \(item.deviceID.prefix(8))，修订 \(item.revision)")
                        PinyinText("已答 \(item.answeredCount) 题，答对 \(item.correctCount) 题，使用 \(item.usedSeconds / 60) 分钟")
                        Button { send(.requestSummary, target: item) } label: { PinyinText("请求最新摘要") }
                        Button { send(.emergencyGrant, target: item, minutes: grantMinutes) } label: { PinyinText("发送短时应急授权") }
                        Button { send(.endGrant, target: item) } label: { PinyinText("结束应急授权") }
                        if let policy = item.policy {
                            RemotePolicyEditor(coordinator: coordinator, target: item, initialPolicy: policy, parentAllowed: parentAllowed)
                                .id("\(item.deviceID)-\(item.revision)")
                        } else { PinyinText("摘要缺少当前策略，请请求最新摘要后再编辑") }
                        if onBankDownloaded != nil {
                            Button { downloadBank(target: item) } label: { PinyinText("下载并导入共享题库") }
                        }
                    }
                }
            }
        }
        .sheet(item: $coordinator.sharing, onDismiss: { coordinator.status = "分享面板已关闭，请刷新参与者核对结果" }) { presentation in
            CloudSharingController(presentation: presentation) { coordinator.status = $0 }
        }
        .fileImporter(isPresented: $bankImporter, allowedContentTypes: [.json]) { result in
            guard parentAllowed() else { coordinator.status = "请先验证本机家长身份"; return }
            switch result {
            case .success(let url):
                Task { await coordinator.perform {
                    let scoped = url.startAccessingSecurityScopedResource()
                    defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                    guard let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize, size <= 2_000_000 else { throw RemoteError.invalid }
                    try await coordinator.requireService().uploadBank(Data(contentsOf: url), revision: localRevision(), parentAllowed: { coordinator.enabled && parentAllowed() })
                    coordinator.status = "题库已校验并上传"
                } }
            case .failure: coordinator.status = "未选择题库文件"
            }
        }
    }
    private func localSnapshot() -> CloudSummary {
        var value = summary(); if let policy = currentPolicy() { value.policy = policy }; return value
    }
    private func send(_ kind: RemoteCommand.Kind, target: CloudSummary, minutes: Int? = nil, policy: Policy? = nil) {
        guard parentAllowed() else { coordinator.status = "请先验证本机家长身份"; return }
        Task { await coordinator.send(kind: kind, target: target, minutes: minutes, policy: policy, parentAllowed: parentAllowed) }
    }
    private func downloadBank(target: CloudSummary) {
        guard parentAllowed(), let onBankDownloaded else { coordinator.status = "请先验证本机家长身份"; return }
        Task { await coordinator.perform {
            let service = try coordinator.requireService()
            for zone in try await service.sharedZones() {
                guard try await service.summaries(zone: zone.zoneID).contains(where: { $0.deviceID == target.deviceID }) else { continue }
                let (data, revision) = try await service.downloadBank(zone: zone.zoneID, minimumRevision: 0)
                let key = "BEAA.cloud.bankRevision.\(zone.zoneID.ownerName).\(zone.zoneID.zoneName)"
                guard revision >= UserDefaults.standard.integer(forKey: key) else { throw RemoteError.stale }
                guard parentAllowed(), coordinator.enabled else { throw RemoteError.unauthorized }
                try onBankDownloaded(data)
                UserDefaults.standard.set(revision, forKey: key)
                coordinator.status = "共享题库已校验并导入"; return
            }
            throw RemoteError.invalid
        } }
    }
}


/// Editing starts from the selected child's revision-bound policy, preserving quiet windows,
/// subject/grade filters and every unedited field. A new summary revision recreates the draft.
@MainActor private struct RemotePolicyEditor: View {
    @ObservedObject var coordinator: CloudCoordinator
    let target: CloudSummary
    let parentAllowed: () -> Bool
    @State private var draft: Policy
    init(coordinator: CloudCoordinator, target: CloudSummary, initialPolicy: Policy, parentAllowed: @escaping () -> Bool) {
        self.coordinator = coordinator; self.target = target; self.parentAllowed = parentAllowed
        _draft = State(initialValue: initialPolicy)
    }
    var body: some View {
        VStack(alignment: .leading) {
            Stepper(value: $draft.periodMinutes, in: 5...120) { PinyinText("远程周期 \(draft.periodMinutes) 分钟") }
            Stepper(value: $draft.dailyMinutes, in: 15...600) { PinyinText("远程每日上限 \(draft.dailyMinutes) 分钟") }
            PinyinText("保留此设备摘要中的禁用时段、题目与筛选设置。修订变化后须重新获取摘要。")
            Button {
                guard parentAllowed() else { coordinator.status = "请先验证本机家长身份"; return }
                Task { await coordinator.send(kind: .setPolicy, target: target, policy: draft, parentAllowed: parentAllowed) }
            } label: { PinyinText("发送此设备的已编辑策略") }
        }
    }
}
