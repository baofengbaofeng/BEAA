import Foundation

struct QuestionBank {
    static var bundledQuestions: [Question] {
        guard let url = Bundle.main.url(forResource: "starter-bank", withExtension: "json"),
              let data = try? Data(contentsOf: url), let questions = try? decode(data) else { return Question.samples }
        return questions
    }
    static var bundledNotice: String {
        bundledQuestions.count == 90 ? "内置九十道基础题，覆盖范围有限，仍需教师审核，不代表完整课程。" : "基础题库资源未能读取，使用五道流程样题，不代表完整课程。"
    }
    private struct ImportBank: Decodable { let version: Int; let questions: [ImportQuestion] }
    private struct BrowserQuestion: Decodable {
        let id: String; let grade: Int; let subject: String; let text: String
        let options: [String]; let answer: Int; let expectedNumeric: String?; let type: QuestionType
        let explain: String; let topic: String?; let absoluteTolerance: String?
        enum CodingKeys: String, CodingKey { case id, grade, subject, text, options, answer, type, explain, topic, absoluteTolerance }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = try c.decode(String.self, forKey: .id); grade = try c.decode(Int.self, forKey: .grade)
            subject = try c.decode(String.self, forKey: .subject); text = try c.decode(String.self, forKey: .text)
            explain = try c.decode(String.self, forKey: .explain); topic = try c.decodeIfPresent(String.self, forKey: .topic)
            if c.contains(.type) { type = try c.decode(QuestionType.self, forKey: .type) }
            else { type = .singleChoice }
            absoluteTolerance = try c.decodeIfPresent(String.self, forKey: .absoluteTolerance)
            if type.isTextResponse {
                guard !c.contains(.options) else { throw LearningError.invalidState }
                options = []; answer = 0; expectedNumeric = try c.decode(String.self, forKey: .answer)
            } else {
                options = try c.decode([String].self, forKey: .options)
                answer = try c.decode(Int.self, forKey: .answer); expectedNumeric = nil
            }
        }
    }
    private struct Option: Decodable { let id: String; let text: String }
    private struct ImportQuestion: Decodable {
        let id: String; let grade: Int; let subject: String; let type: String; let stem: String
        let options: [Option]; let correctOptionId: String; let explanation: String; let knowledgePoints: [String]?
    }
    static func decode(_ data: Data) throws -> [Question] {
        guard data.count <= 2_000_000 else { throw LearningError.invalidState }
        let subjects = ["math": "数学", "chinese": "语文", "english": "英语"]
        if data.first(where: { ![9, 10, 13, 32].contains($0) }) == 91 {
            let items = try JSONDecoder().decode([BrowserQuestion].self, from: data)
            guard (1...2000).contains(items.count), Set(items.map(\.id)).count == items.count else { throw LearningError.invalidState }
            return try items.map { item in
                guard let subject = subjects[item.subject] else { throw LearningError.invalidState }
                let question = Question(id: item.id, subject: subject, prompt: item.text, options: item.options, correct: item.answer, explanation: item.explain, grade: item.grade, topic: item.topic ?? defaultTopic(subject: item.subject), type: item.type, expectedNumeric: item.expectedNumeric, absoluteTolerance: item.absoluteTolerance)
                try validate(question); return question
            }
        }
        let decoded = try JSONDecoder().decode(ImportBank.self, from: data)
        guard decoded.version == 1, (1...2000).contains(decoded.questions.count) else { throw LearningError.invalidState }
        let result = try decoded.questions.map { q -> Question in
            guard q.type == "single_choice", let subject = subjects[q.subject],
                  Set(q.options.map(\.id)).count == q.options.count,
                  q.options.allSatisfy({ !$0.id.isEmpty && $0.id.count <= 64 && $0.id == trimmed($0.id) }),
                  let correct = q.options.firstIndex(where: { $0.id == q.correctOptionId }) else { throw LearningError.invalidState }
            let question = Question(id: q.id, subject: subject, prompt: q.stem, options: q.options.map(\.text), correct: correct, explanation: q.explanation, grade: q.grade, topic: q.knowledgePoints?.first ?? defaultTopic(subject: q.subject), knowledgePoints: q.knowledgePoints ?? [])
            try validate(question); return question
        }
        guard Set(result.map(\.id)).count == result.count else { throw LearningError.invalidState }
        return result
    }
    private static func trimmed(_ text: String) -> String { text.trimmingCharacters(in: .whitespacesAndNewlines) }
    static func defaultTopic(subject: String) -> String {
        ["math": "arithmetic", "chinese": "poetry", "english": "vocabulary"][subject] ?? "general"
    }
    static func validate(_ q: Question) throws {
        guard !q.id.isEmpty, q.id == trimmed(q.id), q.id.count <= 128, (1...6).contains(q.grade),
              ["语文", "数学", "英语"].contains(q.subject), !trimmed(q.prompt).isEmpty, q.prompt.count <= 2000,
              !q.topic.isEmpty, q.topic == trimmed(q.topic), q.topic.count <= 128,
              q.knowledgePoints.count <= 32, Set(q.knowledgePoints).count == q.knowledgePoints.count,
              q.knowledgePoints.allSatisfy({ !$0.isEmpty && $0 == trimmed($0) && $0.count <= 80 }),
              !trimmed(q.explanation).isEmpty, q.explanation.count <= 4000 else { throw LearningError.invalidState }
        switch q.type {
        case .numeric, .fraction, .numericTolerance:
            guard q.options.isEmpty, q.correct == 0, let value = q.expectedNumeric,
                  TextAnswer.normalize(value, type: q.type) == value else { throw LearningError.invalidState }
            if q.type == .numericTolerance {
                guard let tolerance = q.absoluteTolerance, NumericAnswer.normalize(tolerance) == tolerance,
                      let value = Decimal(string: tolerance), value >= 0 else { throw LearningError.invalidState }
            } else if q.absoluteTolerance != nil { throw LearningError.invalidState }
        case .singleChoice, .trueFalse:
            guard q.expectedNumeric == nil, q.absoluteTolerance == nil, (2...8).contains(q.options.count),
                  Set(q.options.map(trimmed)).count == q.options.count, q.options.indices.contains(q.correct),
                  q.options.allSatisfy({ !trimmed($0).isEmpty && $0.count <= 1000 }),
                  q.type != .trueFalse || q.options == ["正确", "错误"] else { throw LearningError.invalidState }
        }
    }
}
struct ForegroundClock {
    private var previous: TimeInterval?
    mutating func start(at uptime: TimeInterval?) { previous = uptime }
    mutating func consume(at now: TimeInterval) -> Int {
        guard let last = previous else { return 0 }
        let delta = now - last
        guard delta >= 0, delta <= 3 else { previous = now; return 0 }
        let seconds = Int(delta)
        previous = last + Double(seconds)
        return seconds
    }
}
