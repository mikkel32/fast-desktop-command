import AppKit
import ApplicationServices
import ScreenCaptureKit

struct NativeFailure: Error { let message: String }

@main struct NativeControl {
    @MainActor static func main() async {
        do {
            // ScreenCaptureKit needs an AppKit connection to WindowServer even
            // when this helper is launched as a command-line executable.
            _ = NSApplication.shared
            let data = FileHandle.standardInput.readDataToEndOfFile()
            guard data.count <= 100_000,
                  let request = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let operation = request["operation"] as? String else { throw NativeFailure(message: "Invalid native request.") }
            let result = try await execute(operation, request["arguments"] as? [String: Any] ?? [:])
            try output(result)
        } catch {
            try? output(["error": (error as? NativeFailure)?.message ?? error.localizedDescription])
            exit(1)
        }
    }

    static func output(_ result: [String: Any]) throws {
        FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]))
        FileHandle.standardOutput.write(Data([10]))
    }

    @MainActor static func execute(_ operation: String, _ args: [String: Any]) async throws -> [String: Any] {
        if operation == "permissions" {
            return ["accessibility": AXIsProcessTrusted(), "screenRecording": CGPreflightScreenCaptureAccess(),
                    "message": "Grant permissions to Fast Desktop Command in macOS System Settings when you want native input or screenshots."]
        }
        if operation == "apps" {
            return ["apps": NSWorkspace.shared.runningApplications.filter { $0.activationPolicy == .regular }.map {
                ["name": $0.localizedName ?? "App", "bundleId": $0.bundleIdentifier ?? "", "pid": $0.processIdentifier, "active": $0.isActive] as [String: Any]
            }]
        }
        if operation == "windows" {
            let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
            let pid = args["pid"] as? Int
            return ["windows": windows.filter { ($0[kCGWindowLayer as String] as? Int) == 0 && (pid == nil || $0[kCGWindowOwnerPID as String] as? Int == pid) }.map {
                ["id": $0[kCGWindowNumber as String] ?? 0, "pid": $0[kCGWindowOwnerPID as String] ?? 0,
                 "app": $0[kCGWindowOwnerName as String] ?? "", "title": $0[kCGWindowName as String] ?? "",
                 "bounds": $0[kCGWindowBounds as String] ?? [:]]
            }, "screenRecording": CGPreflightScreenCaptureAccess()]
        }
        if operation == "screenshot" {
            guard CGPreflightScreenCaptureAccess() else { throw NativeFailure(message: "Screen Recording permission is required. Enable it for Fast Desktop Command in System Settings; then try again.") }
            guard let identifier = args["windowId"] as? UInt32 else { throw NativeFailure(message: "Choose a windowId from native_windows.") }
            let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true)
            guard let window = content.windows.first(where: { $0.windowID == identifier }) else { throw NativeFailure(message: "The selected window is no longer available. Refresh native_windows.") }
            let filter = SCContentFilter(desktopIndependentWindow: window)
            let config = SCStreamConfiguration()
            config.width = max(1, Int(window.frame.width * 2))
            config.height = max(1, Int(window.frame.height * 2))
            config.showsCursor = false
            let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
            guard let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) else { throw NativeFailure(message: "Image encoding failed.") }
            return ["image": png.base64EncodedString(), "mimeType": "image/png", "width": image.width, "height": image.height,
                    "bounds": ["x": window.frame.minX, "y": window.frame.minY, "width": window.frame.width, "height": window.frame.height]]
        }
        guard AXIsProcessTrusted() else { throw NativeFailure(message: "Accessibility permission is required. Enable it for Fast Desktop Command in System Settings; then try again.") }
        let source = CGEventSource(stateID: .hidSystemState)
        if operation == "click" {
            guard let x = args["x"] as? Double, let y = args["y"] as? Double, x.isFinite, y.isFinite else { throw NativeFailure(message: "Provide finite screen coordinates.") }
            var count: UInt32 = 0
            CGGetActiveDisplayList(0, nil, &count)
            var displays = [CGDirectDisplayID](repeating: 0, count: Int(count))
            CGGetActiveDisplayList(count, &displays, &count)
            let point = CGPoint(x: x, y: y)
            guard displays.contains(where: { CGDisplayBounds($0).contains(point) }) else { throw NativeFailure(message: "Click coordinates are outside the connected displays.") }
            let right = args["button"] as? String == "right"
            CGEvent(mouseEventSource: source, mouseType: right ? .rightMouseDown : .leftMouseDown, mouseCursorPosition: point, mouseButton: right ? .right : .left)?.post(tap: .cghidEventTap)
            CGEvent(mouseEventSource: source, mouseType: right ? .rightMouseUp : .leftMouseUp, mouseCursorPosition: point, mouseButton: right ? .right : .left)?.post(tap: .cghidEventTap)
            return ["clicked": true, "x": x, "y": y]
        }
        if operation == "type" {
            guard let text = args["text"] as? String, text.utf16.count <= 4000 else { throw NativeFailure(message: "Text is limited to 4000 UTF-16 units per call.") }
            let characters = Array(text.utf16)
            let down = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true)
            characters.withUnsafeBufferPointer { down?.keyboardSetUnicodeString(stringLength: characters.count, unicodeString: $0.baseAddress) }
            down?.post(tap: .cghidEventTap)
            CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false)?.post(tap: .cghidEventTap)
            return ["typed": true, "characters": text.count]
        }
        if operation == "key" {
            let keys: [String: CGKeyCode] = ["return":36,"tab":48,"space":49,"escape":53,"backspace":51,"delete":117,"left":123,"right":124,"down":125,"up":126,"a":0,"c":8,"v":9,"x":7,"z":6,"q":12,"w":13,"s":1,"f":3,"l":37]
            guard let name = args["key"] as? String, let code = keys[name.lowercased()] else { throw NativeFailure(message: "Unsupported key.") }
            var flags: CGEventFlags = []
            for modifier in args["modifiers"] as? [String] ?? [] {
                switch modifier { case "command": flags.insert(.maskCommand); case "shift": flags.insert(.maskShift); case "option": flags.insert(.maskAlternate); case "control": flags.insert(.maskControl); default: throw NativeFailure(message: "Unsupported modifier.") }
            }
            for pressed in [true, false] { let event = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: pressed); event?.flags = flags; event?.post(tap: .cghidEventTap) }
            return ["pressed": name]
        }
        throw NativeFailure(message: "Unsupported native operation.")
    }
}
