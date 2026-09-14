// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "FastDesktopCommand",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "FastDesktopCommand", targets: ["FastDesktopCommand"])],
    targets: [
        .target(name: "ConnectionCore"),
        .executableTarget(name: "FastDesktopCommand", dependencies: ["ConnectionCore"]),
        .testTarget(name: "ConnectionCoreTests", dependencies: ["ConnectionCore"])
    ]
)
