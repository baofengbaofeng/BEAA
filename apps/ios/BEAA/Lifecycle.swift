import Foundation

enum LearningError: Error { case invalidState, invalidAction, invalidPolicy }
enum Phase: String, Codable { case available, challengeRequired, challengeActive, restRequired, dailyLocked }
struct Policy: Codable {
    var periodMinutes = 30
    var dailyMinutes = 120
    var restMinutes = 10
    var questionCount = 5
    var requiredCorrect = 5
    var grade = 3
    var topics: [String] = []
    var quietWindows: [QuietWindow] = []
    var subjects = ["语文", "数学", "英语"]
    func validate() throws {
        try QuietHours.validate(quietWindows)
        guard (5...120).contains(periodMinutes), (15...600).contains(dailyMinutes),
              (0...60).contains(restMinutes), (1...20).contains(questionCount),
              (1...questionCount).contains(requiredCorrect), (1...6).contains(grade), !subjects.isEmpty,
              Set(subjects).count == subjects.count, topics.count <= 2000,
              Set(topics).count == topics.count, topics.allSatisfy({ !$0.isEmpty && $0.count <= 128 }), subjects.allSatisfy({ ["语文", "数学", "英语"].contains($0) }) else { throw LearningError.invalidPolicy }
    }
    func matches(_ question: Question) -> Bool {
        question.grade == grade && subjects.contains(question.subject) && (topics.isEmpty || topics.contains(question.topic) || question.knowledgePoints.contains(where: { topics.contains($0) }))
    }

}
struct Question: Codable, Identifiable, Equatable {
    let id: String
    let subject: String
    let prompt: String
    let options: [String]
    let correct: Int
    let explanation: String
    var grade = 3
    var topic = "general"
    var knowledgePoints: [String] = []
    var type = QuestionType.singleChoice
    var expectedNumeric: String? = nil
    var absoluteTolerance: String? = nil
    static let samples: [Question] = [
        .init(id: "math-1", subject: "数学", prompt: "36 ÷ 4 + 7 = ?", options: ["16", "11", "18"], correct: 0, explanation: "先算除法：36 ÷ 4 = 9，再算加法：9 + 7 = 16。", topic: "arithmetic"),
        .init(id: "chinese-1", subject: "语文", prompt: "“春眠不觉晓”的下一句是？", options: ["花落知多少", "处处闻啼鸟", "夜来风雨声"], correct: 1, explanation: "《春晓》中写道：春眠不觉晓，处处闻啼鸟。", topic: "poetry"),
        .init(id: "english-1", subject: "英语", prompt: "“苹果”的英文是？", options: ["book", "apple", "cat"], correct: 1, explanation: "apple 表示苹果，book 表示书，cat 表示猫。", topic: "vocabulary"),
        .init(id: "math-2", subject: "数学", prompt: "一个正方形有几条边？", options: ["3", "4", "5"], correct: 1, explanation: "正方形有四条长度相等的边。", topic: "geometry"),
        .init(id: "chinese-2", subject: "语文", prompt: "“大”的反义词是？", options: ["小", "高", "长"], correct: 0, explanation: "大和小意思相反，是一组反义词。", topic: "vocabulary")
    ]
}
struct Answer: Codable { let questionID: String; let choice: Int; let correct: Bool; var corrected = false; var numericValue: String? = nil }
struct LearningRecord: Codable, Identifiable {
    var id = UUID()
    let date: Date
    let questions: [Question]
    let answers: [Answer]
    let passed: Bool
}
struct LearningState: Codable {
    var version = 1
    var migrationConfirmationPending: Bool?
    var controlRevision: Int?
    var pendingPolicy: Policy?
    var protectedRestAnchor: ProtectedRestAnchor?
    var policy = Policy()
    var phase = Phase.available
    var dailySeconds = 0
    var cycleSeconds = 0
    var restSeconds = 0
    var permitMode = false
    var permit: TemporaryPermit?
    var permitAudit: [PermitAudit] = []
    var emergencyGrant: EmergencyGrant?
    var emergencyAudit: [EmergencyAudit]?
    var dailySuspendedPhase: Phase?
    var bank = QuestionBank.bundledQuestions
    var roundID = UUID()
    var questions: [Question] = []
    var answers: [Answer] = []
    var records: [LearningRecord] = []
    // Calendar rollover requires explicit parent acknowledgement; never silently reset on wall clock changes.
    var dayStarted = Date()
    mutating func recordUsage(seconds: Int, now: Date = Date()) throws {
        observeEmergency(now: now)
        guard !isQuiet(now: now), seconds >= 0, seconds <= 86400, phase == .available || (phase == .challengeRequired && emergencyGrant?.active == true) else { throw LearningError.invalidAction }
        if emergencyGrant?.active == true {
            let counted = min(seconds, emergencyRemaining(now: now), max(0, policy.dailyMinutes * 60 - dailySeconds))
            dailySeconds += counted
            emergencyGrant?.usedSeconds += counted
            observeEmergency(now: now)
            if dailySeconds >= policy.dailyMinutes * 60 { phase = .dailyLocked }
            return
        }
        observePermit(now: now)
        if permitMode && permit?.active != true { return }
        let budgetRemaining = permitMode ? max(0, (permit?.budgetSeconds ?? 0) - (permit?.usedSeconds ?? 0)) : seconds
        let cycleRemaining = permitMode ? max(0, policy.periodMinutes * 60 - cycleSeconds) : seconds
        let counted = min(seconds, policy.dailyMinutes * 60 - dailySeconds, budgetRemaining, cycleRemaining)
        dailySeconds += counted; cycleSeconds += counted
        if dailySeconds >= policy.dailyMinutes * 60 { phase = .dailyLocked }
        else if cycleSeconds >= policy.periodMinutes * 60 { phase = .challengeRequired }
        observePermit(now: now, usedSeconds: counted)
    }
    mutating func startChallenge(now: Date = Date()) throws {
        guard !isQuiet(now: now) else { throw LearningError.invalidAction }
        guard phase == .challengeRequired, !permitMode else { throw LearningError.invalidAction }
        endEmergency(now: now)
        let eligible = bank.filter { policy.matches($0) }
        guard eligible.count >= policy.questionCount else { throw LearningError.invalidAction }
        questions = Array(eligible.shuffled().prefix(policy.questionCount))
        roundID = UUID(); answers = []; phase = .challengeActive
    }
    var availableTopics: [String] { Array(Set(bank.flatMap { [$0.topic] + $0.knowledgePoints })).sorted() }
    var questionIndex: Int {
        if let last = answers.last, !last.correct && !last.corrected { return answers.count - 1 }
        return answers.count
    }
    mutating func answer(questionID: String, choice: Int, now: Date = Date()) throws {
        guard !isQuiet(now: now) else { throw LearningError.invalidAction }
        guard phase == .challengeActive, questionIndex < questions.count else { throw LearningError.invalidAction }
        let question = questions[questionIndex]
        guard !question.type.isTextResponse, question.id == questionID, question.options.indices.contains(choice) else { throw LearningError.invalidAction }
        if questionIndex < answers.count {
            guard choice == question.correct else { throw LearningError.invalidAction }
            answers[questionIndex].corrected = true
        } else {
            answers.append(Answer(questionID: questionID, choice: choice, correct: choice == question.correct))
        }
        completeChallengeIfNeeded(now: now)
    }
    mutating func answerNumeric(questionID: String, input: String, now: Date = Date()) throws {
        guard !isQuiet(now: now), phase == .challengeActive, questionIndex < questions.count,
              let value = NumericAnswer.normalize(input) else { throw LearningError.invalidAction }
        let question = questions[questionIndex]
        guard question.id == questionID, question.type == .numeric else { throw LearningError.invalidAction }
        if questionIndex < answers.count {
            guard value == question.expectedNumeric else { throw LearningError.invalidAction }
            answers[questionIndex].corrected = true
        } else {
            answers.append(Answer(questionID: questionID, choice: 0, correct: value == question.expectedNumeric, numericValue: value))
        }
        completeChallengeIfNeeded(now: now)
    }
    private mutating func completeChallengeIfNeeded(now: Date) {
        if questionIndex == questions.count {
            let passed = answers.filter(\.correct).count >= policy.requiredCorrect
            records.append(LearningRecord(date: now, questions: questions, answers: answers, passed: passed))
            records = Array(records.suffix(100))
            phase = passed ? .restRequired : .challengeRequired
            restSeconds = 0
        }
    }
    mutating func recordRest(seconds: Int, now: Date = Date()) throws {
        guard !isQuiet(now: now) else { throw LearningError.invalidAction }
        guard phase == .restRequired, seconds >= 0, seconds <= 86400 else { throw LearningError.invalidAction }
        restSeconds = min(policy.restMinutes * 60, restSeconds + seconds)
    }
    mutating func finishRest(now: Date = Date()) throws {
        guard !isQuiet(now: now) else { throw LearningError.invalidAction }
        guard phase == .restRequired, restSeconds >= policy.restMinutes * 60 else { throw LearningError.invalidAction }
        phase = dailySeconds >= policy.dailyMinutes * 60 ? .dailyLocked : .available
        cycleSeconds = 0; restSeconds = 0; questions = []; answers = []
    }
    mutating func rollDay(to next: Date) throws {
        guard Calendar.current.startOfDay(for: next) > Calendar.current.startOfDay(for: dayStarted) else { throw LearningError.invalidAction }
        endPermit(now: next)
        endEmergency(now: next)
        dayStarted = next; dailySeconds = 0
        if phase == .dailyLocked, let suspended = dailySuspendedPhase { phase = suspended; dailySuspendedPhase = nil }
        else if phase == .dailyLocked { phase = cycleSeconds >= policy.periodMinutes * 60 ? .challengeRequired : .available }
    }
    func validate() throws {
        guard migrationConfirmationPending != false else { throw LearningError.invalidState }
        try policy.validate()
        try validateEmergency()
        try permit?.validate()
        guard permitAudit.count <= 100, Set(permitAudit.map(\.id)).count == permitAudit.count,
              permitAudit.allSatisfy({ ["issued", "parentClosed", "expired", "budgetExhausted", "clockRollback", "guardianBlocked", "quietHours"].contains($0.event) && (60...1800).contains($0.budgetSeconds) && $0.budgetSeconds % 60 == 0 && (0...$0.budgetSeconds).contains($0.usedSeconds) }),
              permit?.active != true || (phase == .available && permitMode),
              !permitMode || permit != nil else { throw LearningError.invalidState }
        guard version == 1, dailySeconds >= 0, dailySeconds <= policy.dailyMinutes * 60,
              cycleSeconds >= 0, cycleSeconds <= 86400, restSeconds >= 0,
              restSeconds <= policy.restMinutes * 60, questions.count <= 20,
              answers.count <= questions.count, records.count <= 100,
              Set(questions.map(\.id)).count == questions.count,
              (1...2000).contains(bank.count), Set(bank.map(\.id)).count == bank.count,
              Set(records.map(\.id)).count == records.count else { throw LearningError.invalidState }
        for question in bank + questions { try QuestionBank.validate(question) }
        for (index, answer) in answers.enumerated() {
            let q = questions[index]
            guard q.validates(answer),
                  index == answers.count - 1 || answer.correct || answer.corrected else { throw LearningError.invalidState }
        }
        if dailySeconds == policy.dailyMinutes * 60 && phase != .dailyLocked { throw LearningError.invalidState }
        if phase == .available && cycleSeconds >= policy.periodMinutes * 60 { throw LearningError.invalidState }
        for record in records {
            guard (1...20).contains(record.questions.count), record.answers.count == record.questions.count,
                  Set(record.questions.map(\.id)).count == record.questions.count else { throw LearningError.invalidState }
            for q in record.questions { try QuestionBank.validate(q) }
            for (index, answer) in record.answers.enumerated() {
                let q = record.questions[index]
                guard q.validates(answer),
                      answer.correct || answer.corrected else { throw LearningError.invalidState }
            }
        }
        if [.challengeRequired, .challengeActive, .restRequired].contains(phase) && cycleSeconds < policy.periodMinutes * 60 { throw LearningError.invalidState }
        if phase == .dailyLocked && dailySeconds != policy.dailyMinutes * 60 { throw LearningError.invalidState }
        if phase == .challengeActive && (questions.count != policy.questionCount || questionIndex >= questions.count) { throw LearningError.invalidState }
        if phase == .restRequired && (questionIndex != policy.questionCount || answers.filter(\.correct).count < policy.requiredCorrect) { throw LearningError.invalidState }
    }
}
struct StateFile {
    let url: URL
    func load() throws -> LearningState {
        guard FileManager.default.fileExists(atPath: url.path) else {
            let initial = LearningState(); try save(initial); return initial
        }
        let state = try JSONDecoder().decode(LearningState.self, from: Data(contentsOf: url))
        try state.validate(); return state
    }
    func save(_ state: LearningState) throws {
        try state.validate()
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder().encode(state).write(to: url, options: [.atomic, .completeFileProtection])
    }
}
