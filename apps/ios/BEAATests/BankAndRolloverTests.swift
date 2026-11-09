import XCTest
@testable import BEAA
final class BankAndRolloverTests: XCTestCase {
    func testRolloverPreservesRestAndCycle() throws {
        var state = LearningState()
        try state.recordUsage(seconds: 1800); try state.startChallenge()
        for q in state.questions { try state.answer(questionID: q.id, choice: q.correct) }
        try state.recordRest(seconds: 10)
        try state.rollDay(to: state.dayStarted.addingTimeInterval(86400))
        XCTAssertEqual(state.phase, .restRequired)
        XCTAssertEqual(state.restSeconds, 10)
        XCTAssertEqual(state.cycleSeconds, 1800)
        XCTAssertEqual(state.dailySeconds, 0)
        try state.validate()
    }
    func testImportRejectsMissingCorrectOption() {
        let json = #"{"version":1,"questions":[{"id":"one","grade":1,"subject":"math","type":"single_choice","stem":"1+1","options":[{"id":"a","text":"2"},{"id":"b","text":"3"}],"correctOptionId":"missing","explanation":"two"}]}"#
        XCTAssertThrowsError(try QuestionBank.decode(Data(json.utf8)))
    }
    func testImportedBankFiltersGradeAndSubject() throws {
        var state = LearningState()
        state.policy.questionCount = 1; state.policy.requiredCorrect = 1
        state.policy.subjects = ["数学"]
        try state.recordUsage(seconds: 1800); try state.startChallenge()
        XCTAssertEqual(state.questions.count, 1)
        XCTAssertEqual(state.questions[0].subject, "数学")
    }
    func testClockKeepsFractionalSeconds() {
        var clock = ForegroundClock()
        clock.start(at: 0)
        XCTAssertEqual(clock.consume(at: 1.8), 1)
        XCTAssertEqual(clock.consume(at: 3.1), 2)
    }
    func testBrowserArrayImport() throws {
        let json = #"[{"id":"browser-one","grade":1,"subject":"math","topic":"arithmetic","text":"3 + 4 = ?","options":["7","6","8"],"answer":0,"explain":"3加4等于7。"}]"#
        let bank = try QuestionBank.decode(Data(json.utf8))
        XCTAssertEqual(bank[0].grade, 1)
        XCTAssertEqual(bank[0].correct, 0)
        XCTAssertEqual(bank[0].subject, "数学")
    }
    func testInsufficientSelectionDoesNotMutateState() throws {
        var state = LearningState()
        state.policy.grade = 1
        try state.recordUsage(seconds: 1800)
        XCTAssertThrowsError(try state.startChallenge())
        XCTAssertEqual(state.phase, .challengeRequired)
        XCTAssertEqual(state.cycleSeconds, 1800)
        try state.validate()
    }

}
