import SwiftUI
import AppKit
import NativeControlCore

@main enum FastDesktopCommandLauncher {
    @MainActor static func main() async {
        if CommandLine.arguments.contains("--native") {
            await NativeControlRunner.run()
        } else {
            FastDesktopCommandApp.main()
        }
    }
}

@MainActor final class AppDelegate: NSObject, NSApplicationDelegate {
    var connection: ConnectionModel?
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationWillTerminate(_ notification: Notification) { connection?.stop() }
}

struct FastDesktopCommandApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @State private var connection = ConnectionModel()

    var body: some Scene {
        Window("Fast Desktop Command", id: "connection") {
            ConnectionView(model: connection)
                .task {
                    delegate.connection = connection
                    connection.startOnLaunch()
                }
        }
        .windowStyle(.hiddenTitleBar)
        .windowResizability(.contentSize)
        .defaultPosition(.center)
        .commands {
            CommandGroup(replacing: .newItem) { }
        }
        MenuBarExtra {
            ConnectionMenu(model: connection)
        } label: {
            Image(systemName: connection.phase == .ready ? "bolt.fill" : "bolt.slash")
                .accessibilityLabel("Fast Desktop Command: \(connection.title)")
        }
    }
}

private struct ConnectionMenu: View {
    let model: ConnectionModel
    @Environment(\.openWindow) private var openWindow
    var body: some View {
        Text(model.title)
        Button("Open Fast Desktop Command") {
            openWindow(id: "connection")
            NSApp.activate()
        }
        Divider()
        Button(model.isRunning ? "Stop connection" : "Start connection") {
            if model.isRunning { model.stop() } else { model.start() }
        }.disabled(model.phase == .stopping)
        Button("Check health") { Task { await model.refresh(full: true) } }
            .disabled(!model.isRunning || model.isChecking)
        Divider()
        Button("Quit") { NSApp.terminate(nil) }.keyboardShortcut("q")
    }
}
