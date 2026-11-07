import AppKit
// Renders an app's icon the way macOS presents it (IconServices, as in the Dock and Finder).
// CI uploads the result so icon changes can be checked without a Mac.
// Usage: swift build/macos/render-icon.swift <App.app> <out.png>   (absolute App path)
let args = CommandLine.arguments
let icon = NSWorkspace.shared.icon(forFile: args[1])
let size = NSSize(width: 256, height: 256)
icon.size = size
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 256, pixelsHigh: 256, bitsPerSample: 8,
                           samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                           bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
NSColor.white.setFill(); NSRect(origin: .zero, size: size).fill()
icon.draw(in: NSRect(origin: .zero, size: size))
NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: args[2]))
