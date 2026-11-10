import XCTest
@testable import BEAA
final class ParentVaultTests: XCTestCase {
    func testPINRequiresSixDigits() {
        XCTAssertFalse(ParentVault.validPIN("123"))
        XCTAssertFalse(ParentVault.validPIN("abcdef"))
        XCTAssertTrue(ParentVault.validPIN("802163"))
    }
    func testSaltChangesDerivedHash() throws {
        let first = try ParentVault.derive("802163", salt: Data(repeating: 1, count: 16))
        let second = try ParentVault.derive("802163", salt: Data(repeating: 2, count: 16))
        XCTAssertNotEqual(first, second)
        XCTAssertEqual(first, try ParentVault.derive("802163", salt: Data(repeating: 1, count: 16)))
    }
}
