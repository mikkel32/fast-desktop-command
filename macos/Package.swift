// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "FastDesktopCommand",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "FastDesktopCommand", targets: ["FastDesktopCommand"]), .executable(name: "NativeControl", targets: ["NativeControl"])],
    targets: [
        .target(name: "ConnectionCore"),
        .executableTarget(name: "FastDesktopCommand", dependencies: ["ConnectionCore"]),
        .executableTarget(name: "NativeControl"),
        .testTarget(name: "ConnectionCoreTests", dependencies: ["ConnectionCore"])
    ]
)
