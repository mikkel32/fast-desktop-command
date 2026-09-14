---
name: desktop-command
description: Use the fast-as-fuck Desktop-Command local MCP tools when the user requests this plugin, Desktop Commander local file work, terminal sessions, or testing this fork.
---

# fast-as-fuck Desktop-Command

This personal plugin connects through the Fast Desktop Command Swift app to the
local engine. Each connected client retains its own MCP session and process state.
Use its `fast_desktop_command` MCP server when the user requests this plugin.

The app starts the connection on launch and stays in the menu bar. Use its Start /
Stop connection button and Check now button to control and diagnose it. If the
connection was explicitly stopped, respect that state: ask the user to start it
in the app. Do not bypass the app by launching another engine directly.

- Use absolute paths for file tools. Use `read_multiple_files` for independent reads.
- Read an image with `read_file({path: "/absolute/image.png"})`; it returns a real
  image block. For a URL, use `read_file({path: "https://...", isUrl: true})`.
  Do not set `origin: "ui"` for a model image read: that route is widget-only.
- Run ordinary commands with `start_process({command: "..."})`. The default wait
  is 1000 ms and exits return early. For portable shell commands, `shell: "/bin/sh"`
  avoids login-shell setup; use the configured shell when its environment matters.
- For many Python/Node operations, start one interpreter and reuse its PID. This
  preserves variables and pays interpreter startup once. Verify returned output.
- Preserve running process PIDs. Use `interact_with_process` for a persistent REPL
  and `read_process_output` for a process still running after a timeout.
- A timeout returns current output; it does not imply that a process failed or exited.
- Keep tool batches within the user's authorized scope and preserve existing files.
- Report actual errors and do not retry rejected operations through another tool.
- Use `list_sessions` for a small real tool smoke test. MCP server latency excludes
  model reasoning, host dispatch, and UI rendering; do not call it end-to-end latency.
- Config is stored in `~/.fast-as-fuck-desktop-command/config.json`. The old remote
  plugin uses a separate path. Keep the upstream path and command checks intact.

The local plugin configuration points at the user's Desktop checkout. Run
`npm run build` there after source edits. New Codex tasks pick up installed tools.
