import XCTest
@testable import BEAA

final class LifecycleTests: XCTestCase {
    func testDailyCapWinsOverChallenge() throws {
        var state = LearningState()
        state.policy.dailyMinutes = 15
        try state.recordUsage(seconds: 900)
        XCTAssertEqual(state.phase, .dailyLocked)
        XCTAssertThrowsError(try state.startChallenge())
    }
    func testWrongFirstAnswerCannotBeChanged() throws {
        var state = LearningState()
        try state.recordUsage(seconds: 1800)
        try state.startChallenge()
        let question = state.questions[0]
        try state.answer(questionID: question.id, choice: (question.correct + 1) % question.options.count)
        try state.answer(questionID: question.id, choice: question.correct)
        XCTAssertTrue(state.answers[0].corrected)
        XCTAssertEqual(state.answers.count, 1)
        XCTAssertFalse(state.answers[0].correct)
    }
    func testPassingChallengeStillRequiresRest() throws {
        var state = LearningState()
        try state.recordUsage(seconds: 1800)
        try state.startChallenge()
        for question in state.questions { try state.answer(questionID: question.id, choice: question.correct) }
        XCTAssertEqual(state.phase, .restRequired)
        XCTAssertThrowsError(try state.finishRest())
        try state.recordRest(seconds: 600)
        try state.finishRest()
        XCTAssertEqual(state.phase, .available)
        XCTAssertEqual(state.dailySeconds, 1800)
        XCTAssertEqual(state.cycleSeconds, 0)
    }
    func testCorruptionIsNotReplacedWithFreshAllowance() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("state.json")
        try Data("broken".utf8).write(to: url)
        XCTAssertThrowsError(try StateFile(url: url).load())
        XCTAssertEqual(try Data(contentsOf: url), Data("broken".utf8))
    }
    func testAtomicRoundTripPreservesAnswer() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let file = StateFile(url: directory.appendingPathComponent("state.json"))
        var state = LearningState()
        try state.recordUsage(seconds: 1800)
        try state.startChallenge()
        try state.answer(questionID: state.questions[0].id, choice: 0)
        try file.save(state)
        XCTAssertEqual(try file.load().answers.count, 1)
    }
    func testInvalidPolicyAndForgedProgressFailValidation() {
        var state = LearningState()
        state.policy.requiredCorrect = 30
        XCTAssertThrowsError(try state.validate())
        state = LearningState()
        state.dailySeconds = -1
        XCTAssertThrowsError(try state.validate())
    }
    func testMalformedPinnedQuestionFailsClosedBeforeAnswer() throws {
        var state = LearningState()
        try state.recordUsage(seconds: 1800)
        try state.startChallenge()
        state.questions[0] = Question(id: "forged", subject: "数学", prompt: "fake", options: [], correct: 0, explanation: "fake")
        XCTAssertThrowsError(try state.validate())
    }

    func testStaleAnswerDoesNotMutateCommittedProgress() throws {
        var state = LearningState()
        try state.recordUsage(seconds: 1800); try state.startChallenge()
        let first = state.questions[0]
        try state.answer(questionID: first.id, choice: first.correct)
        XCTAssertThrowsError(try state.answer(questionID: first.id, choice: first.correct))
        XCTAssertEqual(state.answers.count, 1)
        XCTAssertEqual(state.questionIndex, 1)
        try state.validate()
    }

}
