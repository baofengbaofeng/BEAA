import Foundation
import CryptoKit
import CommonCrypto
import Security

enum TransferMigrationError: Error { case invalid, password, occupied, confirmationRequired }

/// Portable format is deliberately unrelated to the device-bound backup envelope.
enum TransferMigration {
    static let maximumBytes = SecureStateStore.maximumBytes
    static let iterations: UInt32 = 600_000
    private static let aad = Data("BEAA-portable-migration-v1:PBKDF2-SHA256:600000:AES-256-GCM".utf8)
    private struct Envelope: Codable {
        let format: String
        let version: Int
        let iterations: UInt32
        let salt: Data
        let ciphertext: Data
    }
    private struct Payload: Codable { let version: Int; let state: LearningState }
    private static func key(password: String, salt: Data) throws -> SymmetricKey {
        let passwordBytes = Array(password.utf8)
        guard (12...1024).contains(passwordBytes.count), salt.count == 32 else { throw TransferMigrationError.password }
        var result = [UInt8](repeating: 0, count: 32)
        defer { result.withUnsafeMutableBytes { $0.initializeMemory(as: UInt8.self, repeating: 0) } }
        let status = passwordBytes.withUnsafeBytes { pass in
            salt.withUnsafeBytes { saltBytes in
                CCKeyDerivationPBKDF(CCPBKDFAlgorithm(kCCPBKDF2), pass.baseAddress!.assumingMemoryBound(to: Int8.self), passwordBytes.count,
                                    saltBytes.baseAddress!.assumingMemoryBound(to: UInt8.self), salt.count,
                                    CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256), iterations, &result, 32)
            }
        }
        guard status == kCCSuccess else { throw TransferMigrationError.invalid }
        return SymmetricKey(data: result)
    }
    static func encode(_ original: LearningState, password: String) throws -> Data {
        try original.validate(); try original.validateControlState()
        guard original.migrationConfirmationPending != true else { throw TransferMigrationError.confirmationRequired }
        var state = original
        // Unknown remaining source system usage is charged before removing grants.
        if state.permit?.active == true || state.emergencyGrant?.active == true { try state.settleUnmeasuredScope() }
        state.permit = nil; state.permitMode = false; state.emergencyGrant = nil
        state.protectedRestAnchor = nil; state.controlRevision = nil
        state.migrationConfirmationPending = true
        try state.validate(); try state.validateControlState()
        let plaintext = try JSONEncoder().encode(Payload(version: 1, state: state))
        guard plaintext.count <= maximumBytes / 2 else { throw SecureStoreError.tooLarge }
        var salt = Data(count: 32)
        let status = salt.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, 32, $0.baseAddress!) }
        guard status == errSecSuccess else { throw TransferMigrationError.invalid }
        let sealed = try AES.GCM.seal(plaintext, using: key(password: password, salt: salt), authenticating: aad)
        guard let ciphertext = sealed.combined else { throw TransferMigrationError.invalid }
        let data = try JSONEncoder().encode(Envelope(format: "BEAA-portable-migration", version: 1, iterations: iterations, salt: salt, ciphertext: ciphertext))
        guard data.count <= maximumBytes else { throw SecureStoreError.tooLarge }
        return data
    }
    static func decode(_ data: Data, password: String) throws -> LearningState {
        guard data.count <= maximumBytes else { throw SecureStoreError.tooLarge }
        let envelope = try JSONDecoder().decode(Envelope.self, from: data)
        guard envelope.format == "BEAA-portable-migration", envelope.version == 1,
              envelope.iterations == iterations, envelope.salt.count == 32 else { throw TransferMigrationError.invalid }
        let plaintext = try AES.GCM.open(AES.GCM.SealedBox(combined: envelope.ciphertext), using: key(password: password, salt: envelope.salt), authenticating: aad)
        guard plaintext.count <= maximumBytes / 2 else { throw SecureStoreError.tooLarge }
        let payload = try JSONDecoder().decode(Payload.self, from: plaintext)
        let state = payload.state
        guard payload.version == 1, state.migrationConfirmationPending == true,
              state.permit == nil, !state.permitMode, state.emergencyGrant == nil,
              state.protectedRestAnchor == nil, state.controlRevision == nil,
              state.dayStarted.timeIntervalSinceReferenceDate.isFinite else { throw TransferMigrationError.invalid }
        try state.validate(); try state.validateControlState()
        return state
    }
}
