import XCTest
@testable import BEAA

final class EmergencyGrantTests: XCTestCase {
    func testEmergencyCountsDailyAndNeverResetsExhaustedCycle() throws {
        var state = LearningState(); let now = state.dayStarted
        state.cycleSeconds = state.policy.periodMinutes * 60; state.phase = .challengeRequired
        try state.issueEmergency(minutes: 1, now: now)
        try state.recordUsage(seconds: 60, now: now)
        XCTAssertEqual(state.dailySeconds, 60)
        XCTAssertEqual(state.cycleSeconds, state.policy.periodMinutes * 60)
        XCTAssertEqual(state.phase, .challengeRequired)
        XCTAssertEqual(state.emergencyGrant?.closedReason, "budgetExhausted")
        try state.validate()
    }
    func testProjectedUsageExhaustsEmergencyWithoutResettingCycle() throws {
        var state = LearningState(); let now = state.dayStarted
        state.phase = .challengeRequired; state.cycleSeconds = state.policy.periodMinutes * 60
        try state.issueEmergency(minutes: 1, now: now)
        XCTAssertTrue(state.canUse(now: now))
        try state.applySystemUsage(totalSeconds: 90, dayDate: now, now: now)
        XCTAssertEqual(state.dailySeconds, 90)
        XCTAssertEqual(state.emergencyGrant?.usedSeconds, 60)
        XCTAssertEqual(state.emergencyGrant?.closedReason, "budgetExhausted")
        XCTAssertEqual(state.cycleSeconds, state.policy.periodMinutes * 60)
        XCTAssertFalse(state.canUse(now: now))
        try state.applySystemUsage(totalSeconds: 90, dayDate: now, now: now)
        XCTAssertEqual(state.dailySeconds, 90)
        XCTAssertEqual(state.emergencyGrant?.usedSeconds, 60)
        XCTAssertEqual(state.emergencyAudit?.filter { $0.event == "budgetExhausted" }.count, 1)
        try state.validate()
    }
    func testProjectedUsageExhaustsOrdinaryPermitAndKeepsFullDailyLowerBound() throws {
        var state = LearningState(); let now = state.dayStarted
        state.cycleSeconds = state.policy.periodMinutes * 60 - 120
        try state.issuePermit(minutes: 1, now: now)
        try state.applySystemUsage(totalSeconds: 180, dayDate: now, now: now)
        XCTAssertEqual(state.dailySeconds, 180)
        XCTAssertEqual(state.permit?.usedSeconds, 60)
        XCTAssertEqual(state.permit?.closedReason, .budgetExhausted)
        XCTAssertEqual(state.cycleSeconds, state.policy.periodMinutes * 60)
        XCTAssertEqual(state.phase, .challengeRequired)
        XCTAssertFalse(state.canUse(now: now))
        try state.applySystemUsage(totalSeconds: 180, dayDate: now, now: now)
        XCTAssertEqual(state.permitAudit.filter { $0.event == "budgetExhausted" }.count, 1)
        try state.validate()
    }
    func testProjectedDailyCapClosesActiveGrantBeforeValidation() throws {
        var state = LearningState(); let now = state.dayStarted
        try state.issuePermit(minutes: 1, now: now)
        try state.applySystemUsage(totalSeconds: state.policy.dailyMinutes * 60, dayDate: now, now: now)
        XCTAssertEqual(state.phase, .dailyLocked)
        XCTAssertFalse(state.permit?.active ?? true)
        try state.validate()
    }
    func testRollbackAndDailyGuards() throws {
        var state = LearningState(); let now = state.dayStarted
        XCTAssertThrowsError(try state.issueEmergency(minutes: 1, now: now))
        state.phase = .challengeRequired; state.cycleSeconds = state.policy.periodMinutes * 60
        try state.issueEmergency(minutes: 1, now: now)
        state.observeEmergency(now: now.addingTimeInterval(-1))
        XCTAssertEqual(state.emergencyGrant?.closedReason, "clockRollback")
        state.dailySeconds = state.policy.dailyMinutes * 60 - 59
        XCTAssertThrowsError(try state.issueEmergency(minutes: 1, now: now))
    }
    func testAbsoluteUsageIsIdempotentAndRestSurvivesDailyCap() throws {
        var state = LearningState(); let now = state.dayStarted
        try state.applySystemUsage(totalSeconds: 120, dayDate: now, now: now)
        try state.applySystemUsage(totalSeconds: 60, dayDate: now, now: now)
        XCTAssertEqual(state.dailySeconds, 120); XCTAssertEqual(state.cycleSeconds, 120)
        state.phase = .restRequired
        try state.applySystemUsage(totalSeconds: state.policy.dailyMinutes * 60, dayDate: now, now: now)
        XCTAssertEqual(state.dailySuspendedPhase, .restRequired)
        let next = Calendar.current.date(byAdding: .day, value: 1, to: now)!
        try state.rollDay(to: next)
        XCTAssertEqual(state.phase, .restRequired)
        XCTAssertThrowsError(try state.applySystemUsage(totalSeconds: 1, dayDate: now, now: next))
    }
}
