import Foundation

public struct ConnectionHealth: Decodable, Equatable, Sendable {
    public let healthy: Bool
    public let pingMs: Double?
    public let error: String?
    public let version: String
    public let toolCount: Int
    public let startedAt: String
    public let pid: Int
    public let clients: [ConnectedClient]
    public let lastCheck: HealthCheck?
    public let events: [ConnectionEvent]
    public let web: WebConnectionStatus?
    public let nativeEnabled: Bool?

    public var isReady: Bool { healthy && lastCheck?.healthy != false }
    public var connectedCount: Int { clients.filter(\.ready).count }
    public var problem: String? { error ?? lastCheck?.error }

    public func diagnostics() -> String {
        """
        Fast Desktop Command
        Status: \(isReady ? "Ready" : "Needs attention")
        Engine: \(version)
        Tools: \(toolCount)
        Connected apps: \(connectedCount)
        Ping: \(Self.latency(pingMs))
        Commands: \(Self.latency(lastCheck?.commandMs))
        Images: \(Self.latency(lastCheck?.imageMs))
        Last full check: \(lastCheck?.checkedAt ?? "Not checked")
        Problem: \(problem ?? "None")
        """
    }

    public static func latency(_ value: Double?) -> String {
        guard let value, value.isFinite, value >= 0 else { return "Not checked" }
        return value < 1 ? String(format: "%.2f ms", value) : String(format: "%.1f ms", value)
    }
}

public struct WebConnectionStatus: Decodable, Equatable, Sendable {
    public let state: String
    public let message: String?
    public let siteURL: String?
    public let code: String?
    public let verificationURL: String?
}

public struct ConnectedClient: Decodable, Equatable, Sendable, Identifiable {
    public let id: String
    public let pid: Int?
    public let ready: Bool
    public let connectedAt: String
}

public struct HealthCheck: Decodable, Equatable, Sendable {
    public let checkedAt: String
    public let healthy: Bool
    public let pingMs: Double?
    public let commandMs: Double?
    public let imageMs: Double?
    public let error: String?
}

public struct ConnectionEvent: Decodable, Equatable, Sendable, Identifiable {
    public let id: String
    public let time: String
    public let message: String
}
