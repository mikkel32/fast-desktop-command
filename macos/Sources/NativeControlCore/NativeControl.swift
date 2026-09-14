import AppKit
import ApplicationServices
import ScreenCaptureKit

struct NativeFailure: Error { let message: String }

public enum NativeControlRunner {
    @MainActor public static func run() async {
        do {
            // ScreenCaptureKit needs an AppKit connection to WindowServer even
            // when this helper is launched as a command-line executable.
            NSApplication.shared.setActivationPolicy(.prohibited)
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

    static func axAttribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else { return nil }
        return value
    }

    static func axFrame(_ element: AXUIElement) -> CGRect? {
        guard let position = axAttribute(element, kAXPositionAttribute),
              let size = axAttribute(element, kAXSizeAttribute),
              CFGetTypeID(position) == AXValueGetTypeID(), CFGetTypeID(size) == AXValueGetTypeID() else { return nil }
        var point = CGPoint.zero; var dimensions = CGSize.zero
        guard AXValueGetValue(position as! AXValue, .cgPoint, &point),
              AXValueGetValue(size as! AXValue, .cgSize, &dimensions) else { return nil }
        return CGRect(origin: point, size: dimensions)
    }

    static func pressTarget(_ element: AXUIElement, at point: CGPoint, budget: inout Int) -> Bool {
        guard budget > 0 else { return false }; budget -= 1
        let frame = axFrame(element)
        if let frame, !frame.isEmpty, !frame.contains(point) { return false }
        for child in axAttribute(element, kAXChildrenAttribute) as? [AXUIElement] ?? [] {
            if pressTarget(child, at: point, budget: &budget) { return true }
        }
        var actions: CFArray?
        guard frame?.contains(point) == true,
              AXUIElementCopyActionNames(element, &actions) == .success,
              (actions as? [String])?.contains(kAXPressAction as String) == true else { return false }
        return AXUIElementPerformAction(element, kAXPressAction as CFString) == .success
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
            let pid = args["pid"] as? Int
            if CGPreflightScreenCaptureAccess() {
                let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: false)
                return ["screenRecording": true, "windows": content.windows.filter {
                    $0.windowLayer == 0 && (pid == nil || Int($0.owningApplication?.processID ?? 0) == pid)
                }.map {
                    ["id": $0.windowID, "pid": $0.owningApplication?.processID ?? 0,
                     "app": $0.owningApplication?.applicationName ?? "", "title": $0.title ?? "",
                     "bounds": ["X": $0.frame.minX, "Y": $0.frame.minY, "Width": $0.frame.width, "Height": $0.frame.height]] as [String: Any]
                }]
            }
            let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
            return ["windows": windows.filter { ($0[kCGWindowLayer as String] as? Int) == 0 && (pid == nil || $0[kCGWindowOwnerPID as String] as? Int == pid) }.map {
                ["id": $0[kCGWindowNumber as String] ?? 0, "pid": $0[kCGWindowOwnerPID as String] ?? 0,
                 "app": $0[kCGWindowOwnerName as String] ?? "", "title": $0[kCGWindowName as String] ?? "",
                 "bounds": $0[kCGWindowBounds as String] ?? [:]]
            }, "screenRecording": CGPreflightScreenCaptureAccess()]
        }
        if operation == "screenshot" {
            guard CGPreflightScreenCaptureAccess() else { throw NativeFailure(message: "Screen Recording permission is required. Enable it for Fast Desktop Command in System Settings; then try again.") }
            guard let identifier = args["windowId"] as? UInt32 else { throw NativeFailure(message: "Choose a windowId from native_windows.") }
            let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: false)
            guard let window = content.windows.first(where: { $0.windowID == identifier }) else { throw NativeFailure(message: "The selected window is no longer available. Refresh native_windows.") }
            let filter = SCContentFilter(desktopIndependentWindow: window)
            let config = SCStreamConfiguration()
            config.width = max(1, Int(window.frame.width * 2))
            config.height = max(1, Int(window.frame.height * 2))
            config.showsCursor = false
            let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
            guard let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) else { throw NativeFailure(message: "Image encoding failed.") }
            return ["image": png.base64EncodedString(), "mimeType": "image/png", "width": image.width, "height": image.height,
                    "windowId": window.windowID, "pid": window.owningApplication?.processID ?? 0,
                    "bounds": ["x": window.frame.minX, "y": window.frame.minY, "width": window.frame.width, "height": window.frame.height]]
        }
        guard AXIsProcessTrusted() else { throw NativeFailure(message: "Accessibility permission is required. Enable it for Fast Desktop Command in System Settings; then try again.") }
        guard let target = args["target"] as? [String: Any],
              let windowID = target["windowId"] as? UInt32,
              let pid = target["pid"] as? Int32,
              let expected = target["bounds"] as? [String: Double],
              let x = expected["x"], let y = expected["y"],
              let width = expected["width"], let height = expected["height"] else {
            throw NativeFailure(message: "Capture the target window before sending native input.")
        }
        let windows = CGWindowListCopyWindowInfo(.optionAll, kCGNullWindowID) as? [[String: Any]] ?? []
        guard let window = windows.first(where: { ($0[kCGWindowNumber as String] as? UInt32) == windowID }),
              window[kCGWindowOwnerPID as String] as? Int32 == pid,
              let rawBounds = window[kCGWindowBounds as String] as? [String: Double],
              let currentX = rawBounds["X"], let currentY = rawBounds["Y"],
              let currentWidth = rawBounds["Width"], let currentHeight = rawBounds["Height"],
              CGRect(x: currentX, y: currentY, width: currentWidth, height: currentHeight) == CGRect(x: x, y: y, width: width, height: height) else {
            throw NativeFailure(message: "The captured window moved or closed. Capture it again before input.")
        }
        let targetBounds = CGRect(x: x, y: y, width: width, height: height)
        if operation != "click", NSWorkspace.shared.frontmostApplication?.processIdentifier != pid {
            throw NativeFailure(message: "The captured app is no longer foreground. Bring it forward and capture it again before keyboard input.")
        }
        let source = CGEventSource(stateID: .hidSystemState)
        if operation == "click" {
            guard let x = args["x"] as? Double, let y = args["y"] as? Double, x.isFinite, y.isFinite else { throw NativeFailure(message: "Provide finite screen coordinates.") }
            var count: UInt32 = 0
            CGGetActiveDisplayList(0, nil, &count)
            var displays = [CGDirectDisplayID](repeating: 0, count: Int(count))
            CGGetActiveDisplayList(count, &displays, &count)
            let point = CGPoint(x: x, y: y)
            guard displays.contains(where: { CGDisplayBounds($0).contains(point) }) else { throw NativeFailure(message: "Click coordinates are outside the connected displays.") }
            guard targetBounds.contains(point) else { throw NativeFailure(message: "Click coordinates are outside the captured window.") }
            let right = args["button"] as? String == "right"
            // A semantic press gives native buttons reliable delivery without
            // depending on hover tracking or a short-lived mouse event source.
            if !right {
                let app = AXUIElementCreateApplication(pid)
                for axWindow in axAttribute(app, kAXWindowsAttribute) as? [AXUIElement] ?? [] {
                    guard axFrame(axWindow) == targetBounds else { continue }
                    var budget = 256
                    if pressTarget(axWindow, at: point, budget: &budget) {
                        return ["clicked": true, "delivery": "accessibility", "windowId": windowID, "x": x, "y": y]
                    }
                }
            }
            // The captured window identifies the intended app. Activate only
            // that app when it cannot expose a background Accessibility action.
            if NSWorkspace.shared.frontmostApplication?.processIdentifier != pid {
                guard NSRunningApplication(processIdentifier: pid)?.activate(options: [.activateIgnoringOtherApps]) == true else {
                    throw NativeFailure(message: "Could not bring the captured app forward. Open it and capture the window again.")
                }
                try await Task.sleep(for: .milliseconds(150))
            }
            let visible = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as? [[String: Any]] ?? []
            guard NSWorkspace.shared.frontmostApplication?.processIdentifier == pid,
                  visible.contains(where: { ($0[kCGWindowNumber as String] as? UInt32) == windowID }) else {
                throw NativeFailure(message: "No native button action was available, and the captured app is no longer foreground. Bring it forward and capture it again before a mouse event.")
            }
            let app = AXUIElementCreateApplication(pid)
            guard let axWindow = (axAttribute(app, kAXWindowsAttribute) as? [AXUIElement] ?? []).first(where: { axFrame($0) == targetBounds }) else {
                throw NativeFailure(message: "The target window changed during activation. Capture it again before input.")
            }
            if !right {
                var budget = 256
                if pressTarget(axWindow, at: point, budget: &budget) {
                    return ["clicked": true, "delivery": "accessibility", "windowId": windowID, "x": x, "y": y]
                }
            }
            guard let move = CGEvent(mouseEventSource: source, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left),
                  let down = CGEvent(mouseEventSource: source, mouseType: right ? .rightMouseDown : .leftMouseDown, mouseCursorPosition: point, mouseButton: right ? .right : .left),
                  let up = CGEvent(mouseEventSource: source, mouseType: right ? .rightMouseUp : .leftMouseUp, mouseCursorPosition: point, mouseButton: right ? .right : .left) else { throw NativeFailure(message: "Could not create mouse events.") }
            move.post(tap: .cghidEventTap)
            down.setIntegerValueField(.mouseEventClickState, value: 1)
            up.setIntegerValueField(.mouseEventClickState, value: 1)
            down.post(tap: .cghidEventTap)
            try await Task.sleep(for: .milliseconds(20))
            up.post(tap: .cghidEventTap)
            try await Task.sleep(for: .milliseconds(20))
            return ["posted": true, "delivery": "quartz", "x": x, "y": y, "verifyWithScreenshot": true]
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
