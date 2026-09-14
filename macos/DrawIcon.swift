import AppKit

let output = URL(fileURLWithPath: CommandLine.arguments[1])
let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 1024, pixelsHigh: 1024,
    bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
    colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
NSColor(srgbRed: 0.065, green: 0.075, blue: 0.072, alpha: 1).setFill()
NSBezierPath(roundedRect: NSRect(x: 32, y: 32, width: 960, height: 960), xRadius: 210, yRadius: 210).fill()
NSColor(srgbRed: 0.79, green: 0.98, blue: 0.38, alpha: 1).setFill()
let bolt = NSBezierPath()
bolt.move(to: NSPoint(x: 578, y: 845))
bolt.line(to: NSPoint(x: 289, y: 461))
bolt.line(to: NSPoint(x: 482, y: 461))
bolt.line(to: NSPoint(x: 420, y: 185))
bolt.line(to: NSPoint(x: 741, y: 598))
bolt.line(to: NSPoint(x: 545, y: 598))
bolt.close()
bolt.fill()
NSGraphicsContext.restoreGraphicsState()
try bitmap.representation(using: .png, properties: [:])!.write(to: output)
