import XCTest
@testable import BEAA
final class TemporaryPermitTests: XCTestCase {
    func testPermitCannotExceedExistingDailyOrCycleAllowance() throws {
        var state = LearningState()
        state.policy.periodMinutes = 5
        XCTAssertThrowsError(try state.issuePermit(minutes: 6, now: Date(timeIntervalSince1970: 1000)))
        try state.issuePermit(minutes: 5, now: Date(timeIntervalSince1970: 1000))
        XCTAssertEqual(state.dailySeconds, 0)
        XCTAssertEqual(state.cycleSeconds, 0)
    }
    func testPermitBudgetCountsActualUsageAndPersists() throws {
        var state = LearningState()
        let now = Date(timeIntervalSince1970: 1000)
        try state.issuePermit(minutes: 1, now: now)
        try state.recordUsage(seconds: 20, now: now.addingTimeInterval(20))
        let restored = try JSONDecoder().decode(LearningState.self, from: JSONEncoder().encode(state))
        XCTAssertEqual(restored.permit?.usedSeconds, 20)
        XCTAssertEqual(restored.dailySeconds, 20)
        try restored.validate()
    }
    func testPermitRollbackAndExpiryCloseWithoutGrantingAllowance() throws {
        var state = LearningState()
        let now = Date(timeIntervalSince1970: 1000)
        try state.issuePermit(minutes: 1, now: now)
        state.observePermit(now: now.addingTimeInterval(-1))
        XCTAssertEqual(state.permit?.closedReason, .clockRollback)
        XCTAssertEqual(state.dailySeconds, 0)
        state.endPermit(now: now)
        try state.issuePermit(minutes: 1, now: now)
        state.observePermit(now: now.addingTimeInterval(60))
        XCTAssertEqual(state.permit?.closedReason, .expired)
    }
    func testDailyCapStillWinsAndChallengeCannotIssuePermit() throws {
        var state = LearningState()
        state.policy.periodMinutes = 30; state.policy.dailyMinutes = 15
        let now = Date(timeIntervalSince1970: 1000)
        try state.issuePermit(minutes: 15, now: now)
        try state.recordUsage(seconds: 900, now: now.addingTimeInterval(1))
        XCTAssertEqual(state.phase, .dailyLocked)
        XCTAssertNotNil(state.permit?.closedReason)
        XCTAssertThrowsError(try state.issuePermit(minutes: 1, now: now))
    }
    func testTopicSelectionFiltersBank() throws {
        var state = LearningState()
        state.policy.questionCount = 1; state.policy.requiredCorrect = 1
        state.policy.topics = ["arithmetic"]
        try state.recordUsage(seconds: 1800)
        try state.startChallenge()
        XCTAssertEqual(state.questions.first?.topic, "arithmetic")
    }
    func testExpiredModeStopsUsageUntilParentEnds() throws {
        var state = LearningState()
        let now = Date(timeIntervalSince1970: 1000)
        try state.issuePermit(minutes: 1, now: now)
        try state.recordUsage(seconds: 1, now: now.addingTimeInterval(61))
        XCTAssertEqual(state.dailySeconds, 0)
        XCTAssertTrue(state.permitMode)
        XCTAssertEqual(state.permit?.closedReason, .expired)
        state.endPermit(now: now.addingTimeInterval(62))
        try state.recordUsage(seconds: 1, now: now.addingTimeInterval(63))
        XCTAssertEqual(state.dailySeconds, 1)
        XCTAssertFalse(state.permitMode)
    }
    func testNewDayClosesPermitWithoutResettingCycle() throws {
        var state = LearningState()
        let now = state.dayStarted
        try state.issuePermit(minutes: 1, now: now)
        try state.recordUsage(seconds: 10, now: now.addingTimeInterval(10))
        try state.rollDay(to: now.addingTimeInterval(86400))
        XCTAssertFalse(state.permitMode)
        XCTAssertFalse(state.permit?.active ?? true)
        XCTAssertEqual(state.cycleSeconds, 10)
        XCTAssertEqual(state.dailySeconds, 0)
    }

    func testConsumptionNeverExceedsPermitBudget() throws {
        var state = LearningState()
        let now = Date(timeIntervalSince1970: 1000)
        try state.issuePermit(minutes: 1, now: now)
        try state.recordUsage(seconds: 120, now: now.addingTimeInterval(1))
        XCTAssertEqual(state.dailySeconds, 60)
        XCTAssertEqual(state.permit?.usedSeconds, 60)
        XCTAssertEqual(state.permit?.closedReason, .budgetExhausted)
        try state.recordUsage(seconds: 1, now: now.addingTimeInterval(2))
        XCTAssertEqual(state.dailySeconds, 60)
    }

    func testSharedBankRetainsSecondaryKnowledgePointAndEightOptions() throws {
        let options = (0..<8).map { ["id": "option-\($0)", "text": "\($0)"] }
        let value: [String: Any] = ["version": 1, "questions": [["id": "eight", "grade": 3, "subject": "math", "type": "single_choice", "stem": "Choose", "options": options, "correctOptionId": "option-7", "explanation": "Eight options", "knowledgePoints": ["first", "second"]]]]
        let bank = try QuestionBank.decode(JSONSerialization.data(withJSONObject: value))
        XCTAssertEqual(bank[0].knowledgePoints, ["first", "second"])
        var policy = Policy(); policy.topics = ["second"]
        XCTAssertTrue(policy.matches(bank[0]))
        XCTAssertEqual(bank[0].options.count, 8)
    }
    func testWhitespaceOnlyAndAmbiguousOptionsAreRejected() {
        let q = Question(id: "valid", subject: "数学", prompt: "question", options: ["A", " A "], correct: 0, explanation: "explanation")
        XCTAssertThrowsError(try QuestionBank.validate(q))
        let blank = Question(id: "valid", subject: "数学", prompt: "  ", options: ["A", "B"], correct: 0, explanation: "explanation")
        XCTAssertThrowsError(try QuestionBank.validate(blank))
    }

    func testExhaustedCycleStillRequiresParentEndBeforeChallenge() throws {
        var state = LearningState(); state.policy.periodMinutes = 5
        let now = Date(timeIntervalSince1970: 1000)
        try state.issuePermit(minutes: 5, now: now)
        try state.recordUsage(seconds: 300, now: now.addingTimeInterval(1))
        XCTAssertEqual(state.phase, .challengeRequired)
        XCTAssertThrowsError(try state.startChallenge())
        state.endPermit(now: now.addingTimeInterval(2))
        try state.startChallenge()
        XCTAssertEqual(state.phase, .challengeActive)
    }

}
