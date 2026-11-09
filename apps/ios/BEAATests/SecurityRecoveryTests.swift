import XCTest
@testable import BEAA

final class SecurityRecoveryTests: XCTestCase {
    func testRecoveryIsSingleUseAndPINChangeRequiresOldPIN() throws {
        let backend = MemorySecureBackend(); let vault = ParentVault(backend: backend)
        try vault.enroll("123456")
        XCTAssertThrowsError(try vault.changePIN(old: "000000", new: "654321", confirmation: "654321"))
        let code = try vault.makeRecoveryCode(pin: "123456")
        XCTAssertEqual(code.count, 32)
        XCTAssertFalse(String(data: backend.data!, encoding: .utf8)!.contains(code))
        try vault.recoverPIN(code: code, new: "654321", confirmation: "654321")
        try vault.verify("654321")
        XCTAssertThrowsError(try vault.recoverPIN(code: code, new: "123456", confirmation: "123456"))
    }
    func testRecoveryRateLimitSurvivesNewVaultInstance() throws {
        let backend = MemorySecureBackend(); let vault = ParentVault(backend: backend)
        try vault.enroll("123456"); let code = try vault.makeRecoveryCode(pin: "123456")
        let now = Date()
        for _ in 0..<5 { XCTAssertThrowsError(try vault.recoverPIN(code: "wrong", new: "654321", confirmation: "654321", now: now)) }
        let second = ParentVault(backend: backend)
        XCTAssertThrowsError(try second.recoverPIN(code: code, new: "654321", confirmation: "654321", now: now))
    }
}
