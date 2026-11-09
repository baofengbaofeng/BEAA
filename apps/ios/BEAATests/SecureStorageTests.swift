import XCTest
@testable import BEAA

final class MemorySecureBackend: SecureStateBackend {
    var data: Data?
    var failAfterPersist = false
    var failBeforePersist = false
    func read() throws -> Data? { data }
    func write(_ value: Data) throws { if failBeforePersist { throw SecureStoreError.unavailable }; data = value; if failAfterPersist { throw SecureStoreError.unavailable } }
}
final class SecureStorageTests: XCTestCase {
    func testTamperingMissingFileAndRollbackFailClosed() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathComponent("state")
        let backend = MemorySecureBackend()
        let store = SecureStateStore(url: url, backend: backend)
        var state = try store.load()
        let old = try store.exportBackup(parentAllowed: { true })
        state.dailySeconds = 3; try store.save(state)
        XCTAssertThrowsError(try store.restoreBackup(old, parentAllowed: { true }))
        let latest = try store.exportBackup(parentAllowed: { true })
        try Data("broken".utf8).write(to: url)
        XCTAssertEqual(try store.load().dailySeconds, 3)
        XCTAssertEqual(try store.restoreBackup(latest, parentAllowed: { true }).dailySeconds, 3)
        try FileManager.default.removeItem(at: url)
        XCTAssertEqual(try store.load().dailySeconds, 3)
        try FileManager.default.removeItem(at: url)
        try FileManager.default.removeItem(at: url.appendingPathExtension("pending"))
        XCTAssertThrowsError(try store.load())
        XCTAssertThrowsError(try store.save(LearningState()))
    }
    func testInterruptedAnchorCommitAndStaleWriterCannotResetLedger() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathComponent("state")
        let backend = MemorySecureBackend(); let first = SecureStateStore(url: url, backend: backend)
        var state = try first.load()
        let second = SecureStateStore(url: url, backend: backend); _ = try second.load()
        state.dailySeconds = 8; try first.save(state)
        XCTAssertThrowsError(try second.save(LearningState()))
        let backup = try first.exportBackup(parentAllowed: { true })
        backend.failAfterPersist = true
        state.dailySeconds = 9
        XCTAssertThrowsError(try first.save(state))
        backend.failAfterPersist = false
        XCTAssertEqual(try first.load().dailySeconds, 9)
        XCTAssertThrowsError(try first.restoreBackup(backup, parentAllowed: { true }))
    }
    func testInterruptedEnrollmentDoesNotRetryLegacyMigration() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathComponent("state")
        try StateFile(url: url).save(LearningState())
        let backend = MemorySecureBackend(); backend.failAfterPersist = true
        XCTAssertThrowsError(try SecureStateStore(url: url, backend: backend).load())
        backend.failAfterPersist = false
        XCTAssertEqual(try SecureStateStore(url: url, backend: backend).load().dailySeconds, 0)
        let files = try FileManager.default.contentsOfDirectory(atPath: url.deletingLastPathComponent().path)
        XCTAssertEqual(files.filter { $0.contains("legacy") }.count, 1)
    }
    func testFutureJournalCannotAdvanceOldAnchor() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathComponent("state")
        let backend = MemorySecureBackend(); let store = SecureStateStore(url: url, backend: backend)
        var state = try store.load(); state.dailySeconds = 12
        backend.failBeforePersist = true
        XCTAssertThrowsError(try store.save(state))
        backend.failBeforePersist = false
        XCTAssertEqual(try store.load().dailySeconds, 0)
        try FileManager.default.removeItem(at: url)
        XCTAssertThrowsError(try store.load())
    }
    func testLegacyMigrationAndParentGate() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathComponent("state")
        try StateFile(url: url).save(LearningState())
        let store = SecureStateStore(url: url, backend: MemorySecureBackend())
        _ = try store.load()
        XCTAssertThrowsError(try store.exportBackup(parentAllowed: { false }))
        XCTAssertTrue(try FileManager.default.contentsOfDirectory(atPath: url.deletingLastPathComponent().path).contains { $0.contains("legacy") })
        let other = SecureStateStore(url: url, backend: MemorySecureBackend())
        XCTAssertThrowsError(try other.load())
    }
}
