import SwiftUI
import UniformTypeIdentifiers

struct EncryptedBackupDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.data] }
    var data: Data
    init(data: Data) { self.data = data }
    init(configuration: ReadConfiguration) throws {
        guard let bytes = configuration.file.regularFileContents, bytes.count <= SecureStateStore.maximumBytes else { throw SecureStoreError.tooLarge }
        data = bytes
    }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper { FileWrapper(regularFileWithContents: data) }
}
struct BackupRecoveryView: View {
    let store: SecureStateStore
    let parentAllowed: () -> Bool
    let restored: (LearningState) -> Void
    @State private var exporting = false
    @State private var importing = false
    @State private var document = EncryptedBackupDocument(data: Data())
    @State private var pending: Data?
    @State private var inspection: BackupInspection?
    @State private var message = ""
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            PinyinText("加密备份与恢复", large: true)
            PinyinText("备份仅可在保留本机密钥的同一设备恢复，不支持跨设备迁移。旧于可信修订的备份会被拒绝；恢复不会重置额度。密钥丢失时不能解密。操作需要有效家长授权。")
            Button {
                do { document = EncryptedBackupDocument(data: try store.exportBackup(parentAllowed: parentAllowed)); exporting = true }
                catch { message = "无法导出，请先验证家长身份并检查本机记录" }
            } label: { PinyinText("导出加密备份") }
            Button { importing = true } label: { PinyinText("选择并检查备份") }
            if let inspection {
                PinyinText("已验证本机备份，修订 \(inspection.revision)")
                Button {
                    do {
                        guard let pending else { throw SecureStoreError.invalid }
                        let state = try store.restoreBackup(pending, parentAllowed: parentAllowed)
                        restored(state); self.pending = nil; self.inspection = nil; message = "恢复完成，原文件已保留"
                    } catch { message = "恢复未完成，记录未重置" }
                } label: { PinyinText("确认恢复已检查的备份") }
            }
            if !message.isEmpty { PinyinText(message) }
        }.padding()
        .fileExporter(isPresented: $exporting, document: document, contentType: .data, defaultFilename: "BEAA-encrypted-backup") { result in
            switch result { case .success: message = "备份已导出"; case .failure: message = "备份未导出" }
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.data]) { result in
            pending = nil; inspection = nil
            do {
                let url = try result.get(); let access = url.startAccessingSecurityScopedResource(); defer { if access { url.stopAccessingSecurityScopedResource() } }
                let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? SecureStateStore.maximumBytes + 1
                guard size <= SecureStateStore.maximumBytes else { throw SecureStoreError.tooLarge }
                let data = try Data(contentsOf: url)
                inspection = try store.inspectBackup(data, parentAllowed: parentAllowed); pending = data
            } catch { message = "备份无法验证，可能过旧、损坏或不属于本机" }
        }
    }
}
