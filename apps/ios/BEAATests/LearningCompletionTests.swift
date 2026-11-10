import XCTest
@testable import BEAA

final class LearningCompletionTests: XCTestCase {
    func testFractionAndToleranceUseExplicitTypes() throws {
        XCTAssertEqual(RationalAnswer.normalize("2/-4"), "-1/2")
        XCTAssertEqual(RationalAnswer.normalize("0/-4"), "0/1")
        for value in ["1/0", "1.2/3", "1e2/3", "1000000001/2"] { XCTAssertNil(RationalAnswer.normalize(value)) }
        let source = """
        [{"id":"f","grade":3,"subject":"math","text":"分数","type":"fraction","answer":"1/2","explain":"约分"},
        {"id":"t","grade":3,"subject":"math","text":"估算","type":"numeric_tolerance","answer":"0.3","absoluteTolerance":"0.1","explain":"误差"}]
        """
        let questions = try QuestionBank.decode(Data(source.utf8))
        XCTAssertTrue(TextAnswer.matches("2/4", question: questions[0]))
        XCTAssertTrue(TextAnswer.matches("0.4", question: questions[1]))
        XCTAssertFalse(TextAnswer.matches("0.400001", question: questions[1]))
        XCTAssertFalse(TextAnswer.matches("1/2", question: Question.samples[0]))
    }
    func testTextCorrectionPreservesFirstAttemptAndTimestamp() throws {
        var state = LearningState()
        state.policy.questionCount = 1; state.policy.requiredCorrect = 1
        state.phase = .challengeActive; state.cycleSeconds = state.policy.periodMinutes * 60
        state.questions = [Question(id: "f", subject: "数学", prompt: "分数", options: [], correct: 0, explanation: "约分", type: .fraction, expectedNumeric: "1/2")]
        let now = state.dayStarted
        try state.answerText(questionID: "f", input: "1/3", now: now)
        XCTAssertThrowsError(try state.answerText(questionID: "f", input: "1/4", now: now))
        try state.answerText(questionID: "f", input: "2/4", now: now)
        XCTAssertFalse(state.records[0].passed)
        XCTAssertFalse(state.records[0].answers[0].correct)
        XCTAssertTrue(state.records[0].answers[0].corrected)
        XCTAssertEqual(state.records[0].date, now)
        try state.validate()
    }
    func testLegacyQuestionDefaultsAndExplicitToleranceRequired() throws {
        let data = try JSONEncoder().encode(Question.samples[0])
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        object.removeValue(forKey: "type"); object.removeValue(forKey: "absoluteTolerance")
        let legacy = try JSONDecoder().decode(Question.self, from: JSONSerialization.data(withJSONObject: object))
        XCTAssertEqual(legacy.type, .singleChoice)
        let missingTolerance = Question(id: "n", subject: "数学", prompt: "估算", options: [], correct: 0, explanation: "误差", type: .numericTolerance, expectedNumeric: "1")
        XCTAssertThrowsError(try QuestionBank.validate(missingTolerance))
    }
}
