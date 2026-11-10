import SwiftUI
import UniformTypeIdentifiers

struct TransferMigrationView: View {
    let store: SecureStateStore
    let parentAllowed: () -> Bool
    let restored: (LearningState) -> Void
    var prepareExport: () throws -> Void = {}
    @Environment(\.scenePhase) private var scenePhase
    @State private var password = ""
    @State private var confirmation = ""
    @State private var consent = false
    @State private var exporting = false
    @State private var importing = false
    @State private var document = EncryptedBackupDocument(data: Data())
    @State private var pending: Data?
    @State private var message = ""
    @State private var awaitingConfirmation = false
    private func clearSecrets() { password = ""; confirmation = ""; pending = nil; consent = false }
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            PinyinText("跨设备迁移", large: true)
            PinyinText("请由家长操作。迁移包包含学习记录、题库、规则和审核历史，不包含家长密码、设备密钥、云端信任或有效授权。目标必须是尚未使用的新账本；已有记录的目标会拒绝导入。")
            PinyinText("系统监控开启时，导出前会保守结算尚未确认的当前预算，可能提前进入挑战。")
            PinyinText("离线迁移无法停用原设备。导出后请停止在原设备使用，妥善保管迁移包与口令。忘记口令无法恢复。")
            PinyinText("迁移口令至少十二个字节，请使用长口令")
            SecureField("", text: $password).textContentType(.newPassword).textFieldStyle(.roundedBorder).accessibilityLabel("迁移口令")
            PinyinText("再次输入导出口令")
            SecureField("", text: $confirmation).textFieldStyle(.roundedBorder).accessibilityLabel("再次输入迁移口令")
            Toggle(isOn: $consent) { PinyinText("我确认导出学习资料，并停止使用原设备") }
            Button {
                defer { clearSecrets() }
                do {
                    guard parentAllowed(), consent, password == confirmation else { throw TransferMigrationError.password }
                    try prepareExport()
                    document = EncryptedBackupDocument(data: try store.exportMigration(password: password, parentAllowed: parentAllowed)); exporting = true
                } catch { message = "导出未完成，请检查家长授权、口令和确认选项" }
            } label: { PinyinText("确认并导出迁移包") }
            Button {
                guard parentAllowed() else { clearSecrets(); message = "请重新验证家长身份"; return }
                pending = nil; importing = true
            } label: { PinyinText("选择迁移包") }
            if pending != nil {
                PinyinText("已选择文件。请输入原设备导出口令，并确认导入。新设备已有资料时不会覆盖。")
                Button {
                    defer { clearSecrets() }
                    do {
                        guard let data = pending else { throw TransferMigrationError.invalid }
                        let state = try store.importMigration(data, password: password, parentAllowed: parentAllowed)
                        awaitingConfirmation = true; restored(state)
                        message = "迁移资料已保存，使用仍锁定。请重新验证家长身份，确认今天的预算。"
                    } catch TransferMigrationError.occupied { message = "目标已有记录，无法安全覆盖。请保留两端资料，使用新的目标账本。" }
                    catch { message = "迁移未完成，可能是口令错误、文件损坏或家长授权已结束；原记录未重置" }
                } label: { PinyinText("确认导入资料，暂不授权使用") }
            }
            if awaitingConfirmation {
                PinyinText("确认将保留原设备已用预算、未完成挑战和休息进度，并把这些已用预算计入今天，不会清零。未来日期的来源记录需先纠正设备时间。系统权限和监控需在本机重新设置。")
                Button {
                    do {
                        let state = try store.confirmMigration(parentAllowed: parentAllowed)
                        awaitingConfirmation = false; restored(state); message = "今天的迁移预算已确认，原有累计保持。请按本机流程设置系统权限。"
                    } catch { message = "确认未完成，请重新验证家长身份并检查日期" }
                } label: { PinyinText("家长确认今天并保留已用预算") }
            }
            if !message.isEmpty { PinyinText(message) }
        }.padding()
        .onAppear { awaitingConfirmation = (try? store.load().migrationConfirmationPending) == true }
        .onDisappear { clearSecrets(); document = EncryptedBackupDocument(data: Data()) }
        .onChange(of: scenePhase) { _, phase in if phase != .active { clearSecrets(); document = EncryptedBackupDocument(data: Data()) } }
        .fileExporter(isPresented: $exporting, document: document, contentType: .data, defaultFilename: "BEAA-portable-migration") { result in
            document = EncryptedBackupDocument(data: Data()); clearSecrets()
            switch result { case .success: message = "迁移包已导出，请停止使用原设备"; case .failure: message = "迁移包未导出" }
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.data]) { result in
            pending = nil
            do {
                guard parentAllowed() else { throw SecureStoreError.unauthorized }
                let url = try result.get(); let access = url.startAccessingSecurityScopedResource()
                defer { if access { url.stopAccessingSecurityScopedResource() } }
                let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? TransferMigration.maximumBytes + 1
                guard size <= TransferMigration.maximumBytes else { throw SecureStoreError.tooLarge }
                let data = try Data(contentsOf: url)
                guard data.count <= TransferMigration.maximumBytes, parentAllowed() else { throw SecureStoreError.unauthorized }
                pending = data
            } catch { clearSecrets(); message = "文件未读取，请检查大小、文件权限和家长授权" }
        }
    }
}
