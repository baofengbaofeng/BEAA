import XCTest
@testable import BEAA

final class AnswerTypeTests: XCTestCase {
    func testExactNormalization() {
        XCTAssertNil(NumericAnswer.normalize("\u{0085}2\u{0085}"))
        XCTAssertEqual(NumericAnswer.normalize("\u{FEFF}2\u{FEFF}"), "2")
        for (input, expected) in [(" ＋００２．５００ ", "2.5"), ("−0.000", "0"), (".5", "0.5"), ("2.", "2")] {
            XCTAssertEqual(NumericAnswer.normalize(input), expected)
        }
        for invalid in ["", "1e2", "1/2", "1 kg", "1,000", "1 2", "1234567890123", "0.1234567", String(repeating: "0", count: 49)] {
            XCTAssertNil(NumericAnswer.normalize(invalid))
        }
    }
    func testMixedClientImportAndStrictCanonicalAnswer() throws {
        let source = """
        [{"id":"n","grade":3,"subject":"math","topic":"arithmetic","text":"计算","type":"numeric","answer":"0.5","explain":"解释"},
        {"id":"b","grade":3,"subject":"math","text":"判断","type":"true_false","options":["正确","错误"],"answer":1,"explain":"解释"}]
        """
        let bank = try QuestionBank.decode(Data(source.utf8))
        XCTAssertEqual(bank[0].expectedNumeric, "0.5")
        XCTAssertEqual(bank[1].type, .trueFalse)
        XCTAssertThrowsError(try QuestionBank.decode(Data(source.replacingOccurrences(of: "\"0.5\"", with: "\"00.50\"").utf8)))
        XCTAssertThrowsError(try QuestionBank.decode(Data(source.replacingOccurrences(of: "\"type\":\"numeric\"", with: "\"type\":\"numeric\",\"options\":[]").utf8)))
    }
    func testLegacyQuestionDefaultsToChoice() throws {
        let data = Data(#"{"id":"old","subject":"数学","prompt":"题","options":["甲","乙"],"correct":0,"explanation":"解释","grade":3,"topic":"general","knowledgePoints":[]}"#.utf8)
        XCTAssertEqual(try JSONDecoder().decode(Question.self, from: data).type, .singleChoice)
    }
    func testInvalidWrongCorrectionAndReload() throws {
        var state = LearningState()
        state.policy.questionCount = 1; state.policy.requiredCorrect = 1
        state.bank = [Question(id: "n", subject: "数学", prompt: "计算", options: [], correct: 0, explanation: "解释", type: .numeric, expectedNumeric: "0.5")]
        try state.recordUsage(seconds: 1800); try state.startChallenge()
        XCTAssertThrowsError(try state.answerNumeric(questionID: "n", input: "NaN"))
        XCTAssertTrue(state.answers.isEmpty)
        XCTAssertThrowsError(try state.answer(questionID: "n", choice: 0))
        try state.answerNumeric(questionID: "n", input: "0.6")
        state = try JSONDecoder().decode(LearningState.self, from: JSONEncoder().encode(state))
        try state.validate()
        XCTAssertEqual(state.answers[0].numericValue, "0.6")
        try state.answerNumeric(questionID: "n", input: "０．５")
        XCTAssertFalse(state.records[0].answers[0].correct)
        XCTAssertTrue(state.records[0].answers[0].corrected)
        XCTAssertEqual(state.phase, .challengeRequired)
        try state.validate()
    }
    func testForgedTypedAnswersFailRestorationValidation() throws {
        var state = LearningState()
        state.policy.questionCount = 1; state.policy.requiredCorrect = 1
        state.bank = [Question(id: "n", subject: "数学", prompt: "计算", options: [], correct: 0, explanation: "解释", type: .numeric, expectedNumeric: "1")]
        try state.recordUsage(seconds: 1800); try state.startChallenge()
        try state.answerNumeric(questionID: "n", input: "2")
        state.answers = [Answer(questionID: "n", choice: 0, correct: true, numericValue: "2")]
        XCTAssertThrowsError(try state.validate())
        state.answers = [Answer(questionID: "n", choice: 0, correct: false, numericValue: "02")]
        XCTAssertThrowsError(try state.validate())
        state.answers = [Answer(questionID: "n", choice: 0, correct: true)]
        XCTAssertThrowsError(try state.validate())
    }
    func testSharedV1StillRejectsTypedQuestions() {
        let data = Data(#"{"version":1,"questions":[{"id":"n","grade":3,"subject":"math","type":"numeric","stem":"题","options":[],"correctOptionId":"0","explanation":"解释"}]}"#.utf8)
        XCTAssertThrowsError(try QuestionBank.decode(data))
    }
    func testNumericCorrectAnswerPassesAndPreservesRestGuard() throws {
        var state = LearningState()
        state.policy.questionCount = 1; state.policy.requiredCorrect = 1
        state.bank = [Question(id: "n", subject: "数学", prompt: "计算", options: [], correct: 0, explanation: "解释", type: .numeric, expectedNumeric: "1")]
        try state.recordUsage(seconds: 1800); try state.startChallenge()
        try state.answerNumeric(questionID: "n", input: "+01.00")
        XCTAssertEqual(state.phase, .restRequired)
        XCTAssertThrowsError(try state.finishRest())
        XCTAssertThrowsError(try state.answerNumeric(questionID: "n", input: "1"))
        try state.validate()
    }
    func testNumericQuietGuard() throws {
        var state = LearningState()
        state.phase = .challengeActive
        state.questions = [Question(id: "n", subject: "数学", prompt: "计算", options: [], correct: 0, explanation: "解释", type: .numeric, expectedNumeric: "1")]
        let now = Calendar.current.date(bySettingHour: 12, minute: 0, second: 0, of: Date())!
        let weekday = Calendar.current.component(.weekday, from: now)
        state.policy.quietWindows = [QuietWindow(days: [(weekday + 5) % 7 + 1], startMinute: 0, endMinute: 1439)]
        XCTAssertThrowsError(try state.answerNumeric(questionID: "n", input: "1", now: now))
        XCTAssertTrue(state.answers.isEmpty)
    }
}
