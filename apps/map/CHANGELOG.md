# Changelog

The public MCP server and its published schema, newest first. `SERVER_VERSION` (`lib/mcp/server.ts`) is the server string a client reads from `initialize` and `GET /api/mcp`; it is not the `world/N` schema version, which is `schemaVersion` on a `world_context` reply. `lib/mcp/server.lock.json` holds a hash of what `tools/list` says for each version here, and `lib/mcp/server.test.ts` fails when `tools/list` or `world_context`'s `outputSchema` changes without a new version and a dated heading below. The rules are in `docs/MCP.md`, "Versioning promise": additive within `world/N`, and a removed or renamed tool is announced under "Deprecated" here at least 30 days before it goes.

## 0.4.0 - 2026-10-20

World/2 and the surfacing contract, recorded as one server version. The first entry the version lock holds.

- Version number: 0.1.0 to 0.4.0 in one step. `public/openapi.json` already said 0.3.0 and now carries the same number as the server, so the larger was kept and no published number goes backwards. 0.2.0 and 0.3.0 were never server versions.
- Surfacing contract (#65, merged 2026-10-20): the server's `instructions` (1,017 characters), the `_meta` alwaysLoad flag on `world_context` alone, every tool description at most 3,800 characters.
- Typed absence and the `world/2` outputSchema (#69, merged 2026-10-20): every `missing[]` entry and `coverageStatus` basis line of a `world_context` reply carries a code from a closed list with an action; `world_context` publishes its `outputSchema` in `tools/list` and `GET /api/mcp`; every reply is checked against it before it is sent. `schemaVersion` `"world/2"` is a new key on the reply. It is additive within `world/2` and is not a schema version bump.
- This change (W3P): the version lock, the check of the published schema against the committed `world/2` baseline (`lib/mcp/server.world-2.schema.json`), `public/openapi.json` carrying `SERVER_VERSION` and https://www.arxiviq.com as its first server. No tool, description or schema changed in it. Alongside it, nine sources `world_context` relays now carry a `licenseId`, each with the publisher's own page and the day it was read.
- Before the lock: 0.1.0 had no recorded hashes, so what changed inside it cannot be rebuilt from this file.
