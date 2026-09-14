<div align="center">
  <img src="assets/app-icon.png" width="112" alt="FAST lightning icon" />
  <h1>FAST Desktop Command</h1>
  <p><strong>Your Mac. At full speed.</strong></p>
  <p>A native Swift app and a fast local MCP engine for Codex.</p>
  <p><a href="https://fast-desktop-command.mikkel-mynderup.chatgpt.site">Website and connection setup</a> / <a href="#get-started">Source build</a> / <a href="docs/PERFORMANCE.md">Measurements</a></p>
</div>

---

Start the connection. Check its health. Get on with your work.

FAST gives Codex local files, images, search, shell commands, and persistent
processes, with a compact native macOS control panel. It is a performance-focused
fork of [Desktop Commander](https://github.com/wonderwhy-er/DesktopCommanderMCP).
The original MIT license and attribution are preserved.

## Built for everyday use

- **Native SwiftUI app:** Start/Stop, real command and image checks, live connection
  status, and menu-bar access.
- **Fast local tools:** event-driven output, lazy document engines, and no required
  hosted relay for local use.
- **Isolated client sessions:** reuse a Python or Node process while each connected
  app keeps its own process state.
- **Actual images:** full image bytes, with no quality reduction or stale cache.
- **Codex integration:** the local plugin connects through the app you control.
- **Source included:** Swift, TypeScript, regression tests, and benchmark scripts.

## Measured performance

Local MCP round trips on Apple Silicon; excludes model reasoning and UI rendering.

| Operation | First fork | Optimized engine |
| --- | ---: | ---: |
| Interactive reply | 41.5 ms | **0.47 ms** |
| Small text read | 43.2 ms | **1.47 ms** |
| List sessions | 21.0 ms | **0.37 ms** |
| Server startup | 897 ms | **186 ms** |
| First local image | 225 ms | **9 ms** |

Through the native app connection, small reads measured **2.1 ms**, and interactive
replies **0.7 ms**. Fresh interpreter launches and Internet fetches have additional
real costs. See [measurement scope and methodology](docs/PERFORMANCE.md).

## What made it faster

1. Disabled telemetry now skips collection itself, including synchronous Python
   version probes that previously ran during normal tool calls.
2. PDF, Excel, and DOCX engines load only when needed.
3. Output and exit events wake waiting calls immediately instead of polling.
4. Process snapshots read the new tail instead of copying all retained history.
5. Model image reads skip an unnecessary macOS default-editor lookup.

## Get started

Source builds require macOS 14+, Node.js 20+, and Xcode command-line tools.

```sh
git clone https://github.com/mikkel32/fast-desktop-command.git
cd fast-desktop-command
npm ci --ignore-scripts --no-audit --no-fund
npm run build
python3 scripts/build-macos-app.py
open "Fast Desktop Command.app"
```

This source build uses its checkout and Node runtime. Keep the directory in place.
It is signed ad hoc, not Apple-notarized. System ripgrep supplies search when the
optional npm binary is unavailable.

Open the app to start. Use **Check now** to verify real commands and image bytes.
Close its window to leave it in the menu bar. **Stop connection** disconnects
app-managed clients and is respected by the plugin.

For the Codex plugin, see [setup instructions](docs/PLUGIN.md). Start a new Codex
task after installation. Web pairing and distribution are being prepared on the
[FAST site](https://fast-desktop-command.mikkel-mynderup.chatgpt.site); local plugin
installation alone does not create a web connection or public directory listing.

## Privacy and control

Local connections use a private Unix socket. Health access is loopback-only and
authenticated. The local entrypoint disables upstream telemetry. Path validation
and command restrictions remain in place. macOS permissions and host approvals
still apply. See [privacy](docs/PRIVACY.md) and [security](SECURITY.md).

## Develop and verify

```sh
npm run build
npm run test:fast
npm run test:upstream-focused
swift test --package-path macos
npm run test:app
npm run bench:local
```

- `src/`: the MCP engine and performance changes.
- `macos/`: SwiftUI app, app icon source, and Swift tests.
- `scripts/`: native connection service, build tools, and benchmarks.
- `plugins/fast-as-fuck-desktop-command/`: the FAST integration.

## Credits

Maintained by [Mikkel Mynderup](https://github.com/mikkel32), based on the MIT-licensed
Desktop Commander by Eduards Ruzga and contributors. Upstream baseline:
`74bca3d642dec0973e55db641dcaffd49a70ca40` (0.2.50).

FAST's app, branding, connection manager, and optimizations are maintained in this
fork. This is an independent project, not an official OpenAI product or the
upstream Desktop Commander hosted service. [Original documentation](docs/UPSTREAM.md).
