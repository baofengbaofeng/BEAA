import Foundation
import CryptoKit
import Security
import Darwin

protocol SecureStateBackend {
    func read() throws -> Data?
    func write(_ value: Data) throws
}
struct KeychainSecureStateBackend: SecureStateBackend {
    // Deliberately independent of the file path: deleting/moving app files cannot enroll a new ledger.
    private var query: [String: Any] { [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: (Bundle.main.bundleIdentifier ?? "org.beaa.learning") + ".secure-ledger", kSecAttrAccount as String: "device-anchor-v1"] }
    func read() throws -> Data? {
        var q = query; q[kSecReturnData as String] = true
        var result: CFTypeRef?; let status = SecItemCopyMatching(q as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw SecureStoreError.unavailable }
        return data
    }
    func write(_ value: Data) throws {
        var status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: value] as CFDictionary)
        if status == errSecItemNotFound {
            var q = query; q[kSecValueData as String] = value; q[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            status = SecItemAdd(q as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw SecureStoreError.unavailable }
    }
}
enum SecureStoreError: Error { case unavailable, invalid, stale, missing, unauthorized, tooLarge }
struct BackupInspection { let revision: Int; let sameDevice: Bool; let canRestore: Bool }
final class SecureStateStore {
    private struct Anchor: Codable { var key: Data; var revision: Int; var digest: Data? }
    private struct Envelope: Codable { let version: Int; let revision: Int; let ciphertext: Data }
    static let maximumBytes = 16 * 1024 * 1024
    let url: URL
    private var journalURL: URL { url.appendingPathExtension("pending") }
    private let backend: SecureStateBackend
    private(set) var revision = 0
    init(url: URL, backend: SecureStateBackend = KeychainSecureStateBackend()) { self.url = url; self.backend = backend }
    private func locked<T>(_ action: () throws -> T) throws -> T {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let fd = Darwin.open(url.appendingPathExtension("lock").path, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
        guard fd >= 0 else { throw SecureStoreError.unavailable }
        defer { Darwin.close(fd) }
        guard flock(fd, LOCK_EX) == 0 else { throw SecureStoreError.unavailable }
        defer { flock(fd, LOCK_UN) }
        return try action()
    }
    private func readAnchor() throws -> Anchor? {
        guard let bytes = try backend.read() else { return nil }
        let anchor = try JSONDecoder().decode(Anchor.self, from: bytes)
        guard anchor.key.count == 32, anchor.revision >= 0, anchor.digest == nil || anchor.digest?.count == 32 else { throw SecureStoreError.invalid }
        return anchor
    }
    private func bytes(_ target: URL) throws -> Data {
        let size = try target.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? Self.maximumBytes + 1
        guard size <= Self.maximumBytes else { throw SecureStoreError.tooLarge }
        let data = try Data(contentsOf: target)
        guard data.count <= Self.maximumBytes else { throw SecureStoreError.tooLarge }
        return data
    }
    private func digest(_ data: Data) -> Data { Data(SHA256.hash(data: data)) }
    private func aad(_ sequence: Int) -> Data { Data("BEAA-ledger-v1:\(sequence)".utf8) }
    private func decode(_ data: Data, anchor: Anchor) throws -> (LearningState, Int) {
        guard data.count <= Self.maximumBytes else { throw SecureStoreError.tooLarge }
        let envelope = try JSONDecoder().decode(Envelope.self, from: data)
        guard envelope.version == 1, envelope.revision > 0 else { throw SecureStoreError.invalid }
        guard envelope.revision >= anchor.revision else { throw SecureStoreError.stale }
        if envelope.revision == anchor.revision, let expected = anchor.digest, digest(data) != expected { throw SecureStoreError.stale }
        let plaintext = try AES.GCM.open(AES.GCM.SealedBox(combined: envelope.ciphertext), using: SymmetricKey(data: anchor.key), authenticating: aad(envelope.revision))
        let state = try JSONDecoder().decode(LearningState.self, from: plaintext); try state.validate()
        return (state, envelope.revision)
    }
    private func durableWrite(_ data: Data, to target: URL) throws {
        try data.write(to: target, options: [.atomic, .completeFileProtection])
        let fd = Darwin.open(target.path, O_RDONLY)
        guard fd >= 0 else { throw SecureStoreError.unavailable }
        defer { Darwin.close(fd) }
        guard fsync(fd) == 0 else { throw SecureStoreError.unavailable }
        let directory = Darwin.open(target.deletingLastPathComponent().path, O_RDONLY)
        guard directory >= 0 else { throw SecureStoreError.unavailable }
        defer { Darwin.close(directory) }
        // Some filesystems do not support directory fsync; the file itself was synced.
        if fsync(directory) != 0 && errno != EINVAL && errno != ENOTSUP { throw SecureStoreError.unavailable }
    }
    private func exactSnapshot(_ target: URL, anchor: Anchor) throws -> (Data, LearningState) {
        guard let expected = anchor.digest else { throw SecureStoreError.missing }
        let data = try bytes(target)
        guard digest(data) == expected else { throw SecureStoreError.stale }
        let (state, sequence) = try decode(data, anchor: anchor)
        guard sequence == anchor.revision else { throw SecureStoreError.stale }
        return (data, state)
    }
    private func commit(_ state: LearningState, anchor: Anchor) throws {
        try state.validate(); guard anchor.revision < Int.max else { throw SecureStoreError.invalid }
        let next = anchor.revision + 1
        let sealed = try AES.GCM.seal(JSONEncoder().encode(state), using: SymmetricKey(data: anchor.key), authenticating: aad(next))
        guard let combined = sealed.combined else { throw SecureStoreError.invalid }
        let bytes = try JSONEncoder().encode(Envelope(version: 1, revision: next, ciphertext: combined))
        guard bytes.count <= Self.maximumBytes else { throw SecureStoreError.tooLarge }
        // Stage durable authenticated bytes before committing the trusted high water.
        // A journal ahead of the anchor is never accepted. After anchor commit it
        // repairs an interrupted main-file replacement without replaying old quota.
        try durableWrite(bytes, to: journalURL)
        try backend.write(JSONEncoder().encode(Anchor(key: anchor.key, revision: next, digest: digest(bytes))))
        try durableWrite(bytes, to: url)
        revision = next
    }
    func load() throws -> LearningState {
        try locked {
            if let anchor = try readAnchor() {
                guard anchor.digest != nil else { throw SecureStoreError.missing }
                do {
                    let (_, state) = try exactSnapshot(url, anchor: anchor)
                    revision = anchor.revision; return state
                } catch {
                    // Recovery is limited to bytes whose digest and revision exactly
                    // match the existing Keychain anchor, never a future journal.
                    let (data, state) = try exactSnapshot(journalURL, anchor: anchor)
                    if FileManager.default.fileExists(atPath: url.path) { try archive(kind: "interrupted-write") }
                    try durableWrite(data, to: url)
                    revision = anchor.revision; return state
                }
            }
            let exists = FileManager.default.fileExists(atPath: url.path)
            let initial: LearningState
            if exists {
                initial = try JSONDecoder().decode(LearningState.self, from: bytes(url)); try initial.validate()
                try archive(kind: "legacy")
            } else { initial = LearningState(); try initial.validate() }
            let anchor = Anchor(key: SymmetricKey(size: .bits256).withUnsafeBytes { Data($0) }, revision: 0, digest: nil)
            // The first durable anchor is the initialization marker. Commit stages
            // its ciphertext first, so an interrupted first main write is repairable.
            // Before that anchor exists no ledger has yet been enrolled.
            try commit(initial, anchor: anchor)
            return initial
        }
    }
    func save(_ state: LearningState) throws {
        try locked {
            guard let anchor = try readAnchor(), FileManager.default.fileExists(atPath: url.path) else { throw SecureStoreError.missing }
            guard revision == anchor.revision else { throw SecureStoreError.stale }
            let (_, sequence) = try decode(bytes(url), anchor: anchor)
            guard sequence == anchor.revision else { throw SecureStoreError.stale }
            try commit(state, anchor: anchor)
        }
    }
    private func archive(kind: String) throws {
        let target = url.deletingLastPathComponent().appendingPathComponent(url.lastPathComponent + ".\(kind).\(UUID().uuidString)")
        try FileManager.default.copyItem(at: url, to: target)
        try FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: target.path)
    }
    func exportBackup(parentAllowed: () -> Bool) throws -> Data {
        guard parentAllowed() else { throw SecureStoreError.unauthorized }
        return try locked {
            guard let anchor = try readAnchor() else { throw SecureStoreError.missing }
            let data = try bytes(url); let (_, sequence) = try decode(data, anchor: anchor)
            guard sequence == anchor.revision else { throw SecureStoreError.stale }; return data
        }
    }
    func inspectBackup(_ data: Data, parentAllowed: () -> Bool) throws -> BackupInspection {
        guard parentAllowed() else { throw SecureStoreError.unauthorized }
        return try locked {
            guard let anchor = try readAnchor() else { throw SecureStoreError.missing }
            let (_, sequence) = try decode(data, anchor: anchor)
            return BackupInspection(revision: sequence, sameDevice: true, canRestore: true)
        }
    }
    func restoreBackup(_ data: Data, parentAllowed: () -> Bool) throws -> LearningState {
        guard parentAllowed() else { throw SecureStoreError.unauthorized }
        return try locked {
            guard let anchor = try readAnchor() else { throw SecureStoreError.missing }
            let (state, sequence) = try decode(data, anchor: anchor)
            if FileManager.default.fileExists(atPath: url.path) { try archive(kind: "before-restore") }
            // Same revision restores exactly the authenticated snapshot; no budget reset.
            try durableWrite(data, to: journalURL)
            try backend.write(JSONEncoder().encode(Anchor(key: anchor.key, revision: sequence, digest: digest(data))))
            try durableWrite(data, to: url); revision = sequence
            return state
        }
    }
}
