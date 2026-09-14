# FAST connection website

Source for the Sites-hosted dashboard, device pairing, OAuth/PKCE, and MCP relay. Production resource IDs and credentials are intentionally excluded.

Run `npm ci`, `node --test tests/server.test.mjs`, and use the Sites build/hosting workflow to deploy your own instance. D1 binding: `DB`. R2 binding: `BUCKET`.

Create your own Sites project and `.openai/hosting.json` before `npm run build`.
Use the migration files unchanged after their first deployment. The custom MCP
endpoint is `/api/mcp`; `/mcp` is reserved by the Sites hosting service.

The worker relies on identity headers injected by the Sites authentication
dispatcher. Do not expose this worker directly on another host without replacing
that trust boundary with verified authentication. Client-supplied identity headers
must never be trusted. OAuth tool calls verify opaque tokens, audience, expiry,
and account/device ownership separately from browser sign-in.

Production route, pairing, OAuth, and relay code are included here. Credentials,
user records, job results, and local runtime files are not source artifacts.
