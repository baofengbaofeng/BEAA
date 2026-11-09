import XCTest
@testable import BEAA
final class IntegrationPolicyTests: XCTestCase {
    func testControlRevisionDoesNotAdvanceForUsageButAdvancesForPolicy() throws {
        var state = LearningState()
        try state.recordUsage(seconds: 1)
        XCTAssertEqual(state.controlRevision ?? 0, 0)
        try state.advanceControlRevision()
        XCTAssertEqual(state.controlRevision, 1)
    }
    func testConservativeSettlementNeverRestoresQuota() throws {
        var state = LearningState()
        try state.recordUsage(seconds: 10)
        try state.settleUnmeasuredScope()
        XCTAssertEqual(state.dailySeconds, 1800)
        XCTAssertEqual(state.cycleSeconds, 1800)
        XCTAssertEqual(state.phase, .challengeRequired)
        try state.validate()
    }
    func testPendingPolicyDoesNotInterruptQuizOrEraseCounters() throws {
        var state = LearningState()
        try state.recordUsage(seconds: 1800); try state.startChallenge()
        var policy = state.policy; policy.periodMinutes = 40
        try state.requestPolicy(policy)
        XCTAssertEqual(state.policy.periodMinutes, 30)
        XCTAssertEqual(state.pendingPolicy?.periodMinutes, 40)
        XCTAssertEqual(state.phase, .challengeActive)
        XCTAssertEqual(state.dailySeconds, 1800)
        try state.validate()
    }
    func testDeadlineReceiptClosesMatchingPermitDespiteWallClockRollback() throws {
        var state = LearningState()
        let now = Calendar.current.date(bySettingHour: 12, minute: 0, second: 0, of: Date())!
        state.dayStarted = now
        try state.issuePermit(minutes: 1, now: now)
        let expiry = try XCTUnwrap(state.permit?.expiresAt)
        try state.applyAllowanceDeadline(event: "allowance.end.\(Int(expiry.timeIntervalSince1970))")
        XCTAssertEqual(state.permit?.closedReason, .expired)
        XCTAssertEqual(state.permit?.remaining(now: now), 0)
        XCTAssertTrue(state.permitMode)
        XCTAssertEqual(state.dailySeconds, 60)
        try state.validate()
    }
    func testStaleDeadlineCannotCloseNewEmergency() throws {
        var state = LearningState()
        let now = Calendar.current.date(bySettingHour: 12, minute: 0, second: 0, of: Date())!
        state.dayStarted = now
        try state.recordUsage(seconds: 1800, now: now)
        try state.issueEmergency(minutes: 5, now: now)
        try state.applyAllowanceDeadline(event: "allowance.end.\(Int(now.timeIntervalSince1970))")
        XCTAssertEqual(state.emergencyGrant?.active, true)
        let expiry = try XCTUnwrap(state.emergencyGrant?.expiresAt)
        try state.applyAllowanceDeadline(event: "allowance.end.\(Int(expiry.timeIntervalSince1970))")
        XCTAssertEqual(state.emergencyGrant?.active, false)
        XCTAssertEqual(state.dailySeconds, 2100)
        XCTAssertEqual(state.emergencyGrant?.closedReason, "expired")
        try state.validate()
    }
    func testLateUsageObservationCannotCloseGrantBeforeSettlement() throws {
        var state = LearningState()
        let now = Calendar.current.date(bySettingHour: 12, minute: 0, second: 0, of: Date())!
        state.dayStarted = now
        try state.recordUsage(seconds: 1800, now: now)
        try state.issueEmergency(minutes: 1, now: now)
        let expiry = try XCTUnwrap(state.emergencyGrant?.expiresAt)
        let late = expiry.addingTimeInterval(2)
        // AppModel commit performs this central preflight before every operation.
        try state.settleEndedSystemAllowance(now: late)
        try state.applySystemUsage(totalSeconds: 1830, dayDate: state.dayStarted, now: late)
        try state.applyAllowanceDeadline(event: "allowance.end.\(Int(expiry.timeIntervalSince1970))")
        XCTAssertEqual(state.dailySeconds, 1860)
        XCTAssertEqual(state.emergencyGrant?.usedSeconds, 60)
        XCTAssertEqual(state.emergencyGrant?.active, false)
        try state.validate()
    }
}
