import XCTest
@testable import BEAA

final class QuietHoursTests: XCTestCase {
    func testHalfOpenAndOvernight() throws {
        let windows = [QuietWindow(days: [7], startMinute: 1380, endMinute: 60)]
        try QuietHours.validate(windows)
        XCTAssertTrue(QuietHours.blocks(windows, day: 7, minute: 1380))
        XCTAssertTrue(QuietHours.blocks(windows, day: 1, minute: 59))
        XCTAssertFalse(QuietHours.blocks(windows, day: 1, minute: 60))
        XCTAssertFalse(QuietHours.blocks(windows, day: 7, minute: 1379))
        XCTAssertTrue(QuietHours.blocks(windows, day: nil, minute: nil))
        XCTAssertFalse(QuietHours.blocks([], day: nil, minute: nil))
    }
    func testValidationAndLegacyPolicy() throws {
        XCTAssertThrowsError(try QuietHours.validate([QuietWindow(days: [1, 1], startMinute: 2, endMinute: 3)]))
        XCTAssertThrowsError(try QuietHours.validate([QuietWindow(days: [], startMinute: 2, endMinute: 3)]))
        XCTAssertThrowsError(try QuietHours.validate([QuietWindow(days: [1], startMinute: 2, endMinute: 2)]))
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(Policy())) as? [String: Any])
        object.removeValue(forKey: "quietWindows")
        XCTAssertEqual(try JSONDecoder().decode(Policy.self, from: JSONSerialization.data(withJSONObject: object)).quietWindows.count, 0)
        object["quietWindows"] = NSNull()
        XCTAssertThrowsError(try JSONDecoder().decode(Policy.self, from: JSONSerialization.data(withJSONObject: object)))
    }
    func testUnionLimitsAndLocalWeekday() throws {
        let window = QuietWindow(days: [1], startMinute: 60, endMinute: 120)
        XCTAssertThrowsError(try QuietHours.validate(Array(repeating: window, count: 15)))
        XCTAssertThrowsError(try QuietHours.validate([QuietWindow(days: [0], startMinute: 0, endMinute: 1)]))
        XCTAssertThrowsError(try QuietHours.validate([QuietWindow(days: [7], startMinute: 0, endMinute: 1440)]))
        let union = [window, QuietWindow(days: [1], startMinute: 90, endMinute: 180)]
        XCTAssertTrue(QuietHours.blocks(union, day: 1, minute: 179))
        XCTAssertFalse(QuietHours.blocks(union, day: 1, minute: 180))
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let monday = calendar.date(from: DateComponents(year: 2026, month: 11, day: 9, hour: 1, minute: 0))!
        XCTAssertTrue(QuietHours.blocks([window], at: monday, calendar: calendar))
        XCTAssertFalse(QuietHours.canCredit([window], from: monday.addingTimeInterval(-1), to: monday, elapsed: 1, calendar: calendar))
        XCTAssertFalse(QuietHours.canCredit([window], from: monday.addingTimeInterval(-3600), to: monday.addingTimeInterval(3600), elapsed: 7200, calendar: calendar))
        XCTAssertFalse(QuietHours.canCredit([window], from: monday.addingTimeInterval(3602), to: monday.addingTimeInterval(3601), elapsed: 1, calendar: calendar))
    }
    func testQuietActionGuardsAndRestPreservation() throws {
        let now = Calendar.current.date(bySettingHour: 12, minute: 0, second: 0, of: Date())!
        var state = LearningState()
        state.policy.quietWindows = [QuietWindow(days: Array(1...7), startMinute: 0, endMinute: 1439)]
        XCTAssertThrowsError(try state.recordUsage(seconds: 1, now: now))
        XCTAssertThrowsError(try state.issuePermit(minutes: 1, now: now))
        state.phase = .challengeRequired
        XCTAssertThrowsError(try state.startChallenge(now: now))
        state.phase = .challengeActive
        XCTAssertThrowsError(try state.answer(questionID: "unused", choice: 0, now: now))
        state.phase = .restRequired
        state.restSeconds = 20
        XCTAssertThrowsError(try state.recordRest(seconds: 1, now: now))
        XCTAssertThrowsError(try state.finishRest(now: now))
        XCTAssertEqual(state.restSeconds, 20)
        XCTAssertEqual(state.phase, .restRequired)
    }
    func testQuietPreservesStateAndClosesPermit() throws {
        var state = LearningState()
        let now = Calendar.current.date(bySettingHour: 12, minute: 0, second: 0, of: Date())!
        try state.issuePermit(minutes: 1, now: now)
        state.policy.quietWindows = [QuietWindow(days: Array(1...7), startMinute: 0, endMinute: 1439)]
        state.enforceQuiet(now: now)
        XCTAssertTrue(state.permitMode)
        XCTAssertEqual(state.permit?.closedReason, .quietHours)
        XCTAssertEqual(state.permitAudit.last?.event, "quietHours")
        XCTAssertEqual(state.phase, .available)
        XCTAssertEqual(state.dailySeconds, 0)
    }
    func testNewScheduleDoesNotRetroactivelyClosePermit() throws {
        var state = LearningState()
        let now = Calendar.current.date(bySettingHour: 12, minute: 2, second: 0, of: Date())!
        try state.issuePermit(minutes: 5, now: now.addingTimeInterval(-120))
        try state.setQuietWindows([QuietWindow(days: Array(1...7), startMinute: 720, endMinute: 721)], now: now)
        XCTAssertNil(state.permit?.closedReason)
        XCTAssertTrue(state.permitMode)
    }

}
