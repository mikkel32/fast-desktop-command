---
name: fast-desktop-command-web
description: Use FAST Desktop Command to work on a user-paired Mac from ChatGPT or Codex, including files, images, command sessions, and native computer controls.
---

# FAST web connection

Use the FAST MCP tools. Start with `list_devices` and select the intended online
Mac. Do not assume that another device with a similar name is the requested one.

- Run only work authorized by the user. Respect host approvals, macOS permissions,
  app Stop, native-input preferences, and filesystem/command restrictions.
- Use a unique `requestKey` for a write or command when retry protection matters.
  Reuse it only to retrieve the same operation; use a new key for new work.
- If a response is pending, keep its `requestId` and call `get_request_status`.
  Do not repeat a command merely because its result is delayed or uncertain.
- Use `read_file` for images and actual file contents. Keep payloads bounded and
  use paging for large files. A remote transfer also includes network latency.
- Preserve process PIDs. Reuse an interpreter for repeated operations rather than
  starting it again. A wait timeout does not mean a process failed or exited.
- Before native input, inspect apps/windows and a fresh screenshot. Use that
  window's bounds for coordinates and verify the resulting state after actions.
- Never change permission settings or switch to another route to bypass a denied
  operation. Explain the exact missing permission or connection state.

Users pair the Mac through the FAST website and the native app's Connect web
button. Keep the Mac awake and the app running. Public directory approval is
separate from a working authenticated MCP connection.
