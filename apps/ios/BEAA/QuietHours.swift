import Foundation

struct QuietWindow: Codable, Equatable {
    var days: [Int]
    var startMinute: Int
    var endMinute: Int
}
enum QuietHours {
    static func validate(_ windows: [QuietWindow]) throws {
        guard windows.count <= 14, windows.allSatisfy({ window in
            !window.days.isEmpty && Set(window.days).count == window.days.count &&
            window.days.allSatisfy { (1...7).contains($0) } &&
            (0...1439).contains(window.startMinute) && (0...1439).contains(window.endMinute) &&
            window.startMinute != window.endMinute
        }) else { throw LearningError.invalidPolicy }
    }
    static func blocks(_ windows: [QuietWindow], day: Int?, minute: Int?) -> Bool {
        guard !windows.isEmpty else { return false }
        guard (try? validate(windows)) != nil, let day, let minute,
              (1...7).contains(day), (0...1439).contains(minute) else { return true }
        return windows.contains { window in
            if window.startMinute < window.endMinute {
                return window.days.contains(day) && minute >= window.startMinute && minute < window.endMinute
            }
            return (window.days.contains(day) && minute >= window.startMinute) ||
                (window.days.contains(day == 1 ? 7 : day - 1) && minute < window.endMinute)
        }
    }
    static func blocks(_ windows: [QuietWindow], at date: Date = Date(), calendar: Calendar = .current) -> Bool {
        guard date.timeIntervalSinceReferenceDate.isFinite else { return !windows.isEmpty }
        let components = calendar.dateComponents([.weekday, .hour, .minute], from: date)
        guard let weekday = components.weekday, let hour = components.hour, let minute = components.minute else {
            return blocks(windows, day: nil, minute: nil)
        }
        return blocks(windows, day: (weekday + 5) % 7 + 1, minute: hour * 60 + minute)
    }
    static func crossedQuiet(_ windows: [QuietWindow], from start: Date, to end: Date) -> Bool {
        guard !windows.isEmpty else { return false }
        let interval = end.timeIntervalSince(start)
        guard interval.isFinite else { return true }
        guard interval >= 0 else { return false }
        if interval >= 8 * 86400 { return true }
        var cursor = start
        while cursor < end {
            if blocks(windows, at: cursor) { return true }
            cursor = cursor.addingTimeInterval(60)
        }
        return blocks(windows, at: end)
    }
    // Only credit intervals wholly inside a single local minute, with matching wall/monotonic duration.
    // Discard boundary intervals even when both endpoints happen to be outside a short quiet window.
    static func canCredit(_ windows: [QuietWindow], from start: Date?, to end: Date, elapsed: Int, calendar: Calendar = .current) -> Bool {
        guard !windows.isEmpty else { return true }
        guard let start, end >= start, abs(end.timeIntervalSince(start) - Double(elapsed)) < 1.1,
              calendar.dateInterval(of: .minute, for: start)?.contains(end) == true else { return false }
        return !blocks(windows, at: start, calendar: calendar) && !blocks(windows, at: end, calendar: calendar)
    }
}
extension Policy {
    enum CodingKeys: String, CodingKey {
        case periodMinutes, dailyMinutes, restMinutes, questionCount, requiredCorrect, grade, topics, subjects, quietWindows
    }
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        periodMinutes = try values.decode(Int.self, forKey: .periodMinutes)
        dailyMinutes = try values.decode(Int.self, forKey: .dailyMinutes)
        restMinutes = try values.decode(Int.self, forKey: .restMinutes)
        questionCount = try values.decode(Int.self, forKey: .questionCount)
        requiredCorrect = try values.decode(Int.self, forKey: .requiredCorrect)
        grade = try values.decode(Int.self, forKey: .grade)
        topics = try values.decode([String].self, forKey: .topics)
        subjects = try values.decode([String].self, forKey: .subjects)
        quietWindows = values.contains(.quietWindows) ? try values.decode([QuietWindow].self, forKey: .quietWindows) : []
        try validate()
    }
}
extension LearningState {
    mutating func setQuietWindows(_ windows: [QuietWindow], now: Date = Date()) throws {
        try QuietHours.validate(windows)
        enforceQuiet(now: now)
        observePermit(now: now)
        policy.quietWindows = windows
        enforceQuiet(now: now)
    }
    func isQuiet(now: Date = Date()) -> Bool { QuietHours.blocks(policy.quietWindows, at: now) }
    mutating func enforceQuiet(now: Date = Date()) {
        guard let current = permit, current.active,
              isQuiet(now: now) || QuietHours.crossedQuiet(policy.quietWindows, from: current.lastObservedAt, to: now) else { return }
        permit?.closedReason = .quietHours
        if let permit {
            permitAudit.append(PermitAudit(date: now, event: "quietHours", budgetSeconds: permit.budgetSeconds, usedSeconds: permit.usedSeconds))
            permitAudit = Array(permitAudit.suffix(100))
        }
    }
}
