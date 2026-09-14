# Fast Desktop Command for Mac

A compact SwiftUI app for the local Desktop Commander fork. macOS 14 or newer.

Open `../Fast Desktop Command.app`. The connection starts automatically. Use
**Stop connection** to disconnect or **Check now** to verify commands and images.
Closing the window leaves the app in the menu bar. Quit stops its service.

The installed personal plugin uses `scripts/app-connect.mjs`. This forwards MCP
frames unchanged over a private local socket to an engine owned by the app.
Each connected client has a separate MCP session. The app tracks connections
that have received their initialize response; it does not count the health
engine as a connected client. Full checks verify exact command output and image
hashes, and the light heartbeat sends a real MCP ping every three seconds.

The app uses a private `~/.fast-as-fuck-desktop-command/app` directory. Its health
endpoint requires a random token and only listens on loopback. Diagnostics never
include that token. An explicit Stop writes a pause marker so an automatic plugin
launch cannot reverse the user's choice. Start removes that marker.

## Build and verification

```sh
python3 scripts/build-macos-app.py
swift test --package-path macos
node --test test/app-service.test.mjs
```

Run these commands from the repository root. The build script embeds the checkout
and Node paths into `Contents/Resources/Runtime.json`, generates the icon, and
signs the app ad hoc. This is a local development app, not a notarized standalone
distribution. Keep the checkout and Node runtime available.

Swift sources are in `macos/Sources`. `ConnectionCore` contains decoding and the
health decision rules; the UI uses a main-actor observable model. Process pipes
and async HTTP requests keep the view responsive. A slow first start continues
to be checked until the engine is ready; stopping waits for the service to exit
before enabling another start. Quit/parent-pipe closure cleans up owned sessions.

The application controls app-managed clients. Existing clients launched directly
by an older plugin version remain separate until reconnected with the new plugin.

The native app was opened and its Start, Stop, Check now, and close/reopen paths
were exercised. The live app displayed an initialized plugin client. The backend
test checks real tool calls, image bytes, multiple-client state isolation,
authentication, permissions, shutdown cleanup, and a new connection after restart.
