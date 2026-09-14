# Codex plugin

The local plugin is `fast-as-fuck-desktop-command`. Its source directory is
`plugins/fast-as-fuck-desktop-command`.

After building the engine and Swift app, run `node scripts/configure-local-plugin.mjs`
to generate this checkout's machine-specific MCP configuration. A public template
is provided as `.mcp.json.example`; generated absolute paths are not published.

Add the plugin to your personal Codex marketplace, install it, and start a new task.
The connection launcher uses the app's private local socket. Open the app and use
Start connection if you explicitly stopped it earlier.

The Swift source build depends on its checkout and Node runtime. Web connections
require a separately authenticated remote MCP path. A public plugin directory
listing requires OpenAI review; a GitHub release is not that approval.
