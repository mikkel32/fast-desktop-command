# Release verification - 14 September 2026

Initial app source: `60ff9102d091d10fbbb5dad7cbe0059ebf517875` (1.0.0).
The 1.0.1 follow-up fixes the app-owned native-input toggle and keeps the native
helper out of the running-app list. The packaged app version follows package.json.
Sites source: `87d4d927d5dd371a77514f1fc297d95bbd4b5ed5`.

## Observed on Apple Silicon

- Self-contained app built with Node and ripgrep, launched outside its source
  checkout, and passed command/image health checks.
- `codesign --verify --deep --strict` passed. GitHub's uploaded app and plugin
  SHA-256 digests matched the local release assets.
- Bundled ripgrep resolved and ran with PATH restricted to `/usr/bin:/bin`.
- The installed web instance reconnected after restarting with its existing
  pairing. The original local instance and its active clients were preserved.
- Native window capture returned a real 920 x 1428 PNG when run from the
  permission-enabled development host. A missing AppKit initialization had caused
  an abort; the released helper includes the fix.

## Real ChatGPT test

Using the private FAST plugin in a fresh conversation:

1. `list_devices` returned the paired online Mac.
2. `start_process` ran a shell command and returned `FAST_WEB_OK` plus the bundled
   engine working directory, with `isError: false`.
3. `read_file` returned the FAST app icon as image content.
4. A Node REPL set `globalThis.fastReleaseValue = 41`. A later message reused the
   same PID and returned `42` for `globalThis.fastReleaseValue + 1`.
5. `.exit` finished only that test process.
6. The installed app reported Accessibility and Screen Recording as unavailable.
   `native_screenshot` returned the explicit permission error. No OS permissions
   or native input settings were changed during this test.

The first endpoint used `/mcp`, which the hosting service intercepted. The public
FAST endpoint is `/api/mcp`. Tool discovery is public metadata; executing a tool
requires OAuth and account/device ownership. An older conversation rejected the
developer MCP, so testing followed OpenAI's documented Refresh / Try in chat flow.

## Automated checks

- 20 focused engine regressions passed.
- Native app-service integration passed with 33 local tools.
- The 1.0.1 regression check verifies authenticated UI toggles persist, anonymous
  toggles fail, agents cannot change that setting through `set_config_value`, and
  disabled input returns its explicit error before posting a native event.
- Three Swift health/state tests passed.
- Sites tests passed for pairing, PKCE, account isolation, request deduplication,
  reconnect continuity, token refresh, revocation, and anonymous execution denial.
- Live unauthenticated and spoofed-identity device-list requests returned 401.

These checks do not certify every tool, network condition, or OS configuration.
The recorded millisecond benchmarks measure local operations, not model reasoning
or a complete ChatGPT turn. Native mouse/keyboard testing is recorded separately. The
public OpenAI directory listing is pending developer verification and review;
the Mac download is signed ad hoc and is not notarized by Apple.
