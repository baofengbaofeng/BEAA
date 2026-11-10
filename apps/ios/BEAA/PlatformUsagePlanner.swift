import Foundation

enum PlatformUsagePlanner {
    /// System notifications render plain text rather than the app's pronunciation view.
    static func notificationText(_ chinese: String) -> String {
        let reading = chinese.applyingTransform(.mandarinToLatin, reverse: false) ?? chinese
        return chinese + "\n" + reading
    }

    static func thresholds(limitMinutes: Int) -> [Int] {
        Array(Set([max(1, limitMinutes - 5), max(1, limitMinutes - 1), limitMinutes])).sorted()
    }
    struct Event { let name: String; let seconds: Int; let blocks: Bool }
    static func events(periodMinutes: Int, dailyMinutes: Int, baselineSeconds: Int,
                       currentCycleSeconds: Int = 0) -> [Event] {
        guard periodMinutes > 0, dailyMinutes > 0, baselineSeconds >= 0, currentCycleSeconds >= 0 else { return [] }
        var result: [Event] = []
        let period = periodMinutes * 60, cap = dailyMinutes * 60
        let firstCycleEnd = baselineSeconds + max(0, period - currentCycleSeconds)
        for cycleEnd in stride(from: firstCycleEnd, through: cap, by: period) {
            for offset in [300, 60, 0] {
                let seconds = cycleEnd - offset - baselineSeconds
                guard seconds > 0 else { continue }
                result.append(Event(name: "cycle.\(cycleEnd).\(seconds)", seconds: seconds, blocks: offset == 0))
            }
        }
        for offset in [300, 60, 0] {
            let seconds = cap - offset - baselineSeconds
            guard seconds > 0 else { continue }
            result.append(Event(name: "daily.\(cap).\(seconds)", seconds: seconds, blocks: offset == 0))
        }
        return result
    }
    static func day(_ date: Date = Date()) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }
}

/// Thresholds are cumulative lower bounds for the selected scope, never exact total device time.
struct PlatformUsageReceipt: Codable, Identifiable {
    let generation: String
    let day: String
    let event: String
    let lowerBoundSeconds: Int
    let receivedAt: Date
    var dayKey: String { day }
    var absoluteSeconds: Int { lowerBoundSeconds }
    var eventID: String { id }
    var id: String { generation + ":" + day + ":" + event }
}

/// Weekdays use the app's ISO convention: Monday=1 ... Sunday=7.
struct PlatformQuietWindow: Codable {
    let days: [Int]
    let startMinute: Int
    let endMinute: Int
}
extension PlatformUsagePlanner {
    struct QuietSchedule {
        let start: DateComponents
        let end: DateComponents
    }
    static func quietSchedules(_ windows: [PlatformQuietWindow]) throws -> [QuietSchedule] {
        var schedules: [QuietSchedule] = []
        for window in windows {
            guard (0...1439).contains(window.startMinute), (0...1439).contains(window.endMinute),
                  !window.days.isEmpty, Set(window.days).count == window.days.count,
                  window.days.allSatisfy({ (1...7).contains($0) }) else { throw PlatformServiceError.configuration }
            let duration = (window.endMinute - window.startMinute + 1440) % 1440
            guard duration >= 15 else { throw PlatformServiceError.quietUnsupported }
            for day in window.days {
                let nextDay = window.endMinute < window.startMinute ? day % 7 + 1 : day
                // Foundation weekday is Sunday=1, unlike the app's ISO weekday.
                schedules.append(QuietSchedule(
                    start: DateComponents(hour: window.startMinute / 60, minute: window.startMinute % 60, weekday: day % 7 + 1),
                    end: DateComponents(hour: window.endMinute / 60, minute: window.endMinute % 60, weekday: nextDay % 7 + 1)))
            }
        }
        guard schedules.count <= 19 else { throw PlatformServiceError.quietUnsupported }
        return schedules
    }
    static func quietBlocks(_ windows: [PlatformQuietWindow], isoDay: Int, minute: Int) -> Bool {
        windows.contains { window in
            if window.startMinute < window.endMinute {
                return window.days.contains(isoDay) && minute >= window.startMinute && minute < window.endMinute
            }
            let previousDay = isoDay == 1 ? 7 : isoDay - 1
            return (window.days.contains(isoDay) && minute >= window.startMinute) ||
                (window.days.contains(previousDay) && minute < window.endMinute)
        }
    }
    static func quietBlocks(_ windows: [PlatformQuietWindow], at date: Date = Date()) -> Bool {
        let components = Calendar.current.dateComponents([.weekday, .hour, .minute], from: date)
        guard let weekday = components.weekday, let hour = components.hour, let minute = components.minute else { return !windows.isEmpty }
        return quietBlocks(windows, isoDay: (weekday + 5) % 7 + 1, minute: hour * 60 + minute)
    }
}

extension PlatformUsagePlanner {
    static func allowanceDeadline(_ expiry: Date) -> (start: Date, end: Date) {
        (expiry.addingTimeInterval(-900), expiry)
    }
}

extension PlatformUsagePlanner {
    static func hasPendingBlock(_ receipts: [PlatformUsageReceipt], generation: String,
                                blockingEvents: Set<String>) -> Bool {
        receipts.contains {
            $0.generation == generation && (blockingEvents.contains($0.event) ||
                $0.event == "interval.end" || $0.event.hasPrefix("allowance.end."))
        }
    }
}
