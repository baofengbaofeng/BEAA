import XCTest
@testable import BEAA

final class RemoteCommandTests: XCTestCase {
    let now = Date(timeIntervalSince1970: 2_000_000)
    func command(kind: RemoteCommand.Kind = .emergencyGrant, target: String = "child", revision: Int = 7, sender: String = "parent", issuedOffset: Double = -1, lifetime: Double = 300) -> RemoteCommand {
        let issued = now.addingTimeInterval(issuedOffset)
        return RemoteCommand(id: UUID(), targetDeviceID: target, senderRecordID: sender, expectedRevision: revision, issuedAt: issued, expiresAt: issued.addingTimeInterval(lifetime), kind: kind, minutes: kind == .emergencyGrant ? 5 : nil)
    }
    func validate(_ value: RemoteCommand, creator: String = "parent", modifier: String = "parent", eligible: Set<String> = ["parent"], trusted: Set<String> = ["parent"], processed: Set<UUID> = []) throws {
        try RemoteCommandGate.validate(value, creator: creator, modifier: modifier, eligible: eligible, trusted: trusted, deviceID: "child", revision: 7, processed: processed, now: now)
    }
    func testAcceptedWritableConfirmedCreatorPasses() throws { try validate(command()) }
    func testPayloadCannotImpersonateConfirmedCreator() { XCTAssertThrowsError(try validate(command(), creator: "attacker")) }
    func testInviteeCannotEditConfirmedCreatorCommand() { XCTAssertThrowsError(try validate(command(), modifier: "attacker")) }
    func testReadOnlyOrUnacceptedParticipantRejected() { XCTAssertThrowsError(try validate(command(), eligible: [])) }
    func testNotLocallyConfirmedRejected() { XCTAssertThrowsError(try validate(command(), trusted: [])) }
    func testReplayRejected() { let value = command(); XCTAssertThrowsError(try validate(value, processed: [value.id])) }
    func testWrongTargetAndStaleRevisionRejected() {
        XCTAssertThrowsError(try validate(command(target: "other")))
        XCTAssertThrowsError(try validate(command(revision: 6)))
    }
    func testExpiredFutureAndOverlongEnvelopesRejected() {
        XCTAssertThrowsError(try validate(command(issuedOffset: -301)))
        XCTAssertThrowsError(try validate(command(issuedOffset: 1)))
        XCTAssertThrowsError(try validate(command(lifetime: 301)))
    }
    func testGrantBoundsAndExtraneousPayloadRejected() {
        var value = command(); value.minutes = 31; XCTAssertThrowsError(try validate(value))
        value = command(kind: .endGrant); value.minutes = 1; XCTAssertThrowsError(try validate(value))
        value = command(kind: .setPolicy); XCTAssertThrowsError(try validate(value))
        value.policy = Policy(); XCTAssertNoThrow(try validate(value))
        value.policy?.dailyMinutes = 0; XCTAssertThrowsError(try validate(value))
    }
}

final class CloudSummaryProvenanceTests: XCTestCase {
    let deviceID = UUID().uuidString
    func summary(revision: Int = 4, answered: Int = 10, correct: Int = 8, used: Int = 120, policy: Policy? = Policy()) -> CloudSummary {
        CloudSummary(deviceID: deviceID, revision: revision, date: Date(), answeredCount: answered, correctCount: correct, usedSeconds: used, policy: policy)
    }
    func validate(_ value: CloudSummary, creator: String? = "owner", modifier: String? = "owner", name: String? = nil) throws {
        try CloudSummaryGate.validate(value, creator: creator, modifier: modifier, owner: "owner", recordName: name ?? "summary-\(deviceID)")
    }
    func testOnlyOwnerCreatedAndLastWrittenSummaryCanProvidePolicy() throws {
        try validate(summary())
        XCTAssertThrowsError(try validate(summary(), creator: "invitee"))
        XCTAssertThrowsError(try validate(summary(), modifier: "invitee"))
        XCTAssertThrowsError(try validate(summary(), modifier: nil))
    }
    func testRecordIdentityMustMatchDevicePayload() {
        XCTAssertThrowsError(try validate(summary(), name: "summary-other-device"))
    }
    func testSummaryBoundsAndPolicyValidated() {
        XCTAssertThrowsError(try validate(summary(revision: -1)))
        XCTAssertThrowsError(try validate(summary(answered: -1)))
        XCTAssertThrowsError(try validate(summary(answered: 3, correct: 4)))
        XCTAssertThrowsError(try validate(summary(used: 36_001)))
        var policy = Policy(); policy.periodMinutes = 0
        XCTAssertThrowsError(try validate(summary(policy: policy)))
    }
    func testForeignTargetIsFilteredBeforeJournalOrReceipt() {
        let command = RemoteCommand(id: UUID(), targetDeviceID: "other-child", senderRecordID: "guardian", expectedRevision: 1,
            issuedAt: Date(), expiresAt: Date().addingTimeInterval(60), kind: .requestSummary)
        XCTAssertFalse(RemoteCommandGate.isTarget(command, deviceID: deviceID))
        XCTAssertTrue(RemoteCommandGate.isTarget(command, deviceID: "other-child"))
    }
}
