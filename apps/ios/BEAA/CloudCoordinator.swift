import SwiftUI
import CloudKit
import UIKit

struct CloudSharePresentation: Identifiable {
    let id = UUID()
    let share: CKShare
    let container: CKContainer
}
@MainActor final class CloudCoordinator: ObservableObject {
    @Published private(set) var enabled = false
    @Published var status = "云同步默认关闭"
    @Published var sharing: CloudSharePresentation?
    @Published var participants: [CloudParticipant] = []
    @Published var remoteSummaries: [CloudSummary] = []
    @Published var remoteReceipts: [CloudReceipt] = []
    private(set) var service: CloudService?
    let deviceID: String
    private let defaults: UserDefaults
    private var processing = false
    private var starting = false
    private var activationID = UUID()
    private var optInKey: String { "BEAA.cloud.optIn.\(deviceID)" }
    private var trusted: Set<String> {
        get { Set(defaults.stringArray(forKey: "BEAA.cloud.trusted.\(deviceID)") ?? []) }
        set { defaults.set(Array(newValue), forKey: "BEAA.cloud.trusted.\(deviceID)") }
    }
    private var processed: Set<UUID> {
        get { Set((defaults.stringArray(forKey: "BEAA.cloud.processed.\(deviceID)") ?? []).compactMap(UUID.init(uuidString:))) }
        set { defaults.set(newValue.map(\.uuidString), forKey: "BEAA.cloud.processed.\(deviceID)") }
    }
    init(deviceID: String, defaults: UserDefaults = .standard) { self.deviceID = deviceID; self.defaults = defaults }
    func enable(parentAllowed: @escaping () -> Bool) async {
        guard parentAllowed() else { status = "请先验证本机家长身份"; return }
        await activate(persistChoice: true, parentAllowed: parentAllowed)
    }
    /// Restore only a previously parent-authorized choice, never a default opt-in.
    func resumeIfEnabled() async {
        guard defaults.bool(forKey: optInKey), !enabled else { return }
        await activate(persistChoice: false, parentAllowed: { true })
    }
    private func activate(persistChoice: Bool, parentAllowed: @escaping () -> Bool) async {
        guard !starting else { return }
        guard Bundle.main.object(forInfoDictionaryKey: "BEAAEnableCloud") as? Bool == true else { status = "此版本尚未配置云端协作，请使用已配置的连接版本"; return }
        guard let identifier = Bundle.main.object(forInfoDictionaryKey: "BEAACloudContainerIdentifier") as? String,
              identifier.hasPrefix("iCloud."), !identifier.contains("YOUR"), !identifier.contains("$(") else { status = RemoteError.configuration.localizedDescription; return }
        starting = true
        defer { starting = false }
        let activation = activationID
        let candidate = CloudService(containerIdentifier: identifier)
        await perform {
            try await candidate.prepare(parentAllowed: parentAllowed)
            guard activation == self.activationID else { return }
            guard parentAllowed() else { throw RemoteError.unauthorized }
            self.service = candidate; self.enabled = true
            if persistChoice { self.defaults.set(true, forKey: self.optInKey) }
            self.status = "云账户可用，已开启"
            await self.configureSubscription()
        }
    }
    func configureSubscription() async {
        do {
            let service = try requireService()
            try await service.ensureCommandSubscription(deviceID: deviceID)
        } catch {
            if enabled { status = "云端协作已开启，后台提醒未配置；前台仍会定期检查指令" }
        }
    }
    func disable() {
        activationID = UUID()
        defaults.set(false, forKey: optInKey)
        enabled = false; service = nil; participants = []; remoteSummaries = []; remoteReceipts = []
        sharing = nil; status = "云同步已关闭"
    }
    func perform(_ work: @MainActor () async throws -> Void) async {
        do { try await work() } catch let error as RemoteError { status = error.localizedDescription } catch { status = "云端操作未完成，请检查网络、账户与家庭分享权限后重试" }
    }
    func requireService() throws -> CloudService { guard enabled, let service else { throw RemoteError.disabled }; return service }
    func invite(parentAllowed: @escaping () -> Bool) async {
        guard parentAllowed() else { status = "请先验证本机家长身份"; return }
        await perform {
            let service = try self.requireService()
            let share = try await service.share(parentAllowed: { self.enabled && parentAllowed() })
            guard parentAllowed(), self.enabled else { throw RemoteError.unauthorized }
            self.sharing = CloudSharePresentation(share: share, container: service.container)
        }
    }
    @discardableResult
    func acceptShare(url: URL, parentAllowed: @escaping () -> Bool) async -> Bool {
        var accepted = false
        await perform {
            guard parentAllowed() else { throw RemoteError.unauthorized }
            try await self.requireService().accept(url: url, parentAllowed: { self.enabled && parentAllowed() })
            accepted = true
            if self.enabled { self.status = "已接受共享，请获取摘要" }
        }
        return accepted
    }
    func refreshParticipants() async {
        await perform { self.participants = try await self.requireService().participants(); self.status = "请确认已接受且可写的参与者" }
    }
    func isTrusted(_ id: String) -> Bool { trusted.contains(id) }
    func approve(_ participant: CloudParticipant, parentAllowed: Bool) {
        guard parentAllowed, participant.eligible else { status = "需家长验证及已接受的可写分享权限"; return }
        var values = trusted; values.insert(participant.id); trusted = values; objectWillChange.send(); status = "已确认此家长参与者"
    }
    func revoke(_ id: String, parentAllowed: Bool) {
        guard parentAllowed else { status = "请先验证本机家长身份"; return }
        var values = trusted; values.remove(id); trusted = values; objectWillChange.send(); status = "已撤销本机信任"
    }
    func publish(_ summary: CloudSummary) async {
        await perform { try await self.requireService().publish(summary); self.status = "已上传去标识学习摘要" }
    }
    /// Persist a consumed UUID before applying. Interrupted/failed commands are never retried as new grants.
    /// Receipts are separate deterministic records, so later fetches can resume receipt uploads.
    func process(revision: () -> Int, summary: () -> CloudSummary, apply: (RemoteCommand) throws -> Void) async {
        guard !processing else { status = "正在检查远程指令"; return }
        processing = true
        defer { processing = false }
        await perform {
            let service = try self.requireService()
            let participants = try await service.participants()
            let eligible = Set(participants.filter(\.eligible).map(\.id))
            let records = try await service.records(type: "Command")
            for record in records.sorted(by: { ($0.creationDate ?? .distantPast) < ($1.creationDate ?? .distantPast) }) {
                guard let data = record["payload"] as? Data, data.count <= 64_000,
                      let command = try? JSONDecoder().decode(RemoteCommand.self, from: data),
                      RemoteCommandGate.isTarget(command, deviceID: self.deviceID) else { continue }
                let receiptName = "receipt-\(self.deviceID)-\(record.recordID.recordName)"
                let receiptKey = "BEAA.cloud.receipt.\(self.deviceID).\(record.recordID.recordName)"
                if let existing = self.defaults.data(forKey: receiptKey) {
                    if !self.defaults.bool(forKey: receiptKey + ".uploaded") {
                        guard self.enabled else { throw RemoteError.disabled }
                        try await service.savePayload(existing, name: receiptName, type: "Receipt", revision: revision())
                        self.defaults.set(true, forKey: receiptKey + ".uploaded")
                    }
                    continue
                }
                var outcome = "rejected"
                var reason = "指令数据无效"
                var commandID = record.recordID.recordName
                do {
                    guard let creator = record.creatorUserRecordID?.recordName,
                          let modifier = record.lastModifiedUserRecordID?.recordName else { throw RemoteError.invalid }
                    commandID = command.id.uuidString
                    guard commandID == record.recordID.recordName else { throw RemoteError.invalid }
                    guard self.enabled else { throw RemoteError.disabled }
                    try RemoteCommandGate.validate(command, creator: creator, modifier: modifier, eligible: eligible, trusted: self.trusted, deviceID: self.deviceID, revision: revision(), processed: self.processed, now: Date())
                    var consumed = self.processed; consumed.insert(command.id); self.processed = consumed
                    if command.kind != .requestSummary { try apply(command) }
                    if command.kind == .requestSummary { try await service.publish(summary()) }
                    outcome = "applied"; reason = "本机已接受"
                } catch let error as RemoteError { reason = error.localizedDescription } catch { reason = "本机校验或保存未完成" }
                let receipt = try JSONSerialization.data(withJSONObject: ["id": commandID, "targetDeviceID": self.deviceID, "outcome": outcome, "reason": reason, "revision": revision()])
                self.defaults.set(receipt, forKey: receiptKey)
                guard self.enabled else { throw RemoteError.disabled }
                try await service.savePayload(receipt, name: receiptName, type: "Receipt", revision: revision())
                self.defaults.set(true, forKey: receiptKey + ".uploaded")
            }
            self.status = "指令检查完成，回执已上传"
        }
    }
    func fetchSharedSummaries() async {
        await perform {
            let service = try self.requireService()
            var result: [CloudSummary] = []
            var receipts: [CloudReceipt] = []
            for zone in try await service.sharedZones() {
                result += try await service.summaries(zone: zone.zoneID)
                for record in try await service.records(type: "Receipt", database: service.container.sharedCloudDatabase, zone: zone.zoneID) {
                    guard record.creatorUserRecordID?.recordName == zone.zoneID.ownerName, record.lastModifiedUserRecordID?.recordName == zone.zoneID.ownerName else { continue }
                    guard let data = record["payload"] as? Data, data.count <= 64_000 else { throw RemoteError.invalid }
                    receipts.append(try JSONDecoder().decode(CloudReceipt.self, from: data))
                }
            }
            self.remoteReceipts = receipts
            self.remoteSummaries = result; self.status = "已获取共享摘要"
        }
    }
    func send(kind: RemoteCommand.Kind, target: CloudSummary, minutes: Int? = nil, policy: Policy? = nil, parentAllowed: @escaping () -> Bool) async {
        await perform {
            let service = try self.requireService()
            guard parentAllowed() else { throw RemoteError.unauthorized }
            let sender = try await service.container.userRecordID().recordName
            for zone in try await service.sharedZones() {
                let summaries = try await service.summaries(zone: zone.zoneID)
                guard summaries.contains(where: { $0.deviceID == target.deviceID && $0.revision == target.revision }) else { continue }
                let now = Date()
                let command = RemoteCommand(id: UUID(), targetDeviceID: target.deviceID, senderRecordID: sender, expectedRevision: target.revision, issuedAt: now, expiresAt: now.addingTimeInterval(300), kind: kind, policy: policy, minutes: minutes)
                guard parentAllowed(), self.enabled else { throw RemoteError.unauthorized }
                try await service.send(command, zone: zone.zoneID, parentAllowed: parentAllowed)
                self.status = "指令已发送，等待孩子设备回执"; return
            }
            throw RemoteError.stale
        }
    }
}

struct CloudSharingController: UIViewControllerRepresentable {
    let presentation: CloudSharePresentation
    let completion: (String) -> Void
    func makeCoordinator() -> Coordinator { Coordinator(completion: completion) }
    func makeUIViewController(context: Context) -> UICloudSharingController {
        let controller = UICloudSharingController(share: presentation.share, container: presentation.container)
        controller.availablePermissions = [.allowPrivate, .allowReadWrite]
        controller.delegate = context.coordinator
        return controller
    }
    func updateUIViewController(_ controller: UICloudSharingController, context: Context) {}
    final class Coordinator: NSObject, UICloudSharingControllerDelegate {
        let completion: (String) -> Void
        init(completion: @escaping (String) -> Void) { self.completion = completion }
        func itemTitle(for csc: UICloudSharingController) -> String? { "BEAA Family" }
        func cloudSharingController(_ csc: UICloudSharingController, failedToSaveShareWithError error: Error) { completion("家庭分享未保存，请检查账户与权限后重试") }
        func cloudSharingControllerDidSaveShare(_ csc: UICloudSharingController) { completion("分享已保存，请刷新参与者并本机确认") }
        func cloudSharingControllerDidStopSharing(_ csc: UICloudSharingController) { completion("已停止分享") }
    }
}
