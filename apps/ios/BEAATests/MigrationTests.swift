import XCTest
@testable import BEAA

final class MigrationTests: XCTestCase {
    private let password = "a long migration passphrase 2026"
    private func store() throws -> SecureStateStore {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathComponent("state")
        let store = SecureStateStore(url: url, backend: MemorySecureBackend())
        _ = try store.load(); return store
    }
    func testDifferentDeviceTransferRetainsSpentBudgetUntilExplicitConfirmation() throws {
        let source = try store(); var original = try source.load()
        original.dailySeconds = 121; original.cycleSeconds = 121
        original.dayStarted = Calendar.current.date(byAdding: .day, value: -2, to: Date())!
        try source.save(original)
        let data = try source.exportMigration(password: password, parentAllowed: { true })
        let target = try store()
        XCTAssertThrowsError(try target.restoreBackup(data, parentAllowed: { true }))
        let imported = try target.importMigration(data, password: password, parentAllowed: { true })
        XCTAssertEqual(imported.dailySeconds, 121); XCTAssertEqual(imported.cycleSeconds, 121)
        XCTAssertEqual(imported.migrationConfirmationPending, true)
        XCTAssertFalse(imported.canUse())
        XCTAssertNil(imported.permit); XCTAssertNil(imported.emergencyGrant)
        XCTAssertThrowsError(try target.confirmMigration(parentAllowed: { false }))
        let confirmed = try target.confirmMigration(parentAllowed: { true })
        XCTAssertNil(confirmed.migrationConfirmationPending)
        XCTAssertEqual(confirmed.dailySeconds, 121); XCTAssertEqual(confirmed.cycleSeconds, 121)
        XCTAssertTrue(Calendar.current.isDateInToday(confirmed.dayStarted))
        XCTAssertEqual(try source.load().dailySeconds, 121)
    }
    func testWrongPasswordTamperingAndOccupiedTargetLeaveLedgerUnchanged() throws {
        let source = try store()
        let data = try source.exportMigration(password: password, parentAllowed: { true })
        let target = try store()
        XCTAssertThrowsError(try target.importMigration(data, password: "wrong password long enough", parentAllowed: { true }))
        var object = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        var ciphertext = Data(base64Encoded: object["ciphertext"] as! String)!
        ciphertext[ciphertext.count - 1] ^= 1; object["ciphertext"] = ciphertext.base64EncodedString()
        XCTAssertThrowsError(try target.importMigration(JSONSerialization.data(withJSONObject: object), password: password, parentAllowed: { true }))
        var current = try target.load(); current.dailySeconds = 7; try target.save(current)
        XCTAssertThrowsError(try target.importMigration(data, password: password, parentAllowed: { true }))
        XCTAssertEqual(try target.load().dailySeconds, 7)
        current.dailySeconds = 0; try target.save(current)
        XCTAssertThrowsError(try target.importMigration(data, password: password, parentAllowed: { true }))
    }
    func testParentExpiryAndRepeatedImportFailClosed() throws {
        let source = try store()
        let data = try source.exportMigration(password: password, parentAllowed: { true })
        let target = try store(); var checks = 0
        XCTAssertThrowsError(try target.importMigration(data, password: password, parentAllowed: { checks += 1; return checks == 1 }))
        XCTAssertEqual(try target.load().dailySeconds, 0)
        _ = try target.importMigration(data, password: password, parentAllowed: { true })
        XCTAssertThrowsError(try target.importMigration(data, password: password, parentAllowed: { true }))
        XCTAssertThrowsError(try target.exportMigration(password: password, parentAllowed: { true }))
    }
    func testUnfinishedChallengeAndAuditSurviveWithoutActiveGrants() throws {
        let source = try store(); var original = try source.load()
        original.dailySeconds = original.policy.periodMinutes * 60
        original.cycleSeconds = original.policy.periodMinutes * 60
        original.phase = .challengeRequired
        try original.startChallenge()
        try source.save(original)
        let data = try source.exportMigration(password: password, parentAllowed: { true })
        let target = try store()
        let imported = try target.importMigration(data, password: password, parentAllowed: { true })
        XCTAssertEqual(imported.phase, .challengeActive)
        XCTAssertEqual(imported.questions.map(\.id), original.questions.map(\.id))
        XCTAssertEqual(imported.roundID, original.roundID)
        XCTAssertEqual(imported.dailySeconds, original.dailySeconds)
        XCTAssertNil(imported.emergencyGrant)
    }
    func testActiveEmergencyIsConservativelyChargedAndRemoved() throws {
        let source = try store(); var original = try source.load()
        original.dailySeconds = original.policy.periodMinutes * 60
        original.cycleSeconds = original.policy.periodMinutes * 60
        original.phase = .challengeRequired
        try original.issueEmergency(minutes: 2)
        try source.save(original)
        let data = try source.exportMigration(password: password, parentAllowed: { true })
        let target = try store()
        let imported = try target.importMigration(data, password: password, parentAllowed: { true })
        XCTAssertEqual(imported.dailySeconds, original.dailySeconds + 120)
        XCTAssertEqual(imported.emergencyAudit?.first?.id, original.emergencyAudit?.first?.id)
        XCTAssertNil(imported.emergencyGrant)
        XCTAssertEqual(try source.load().dailySeconds, original.dailySeconds)
        XCTAssertEqual(try source.load().emergencyGrant?.active, true)
    }
    func testMissingAnchorCannotEnrollThroughMigration() throws {
        let source = try store()
        let data = try source.exportMigration(password: password, parentAllowed: { true })
        let target = SecureStateStore(url: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathComponent("state"), backend: MemorySecureBackend())
        XCTAssertThrowsError(try target.importMigration(data, password: password, parentAllowed: { true }))
    }
    func testMalformedVersionKDFAndOversizeAreRejected() throws {
        let source = try store()
        let data = try source.exportMigration(password: password, parentAllowed: { true })
        var object = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        object["iterations"] = 1
        XCTAssertThrowsError(try TransferMigration.decode(JSONSerialization.data(withJSONObject: object), password: password))
        object["version"] = 99
        XCTAssertThrowsError(try TransferMigration.decode(JSONSerialization.data(withJSONObject: object), password: password))
        XCTAssertThrowsError(try TransferMigration.decode(Data(repeating: 0, count: TransferMigration.maximumBytes + 1), password: password))
    }
}
