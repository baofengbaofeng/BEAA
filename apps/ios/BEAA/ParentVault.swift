import Foundation
import Security
import CommonCrypto
import CryptoKit
import LocalAuthentication

enum VaultError: Error { case unavailable, invalidPIN, locked, incorrect }
struct Credential: Codable { var salt: Data; var hash: Data; var failures: Int; var lockedUntil: Date?; var recoveryHash: Data? = nil; var recoveryFailures: Int? = nil; var recoveryLockedUntil: Date? = nil }
final class ParentVault {
    private let backend: SecureStateBackend?
    init(backend: SecureStateBackend? = nil) { self.backend = backend }
    private let service = "org.beaa.learning.parent"
    private let account = "guardian"
    private func query() -> [String: Any] { [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account] }
    static func validPIN(_ pin: String) -> Bool { pin.utf8.count == 6 && pin.utf8.allSatisfy { (48...57).contains($0) } }
    static func derive(_ pin: String, salt: Data) throws -> Data {
        var output = [UInt8](repeating: 0, count: 32)
        let result = pin.withCString { password in
            salt.withUnsafeBytes { bytes in
                CCKeyDerivationPBKDF(CCPBKDFAlgorithm(kCCPBKDF2), password, pin.utf8.count,
                                    bytes.bindMemory(to: UInt8.self).baseAddress, salt.count,
                                    CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256), 210_000, &output, 32)
            }
        }
        guard result == kCCSuccess else { throw VaultError.unavailable }
        return Data(output)
    }
    func read() throws -> Credential? {
        if let backend {
            guard let data = try backend.read() else { return nil }; return try validated(data)
        }
        var request = query(); request[kSecReturnData as String] = true; request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw VaultError.unavailable }
        return try validated(data)
    }
    private func validated(_ data: Data) throws -> Credential {
        let credential = try JSONDecoder().decode(Credential.self, from: data)
        guard credential.salt.count == 16, credential.hash.count == 32, credential.failures >= 0, credential.recoveryHash == nil || credential.recoveryHash?.count == 32, (credential.recoveryFailures ?? 0) >= 0 else { throw VaultError.unavailable }
        return credential
    }
    private func write(_ credential: Credential) throws {
        let data = try JSONEncoder().encode(credential)
        if let backend { try backend.write(data); return }
        let attributes: [String: Any] = [kSecValueData as String: data]
        var status = SecItemUpdate(query() as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var request = query(); request[kSecValueData as String] = data
            request[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            status = SecItemAdd(request as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw VaultError.unavailable }
    }
    func enroll(_ pin: String) throws {
        guard try read() == nil, Self.validPIN(pin) else { throw VaultError.invalidPIN }
        var salt = [UInt8](repeating: 0, count: 16)
        guard SecRandomCopyBytes(kSecRandomDefault, salt.count, &salt) == errSecSuccess else { throw VaultError.unavailable }
        let bytes = Data(salt)
        try write(Credential(salt: bytes, hash: Self.derive(pin, salt: bytes), failures: 0, lockedUntil: nil, recoveryHash: nil, recoveryFailures: nil, recoveryLockedUntil: nil))
    }
    func verify(_ pin: String, now: Date = Date()) throws {
        guard var credential = try read() else { throw VaultError.unavailable }
        if let until = credential.lockedUntil, now < until { throw VaultError.locked }
        let candidate = try Self.derive(pin, salt: credential.salt)
        let difference = zip(candidate, credential.hash).reduce(UInt8(0)) { $0 | ($1.0 ^ $1.1) }
        if difference != 0 {
            credential.failures += 1
            if credential.failures >= 5 { credential.lockedUntil = now.addingTimeInterval(300) }
            try write(credential)
            throw VaultError.incorrect
        }
        credential.failures = 0; credential.lockedUntil = nil
        try write(credential)
    }

    private func random(_ count: Int) throws -> Data {
        var bytes = [UInt8](repeating: 0, count: count)
        guard SecRandomCopyBytes(kSecRandomDefault, count, &bytes) == errSecSuccess else { throw VaultError.unavailable }
        return Data(bytes)
    }
    func changePIN(old: String, new: String, confirmation: String) throws {
        guard Self.validPIN(new), new == confirmation else { throw VaultError.invalidPIN }
        try verify(old)
        guard var credential = try read() else { throw VaultError.unavailable }
        credential.salt = try random(16); credential.hash = try Self.derive(new, salt: credential.salt)
        try write(credential); try disableBiometrics()
    }
    func makeRecoveryCode(pin: String) throws -> String {
        try verify(pin)
        guard var credential = try read() else { throw VaultError.unavailable }
        let code = try random(16).map { String(format: "%02X", $0) }.joined()
        credential.recoveryHash = Data(SHA256.hash(data: Data(code.utf8)))
        credential.recoveryFailures = 0; credential.recoveryLockedUntil = nil
        try write(credential); return code
    }
    func recoverPIN(code: String, new: String, confirmation: String, now: Date = Date()) throws {
        guard Self.validPIN(new), new == confirmation else { throw VaultError.invalidPIN }
        guard var credential = try read(), let expected = credential.recoveryHash else { throw VaultError.unavailable }
        if let until = credential.recoveryLockedUntil, now < until { throw VaultError.locked }
        let normalized = code.uppercased().replacingOccurrences(of: "-", with: "").replacingOccurrences(of: " ", with: "")
        let candidate = Data(SHA256.hash(data: Data(normalized.utf8)))
        guard zip(expected, candidate).reduce(UInt8(0), { $0 | ($1.0 ^ $1.1) }) == 0 else {
            credential.recoveryFailures = min(5, (credential.recoveryFailures ?? 0) + 1)
            if credential.recoveryFailures == 5 { credential.recoveryLockedUntil = now.addingTimeInterval(300) }
            try write(credential); throw VaultError.incorrect
        }
        credential.salt = try random(16); credential.hash = try Self.derive(new, salt: credential.salt)
        credential.failures = 0; credential.lockedUntil = nil
        credential.recoveryHash = nil; credential.recoveryFailures = nil; credential.recoveryLockedUntil = nil
        try write(credential); try disableBiometrics()
    }
    private var biometricQuery: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: "biometry-current-set"]
    }
    private func disableBiometrics() throws {
        if backend != nil { return }
        let status = SecItemDelete(biometricQuery as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw VaultError.unavailable }
    }
    func setBiometrics(enabled: Bool, pin: String) throws {
        guard backend == nil else { throw VaultError.unavailable }
        try verify(pin); try disableBiometrics()
        guard enabled else { return }
        guard let credential = try read() else { throw VaultError.unavailable }
        var error: Unmanaged<CFError>?
        guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly, .biometryCurrentSet, &error) else { throw VaultError.unavailable }
        var q = biometricQuery; q[kSecAttrAccessControl as String] = access; q[kSecValueData as String] = credential.hash
        guard SecItemAdd(q as CFDictionary, nil) == errSecSuccess else { throw VaultError.unavailable }
    }
    func verifyBiometrics() async throws {
        guard backend == nil else { throw VaultError.unavailable }
        let context = LAContext(); context.localizedFallbackTitle = ""
        context.localizedCancelTitle = "取消 · " + ChineseReading.pinyin("取消")
        let allowed = try await context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: "验证已由家长开启的本机生物识别\n" + ChineseReading.pinyin("验证已由家长开启的本机生物识别"))
        guard allowed, let credential = try read() else { throw VaultError.incorrect }
        var q = biometricQuery; q[kSecReturnData as String] = true; q[kSecUseAuthenticationContext as String] = context
        var result: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &result) == errSecSuccess, let marker = result as? Data,
              marker == credential.hash else { throw VaultError.incorrect }
    }
}
