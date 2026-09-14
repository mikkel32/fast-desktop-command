# Performance notes

Measurements are from an Apple Silicon Mac running Node 22.14.0. The MCP SDK
client connects to a real server and checks the returned result. Model reasoning,
Codex dispatch, and UI rendering are outside these timings.

Five separate optimized-engine launches measured 100 small reads, 100 interactive
replies, 100 session listings, 150 pings, and 25 short processes. Median small-file
read was 1.47 ms (p95 3.12 ms); interactive reply was 0.47 ms (p95 0.87 ms).
Median startup was 186 ms. Operating-system file caches were not cleared.

The earlier fork measured 43.2 ms reads, 41.5 ms replies, and 897 ms startup.
Profiling identified synchronous interpreter probes in disabled telemetry as the
dominant repeated cost. On-demand document engines reduced startup cost.

The native app route adds a local forwarding hop: one installed-route run measured
2.11 ms median reads, 0.70 ms replies, and 272 ms for a client startup/handshake.

Image timings include base64 payload transfer and SHA-256 verification of the exact
PNG bytes. First local image improved from 225 to 9 ms; repeated 81-402 KB images
took 3-9 ms. HTTPS examples ranged from 19 to 334 ms across runs. They are network
measurements, not promises. Fresh Node processes averaged around 50 ms and had a
134 ms outlier; persistent interpreters amortize that cost.

Run `npm run bench:local` for the engine benchmark. Pass an installed `.mcp.json`
path to `scripts/benchmark-local.mjs` or `scripts/benchmark-images-commands.mjs`
to measure that actual launch route. Raw local diagnostics are excluded from
public Git because they contain machine-specific paths and process metadata.
