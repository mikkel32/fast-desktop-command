import NativeControlCore

@main struct NativeControl {
    @MainActor static func main() async {
        await NativeControlRunner.run()
    }
}
