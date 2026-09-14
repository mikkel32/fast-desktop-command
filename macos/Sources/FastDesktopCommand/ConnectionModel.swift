import AppKit
import Foundation
import Observation
import ConnectionCore

private struct RuntimeConfiguration: Decodable {
    let node: String
    let project: String
}

private struct ServiceEndpoint: Decodable {
    let pid: Int32
    let port: Int
    let token: String
}

@Observable @MainActor
final class ConnectionModel {
    enum Phase: Equatable { case stopped, starting, stopping, ready, attention }
    private(set) var phase: Phase = .stopped
    private(set) var health: ConnectionHealth?
    private(set) var isChecking = false
    private(set) var message: String?
    private(set) var lastUpdated: Date?
    private(set) var isRunning = false
    private(set) var copied = false
    @ObservationIgnored private var process: Process?
    @ObservationIgnored private var inputPipe: Pipe?
    @ObservationIgnored private var outputPipe: Pipe?
    @ObservationIgnored private var errorPipe: Pipe?
    @ObservationIgnored private var heartbeat: Task<Void, Never>?
    @ObservationIgnored private var endpoint: ServiceEndpoint?
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var startedOnce = false
    @ObservationIgnored private var recentError = ""

    var title: String {
        switch phase {
        case .stopped: "Connection stopped"
        case .starting: "Getting ready"
        case .stopping: "Stopping connection"
        case .attention: "Needs attention"
        case .ready: health?.connectedCount ?? 0 > 0 ? "Connected" : "Ready when you are"
        }
    }

    var subtitle: String {
        if let message { return message }
        switch phase {
        case .stopped: return "Start the connection to use your local tools."
        case .starting: return "Starting the engine and checking your tools."
        case .stopping: return "Finishing up and disconnecting local sessions."
        case .attention: return health?.problem ?? "Check the connection, or stop and start it again."
        case .ready: return "Commands and images. Right here on your Mac."
        }
    }

