import Foundation

enum QuestionType: String, Codable { case singleChoice = "single_choice", trueFalse = "true_false", numeric, fraction, numericTolerance = "numeric_tolerance"
    var isTextResponse: Bool { [.numeric, .fraction, .numericTolerance].contains(self) }
}
enum NumericAnswer {
    static func normalize(_ input: String) -> String? {
        guard input.utf16.count <= 48 else { return nil }
        let trimmed = input.trimmingCharacters(in: CharacterSet(charactersIn: "\u{0009}\u{000A}\u{000B}\u{000C}\u{000D}\u{0020}\u{00A0}\u{1680}\u{2000}\u{2001}\u{2002}\u{2003}\u{2004}\u{2005}\u{2006}\u{2007}\u{2008}\u{2009}\u{200A}\u{2028}\u{2029}\u{202F}\u{205F}\u{3000}\u{FEFF}"))
        let translated = String(String.UnicodeScalarView(trimmed.unicodeScalars.map { scalar in
            switch scalar.value {
            case 0xFF10...0xFF19: return UnicodeScalar(scalar.value - 0xFF10 + 48)!
            case 0xFF0B: return UnicodeScalar(43)!
            case 0xFF0D, 0x2212: return UnicodeScalar(45)!
            case 0xFF0E: return UnicodeScalar(46)!
            default: return scalar
            }
        }))
        var body = translated
        let negative = body.first == "-"
        if body.first == "+" || negative { body.removeFirst() }
        let parts = body.split(separator: ".", omittingEmptySubsequences: false)
        guard (1...2).contains(parts.count) else { return nil }
        let integer = String(parts[0]), fraction = parts.count == 2 ? String(parts[1]) : ""
        guard !integer.isEmpty || !fraction.isEmpty, integer.count <= 12, fraction.count <= 6,
              (integer + fraction).utf8.allSatisfy({ (48...57).contains($0) }) else { return nil }
        let whole = String(integer.drop(while: { $0 == "0" }))
        let decimal = String(fraction.reversed().drop(while: { $0 == "0" }).reversed())
        let value = (whole.isEmpty ? "0" : whole) + (decimal.isEmpty ? "" : "." + decimal)
        return negative && value != "0" ? "-" + value : value
    }
}

extension Question {
    enum CodingKeys: String, CodingKey { case id, subject, prompt, options, correct, explanation, grade, topic, knowledgePoints, type, expectedNumeric, absoluteTolerance }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        subject = try c.decode(String.self, forKey: .subject)
        prompt = try c.decode(String.self, forKey: .prompt)
        options = try c.decode([String].self, forKey: .options)
        correct = try c.decode(Int.self, forKey: .correct)
        explanation = try c.decode(String.self, forKey: .explanation)
        grade = try c.decodeIfPresent(Int.self, forKey: .grade) ?? 3
        topic = try c.decodeIfPresent(String.self, forKey: .topic) ?? "general"
        knowledgePoints = try c.decodeIfPresent([String].self, forKey: .knowledgePoints) ?? []
        type = try c.decodeIfPresent(QuestionType.self, forKey: .type) ?? .singleChoice
        expectedNumeric = try c.decodeIfPresent(String.self, forKey: .expectedNumeric)
        absoluteTolerance = try c.decodeIfPresent(String.self, forKey: .absoluteTolerance)
    }
    func validates(_ answer: Answer) -> Bool {
        guard answer.questionID == id, !answer.correct || !answer.corrected else { return false }
        if type.isTextResponse {
            guard answer.choice == 0, let value = answer.numericValue,
                  TextAnswer.normalize(value, type: type) == value else { return false }
            return answer.correct == TextAnswer.matches(value, question: self)
        }
        return answer.numericValue == nil && options.indices.contains(answer.choice) && answer.correct == (answer.choice == correct)
    }
}
