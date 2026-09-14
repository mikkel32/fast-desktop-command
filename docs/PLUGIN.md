# Codex plugin

The local plugin is `fast-as-fuck-desktop-command`. Its source directory is
`plugins/fast-as-fuck-desktop-command`.

Open Fast Desktop Command once so it records its installed runtime location. The
plugin's portable launcher reads that location and uses the app's bundled Node.
It does not require a system Node installation or a hardcoded checkout path.

Add the plugin to your personal Codex marketplace, install it, and start a new task.
The connection launcher uses the app's private local socket. Open the app and use
Start connection if you explicitly stopped it earlier.

The self-contained release includes the engine; a default Swift source build uses
its checkout and Node runtime. `node scripts/configure-local-plugin.mjs` regenerates
the portable local plugin configuration for development.

## ChatGPT web

1. Open the Mac app and choose **Connect web**.
2. Sign in at https://fast-desktop-command.mikkel-mynderup.chatgpt.site and approve
   the code displayed by the app. Confirm the Mac shows Online.
3. In ChatGPT, enable developer mode and create an MCP plugin named
   **FAST Desktop Command** with OAuth authentication and this server URL:

   `https://fast-desktop-command.mikkel-mynderup.chatgpt.site/api/mcp`

4. Connect your account, refresh its tools, then choose **Try in chat** to start a
   fresh conversation. Start by asking it to call
   `list_devices` and run `printf 'FAST_WEB_OK\n'` on the intended online Mac.

The web plugin exposes 32 tools, including device selection and pending-request
retrieval. The local engine exposes 33. Local-only configuration, feedback, and
prompt-library tools are omitted from the remote inventory. If a response is
pending, use `get_request_status`; do not run the operation again. An optional
`requestKey` deduplicates an explicit retry for three minutes.

Interpreter sessions follow the authenticated account and OAuth client, including
when ChatGPT reconnects HTTP. Tool execution still occurs on the selected Mac.
The relay and Internet round trip add latency beyond the local benchmarks.

Before native input, capture the target window in the same tool session. FAST
binds input to that window and verifies that it has not moved or closed. Native
button presses use Accessibility within the captured window. When a click needs
focus, FAST activates only that captured app, rechecks its window, and tries the
native button action again. Keyboard and raw mouse events require its app to be
foreground. Read the result and verify
the actual UI effect. Ad hoc rebuilds may require removing and re-adding FAST in
macOS Privacy & Security because its code signature changes.

The public OpenAI directory requires verified developer identity and review.
Private developer-mode connections do not require that public listing.
