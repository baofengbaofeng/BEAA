import XCTest
@testable import BEAA
final class ReadingAndReportTests: XCTestCase {
    func testProductPolyphonesHaveToneReadings() {
        XCTAssertEqual(ChineseReading.pinyin("家长"), "jiā zhǎng")
        XCTAssertEqual(ChineseReading.pinyin("重置"), "chóng zhì")
        XCTAssertEqual(ChineseReading.pinyin("重新"), "chóng xīn")
        XCTAssertEqual(ChineseReading.pinyin("快乐"), "kuài lè")
    }
    func testExportOmitsQuestionsAndCredentials() throws {
        let data = ReportDocument(state: LearningState()).data
        let report = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertNil(report["questions"]); XCTAssertNil(report["answers"]); XCTAssertNil(report["pin"])
        XCTAssertEqual(Set(report.keys), ["version", "dailySeconds", "completedRounds", "passedRounds", "capability", "temporaryPermit", "permitAudit", "learning", "emergencyAudit"])
    }
}