    private var runtimeDirectory: URL {
        if let override = ProcessInfo.processInfo.environment["FAF_APP_RUNTIME_DIR"] {
            return URL(fileURLWithPath: override)
        }
        return FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".fast-as-fuck-desktop-command/app", isDirectory: true)
    }

    private func configuration() throws -> RuntimeConfiguration {
        guard let url = Bundle.main.url(forResource: "Runtime", withExtension: "json") else {
            throw CocoaError(.fileNoSuchFile, userInfo: [NSLocalizedDescriptionKey: "The app is missing its engine configuration. Rebuild the app from the project."])
        }
        return try JSONDecoder().decode(RuntimeConfiguration.self, from: Data(contentsOf: url))
    }

    func startOnLaunch() {
        guard !startedOnce else { return }
        startedOnce = true
        start()
    }

    func start() {
        guard !isRunning && phase != .starting && phase != .stopping else { return }
        generation += 1
        let thisGeneration = generation
        message = nil
        health = nil
        recentError = ""
        phase = .starting
        do {
            try? FileManager.default.removeItem(at: runtimeDirectory.appendingPathComponent("paused"))
            let config = try configuration()
            guard FileManager.default.isExecutableFile(atPath: config.node),
                  FileManager.default.fileExists(atPath: config.project + "/dist/local.js") else {
                throw CocoaError(.fileNoSuchFile, userInfo: [NSLocalizedDescriptionKey: "The engine is missing. Open the project and build it again."])
            }
            let child = Process()
            child.executableURL = URL(fileURLWithPath: config.node)
            child.arguments = [config.project + "/scripts/app-service.mjs"]
            child.currentDirectoryURL = URL(fileURLWithPath: config.project)
            var environment = ProcessInfo.processInfo.environment
            environment["FAF_APP_RUNTIME_DIR"] = runtimeDirectory.path
            environment["DESKTOP_COMMANDER_DISABLE_TELEMETRY"] = "true"
            // GUI apps have a smaller PATH; keep the user's tools available.
            environment["PATH"] = [FileManager.default.homeDirectoryForCurrentUser.path + "/.local/bin", "/opt/homebrew/bin", "/usr/local/bin", environment["PATH"] ?? "/usr/bin:/bin:/usr/sbin:/sbin"].joined(separator: ":")
            child.environment = environment
            let input = Pipe(), output = Pipe(), errors = Pipe()
            child.standardInput = input
            child.standardOutput = output
            child.standardError = errors
            inputPipe = input
            outputPipe = output
            errorPipe = errors
            output.fileHandleForReading.readabilityHandler = { handle in
                _ = handle.availableData
            }
            errors.fileHandleForReading.readabilityHandler = { [weak self] handle in
                let data = handle.availableData
                guard !data.isEmpty else { return }
                let text = String(decoding: data, as: UTF8.self)
                Task { @MainActor [weak self] in self?.recentError = String(text.suffix(1500)) }
            }
            child.terminationHandler = { [weak self] _ in
                Task { @MainActor [weak self] in
                    guard let self, self.generation == thisGeneration else { return }
                    self.isRunning = false
                    self.phase = .attention
                    self.message = "The connection stopped unexpectedly. Start it again."
                    self.heartbeat?.cancel()
                    self.clearPipes()
                    self.process = nil
                    self.endpoint = nil
                    self.health = nil
                }
            }
            try child.run()
            process = child
            isRunning = true
            heartbeat = Task { [weak self] in
                guard let self else { return }
                do {
                    let deadline = Date().addingTimeInterval(15)
                    while child.isRunning && !Task.isCancelled {
                        if let data = try? Data(contentsOf: self.runtimeDirectory.appendingPathComponent("service.json")),
                           let state = try? JSONDecoder().decode(ServiceEndpoint.self, from: data),
                           state.pid == child.processIdentifier {
                            self.endpoint = state
                            break
                        }
                        if Date() >= deadline {
                            self.phase = .attention
                            self.message = "Starting is taking longer than expected. Still checking."
                        }
                        try await Task.sleep(for: .milliseconds(100))
                    }
                    guard !Task.isCancelled, self.generation == thisGeneration else { return }
                    guard self.endpoint != nil else { return }
                    await self.refresh()
                    while !Task.isCancelled {
                        try await Task.sleep(for: .seconds(3))
                        await self.refresh()
                    }
                } catch is CancellationError { }
                catch { self.phase = .attention; self.message = error.localizedDescription }
            }
        } catch {
            clearPipes()
            process = nil
            isRunning = false
            phase = .attention
            message = error.localizedDescription
        }
    }

    func stop() {
        guard phase != .stopping else { return }
        generation += 1
        let thisGeneration = generation
        // An explicit Stop must not be undone by a plugin's auto-open attempt.
        try? Data("stopped by user\n".utf8).write(to: runtimeDirectory.appendingPathComponent("paused"), options: .atomic)
        heartbeat?.cancel()
        heartbeat = nil
        endpoint = nil
        health = nil
        message = nil
        lastUpdated = nil
        isChecking = false
        guard let child = process, child.isRunning else {
            phase = .stopped
            isRunning = false
            process = nil
            clearPipes()
            return
        }
        phase = .stopping
        child.terminationHandler = { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, self.generation == thisGeneration else { return }
                self.isRunning = false
                self.phase = .stopped
                self.process = nil
                self.clearPipes()
            }
        }
        try? inputPipe?.fileHandleForWriting.close()
        child.terminate()
    }

    private func clearPipes() {
        outputPipe?.fileHandleForReading.readabilityHandler = nil
        errorPipe?.fileHandleForReading.readabilityHandler = nil
        inputPipe = nil
        outputPipe = nil
        errorPipe = nil
    }

    func refresh(full: Bool = false) async {
        guard let endpoint, !isChecking else { return }
        let thisGeneration = generation
        if full { isChecking = true }
        defer { if generation == thisGeneration { isChecking = false } }
        do {
            let url = URL(string: "http://127.0.0.1:\(endpoint.port)/\(full ? "check" : "health")")!
            var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: full ? 10 : 4)
            request.httpMethod = full ? "POST" : "GET"
            request.setValue("Bearer \(endpoint.token)", forHTTPHeaderField: "Authorization")
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let response = response as? HTTPURLResponse, response.statusCode == 200 else { throw URLError(.badServerResponse) }
            let value = try JSONDecoder().decode(ConnectionHealth.self, from: data)
            guard generation == thisGeneration else { return }
            health = value
            lastUpdated = Date()
            message = nil
            phase = value.isReady ? .ready : .attention
        } catch {
            guard generation == thisGeneration, !Task.isCancelled else { return }
            phase = .attention
            message = "The engine is not responding. Try checking again."
        }
    }

    func copyDiagnostics() {
        let value = health?.diagnostics() ?? "Fast Desktop Command\n\(title)\n\(subtitle)\n\(recentError)"
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(value, forType: .string)
        copied = true
        Task { try? await Task.sleep(for: .seconds(2)); copied = false }
    }

    func openProject() {
        if let config = try? configuration() { NSWorkspace.shared.open(URL(fileURLWithPath: config.project)) }
    }
}
