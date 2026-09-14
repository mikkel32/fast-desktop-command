import XCTest
@testable import ConnectionCore

final class ConnectionHealthTests: XCTestCase {
    func testHealthyPingDoesNotHideFailedCommandCheck() throws {
        let health = try fixture(commandHealthy: false)
        XCTAssertFalse(health.isReady)
        XCTAssertEqual(health.problem, "Command failed")
    }
    func testConnectedCountIncludesOnlyInitializedClients() throws {
        let health = try fixture(commandHealthy: true)
        XCTAssertTrue(health.isReady)
        XCTAssertEqual(health.connectedCount, 1)
        XCTAssertFalse(health.diagnostics().contains("token"))
    }
    func testLatencyHandlesMissingAndInvalidMeasurements() {
        XCTAssertEqual(ConnectionHealth.latency(nil), "Not checked")
        XCTAssertEqual(ConnectionHealth.latency(.nan), "Not checked")
        XCTAssertEqual(ConnectionHealth.latency(-1), "Not checked")
        XCTAssertEqual(ConnectionHealth.latency(0.25), "0.25 ms")
    }
    private func fixture(commandHealthy: Bool) throws -> ConnectionHealth {
        let source = """
        {"healthy":true,"pingMs":0.25,"version":"test","toolCount":26,"startedAt":"now","pid":1,
        "clients":[{"id":"a","pid":2,"ready":true,"connectedAt":"now"},{"id":"b","pid":3,"ready":false,"connectedAt":"now"}],
        "lastCheck":{"checkedAt":"now","healthy":\(commandHealthy),"error":\(commandHealthy ? "null" : "\"Command failed\"")},"events":[]}
        """
        return try JSONDecoder().decode(ConnectionHealth.self, from: Data(source.utf8))
    }
}
