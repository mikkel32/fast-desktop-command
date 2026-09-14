// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "FastDesktopCommand",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "FastDesktopCommand", targets: ["FastDesktopCommand"]), .executable(name: "NativeControl", targets: ["NativeControl"])],
    targets: [
        .target(name: "ConnectionCore"),
        .target(name: "NativeControlCore"),
        .executableTarget(name: "FastDesktopCommand", dependencies: ["ConnectionCore", "NativeControlCore"]),
        .executableTarget(name: "NativeControl", dependencies: ["NativeControlCore"]),
        .testTarget(name: "ConnectionCoreTests", dependencies: ["ConnectionCore"])
    ]
)
