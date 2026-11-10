import XCTest
@testable import BEAA
final class PlatformUsageTests: XCTestCase {
    func testThresholdsDeduplicateFiveMinutePeriod() {
        XCTAssertEqual(PlatformUsagePlanner.thresholds(limitMinutes: 5), [1, 4, 5])
        XCTAssertEqual(PlatformUsagePlanner.thresholds(limitMinutes: 30), [25, 29, 30])
    }
    func testReceiptIdentityIncludesGenerationDayAndEvent() {
        let a = PlatformUsageReceipt(generation: "a", day: "2026-11-09", event: "cycle.30", lowerBoundSeconds: 1800, receivedAt: Date())
        let b = PlatformUsageReceipt(generation: "b", day: "2026-11-09", event: "cycle.30", lowerBoundSeconds: 1800, receivedAt: Date())
        XCTAssertNotEqual(a.id, b.id)
    }
}

extension PlatformUsageTests {
    func testContinuousCycleEventsPreserveCumulativeDailyAccounting() {
        let events = PlatformUsagePlanner.events(periodMinutes: 30, dailyMinutes: 120, baselineSeconds: 600)
        XCTAssertEqual(events.first(where: { $0.name == "cycle.4200.3600" })?.blocks, true)
        XCTAssertEqual(events.first(where: { $0.name == "daily.7200.6600" })?.blocks, true)
        XCTAssertFalse(events.contains(where: { $0.seconds <= 0 }))
    }
    func testAllCyclesWarnBeforeTheirLimit() {
        let events = PlatformUsagePlanner.events(periodMinutes: 30, dailyMinutes: 120, baselineSeconds: 0)
        XCTAssertEqual(events.filter { $0.name.hasPrefix("cycle.3600.") }.map(\.seconds), [3300, 3540, 3600])
    }
}

extension PlatformUsageTests {
    func testEmergencyTimeDoesNotShortenNextFullCycle() {
        let events = PlatformUsagePlanner.events(periodMinutes: 30, dailyMinutes: 120,
            baselineSeconds: 35 * 60, currentCycleSeconds: 0)
        XCTAssertEqual(events.first(where: { $0.blocks })?.seconds, 30 * 60)
        XCTAssertTrue(events.contains(where: { $0.name == "cycle.3900.1800" }))
    }
}

extension PlatformUsageTests {
    func testNotificationIncludesChineseAndPronunciation() {
        let text = PlatformUsagePlanner.notificationText("用时提醒")
        XCTAssertTrue(text.hasPrefix("用时提醒\n"))
        XCTAssertEqual(text.split(separator: "\n").count, 2)
    }
}

extension PlatformUsageTests {
    func testSundayOvernightQuietScheduleEndsMonday() throws {
        let windows = [PlatformQuietWindow(days: [7], startMinute: 1380, endMinute: 60)]
        let span = try XCTUnwrap(PlatformUsagePlanner.quietSchedules(windows).first)
        XCTAssertEqual(span.start.weekday, 1)
        XCTAssertEqual(span.end.weekday, 2)
        XCTAssertTrue(PlatformUsagePlanner.quietBlocks(windows, isoDay: 1, minute: 30))
        XCTAssertFalse(PlatformUsagePlanner.quietBlocks(windows, isoDay: 1, minute: 60))
    }
    func testUnsupportedShortQuietWindowIsRejected() {
        XCTAssertThrowsError(try PlatformUsagePlanner.quietSchedules([
            PlatformQuietWindow(days: [1], startMinute: 10, endMinute: 20)
        ]))
    }
}

extension PlatformUsageTests {
    func testAllowanceDeadlineUsesFifteenMinuteSystemInterval() {
        let expiry = Date(timeIntervalSince1970: 1_800_000_000)
        let interval = PlatformUsagePlanner.allowanceDeadline(expiry)
        XCTAssertEqual(interval.end, expiry)
        XCTAssertEqual(interval.end.timeIntervalSince(interval.start), 900)
    }
}

extension PlatformUsageTests {
    func testPendingDeadlineReceiptPreservesShieldUntilAcknowledged() {
        let receipt = PlatformUsageReceipt(generation: "active", day: "2026-11-09",
            event: "allowance.end.1800000000", lowerBoundSeconds: 0, receivedAt: Date())
        XCTAssertTrue(PlatformUsagePlanner.hasPendingBlock([receipt], generation: "active", blockingEvents: []))
        XCTAssertFalse(PlatformUsagePlanner.hasPendingBlock([], generation: "active", blockingEvents: []))
        XCTAssertFalse(PlatformUsagePlanner.hasPendingBlock([receipt], generation: "replacement", blockingEvents: []))
    }
}
