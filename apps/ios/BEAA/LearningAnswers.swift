import Foundation

/// Integer arithmetic only. Oversized rational input is rejected before any multiplication.
enum RationalAnswer {
    static func normalize(_ input: String) -> String? {
        let parts = input.trimmingCharacters(in: .whitespacesAndNewlines).split(separator: "/", omittingEmptySubsequences: false)
        guard input.utf16.count <= 48, parts.count == 2, parts.allSatisfy({ $0.count <= 11 }),
              let n = Int64(parts[0]), let d = Int64(parts[1]), d != 0,
              abs(n) <= 1_000_000_000, abs(d) <= 1_000_000_000 else { return nil }
        var a = abs(n), b = abs(d)
        while b != 0 { let remainder = a % b; a = b; b = remainder }
        let divisor = max(a, 1)
        return "\(n / divisor * (d < 0 ? -1 : 1))/\(abs(d) / divisor)"
    }
}
enum TextAnswer {
    static func normalize(_ input: String, type: QuestionType) -> String? {
        type == .fraction ? RationalAnswer.normalize(input) : NumericAnswer.normalize(input)
    }
    static func matches(_ input: String, question: Question) -> Bool {
        guard let value = normalize(input, type: question.type), let expected = question.expectedNumeric else { return false }
        if question.type != .numericTolerance { return value == expected }
        guard let actual = Decimal(string: value, locale: Locale(identifier: "en_US_POSIX")),
              let target = Decimal(string: expected, locale: Locale(identifier: "en_US_POSIX")),
              let raw = question.absoluteTolerance,
              let tolerance = Decimal(string: raw, locale: Locale(identifier: "en_US_POSIX")), tolerance >= 0 else { return false }
        return abs(actual - target) <= tolerance
    }
}
extension LearningState {
    mutating func answerText(questionID: String, input: String, now: Date = Date()) throws {
        guard !isQuiet(now: now), phase == .challengeActive, questionIndex < questions.count else { throw LearningError.invalidAction }
        let question = questions[questionIndex]
        guard question.id == questionID, question.type.isTextResponse,
              let value = TextAnswer.normalize(input, type: question.type) else { throw LearningError.invalidAction }
        let correct = TextAnswer.matches(value, question: question)
        if questionIndex < answers.count {
            guard correct else { throw LearningError.invalidAction }
            answers[questionIndex].corrected = true
        } else {
            answers.append(Answer(questionID: questionID, choice: 0, correct: correct, numericValue: value))
        }
        if questionIndex == questions.count {
            let passed = answers.filter(\.correct).count >= policy.requiredCorrect
            records.append(LearningRecord(date: now, questions: questions, answers: answers, passed: passed))
            records = Array(records.suffix(100)); phase = passed ? .restRequired : .challengeRequired; restSeconds = 0
        }
    }
}
