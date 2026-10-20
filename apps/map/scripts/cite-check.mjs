// cite-check: verify the items of a world_context bundle against the publisher's own keyed record.
//
//   node scripts/cite-check.mjs --fixtures [input.json ...]   recorded publisher replies; no network
//   node scripts/cite-check.mjs --live [input.json ...]       fetch each record URL from the publisher
//   add --json for the verdicts as JSON after the report
//
// Inputs: a world fixture (lib/mcp/__fixtures__/world/*.json; all twelve if none is named), a world_context reply, or a
// v3-shaped facts file ({"facts": [{fact, value, unit, period, sourceId, upstreamRecordUrl, retrievedAt, code}]}).
// --live sends the per-host accepted User-Agent (lib/cite/hosts.ts), at most one request a second per host, 25 s timeout,
// at most 400 requests a run. UNREACHABLE (403, 429, 5xx, timeout) and NO_RECORD_URL are unscored: never counted wrong.
// Needs Node 22.18+ (it loads the TypeScript in lib/cite directly; see scripts/cite-load.mjs).

import { root } from "./cite-load.mjs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const load = (rel) => import(pathToFileURL(path.join(root, rel)).href);
const { runCli } = await load("lib/cite/cli.ts");
const { realClock } = await load("lib/cite/fetch.ts");

const argv = process.argv.slice(2);
const r = await runCli(argv.filter((a) => a !== "--json"), { fetchImpl: fetch, clock: realClock });
process.stdout.write(r.text);
if (argv.includes("--json")) process.stdout.write(JSON.stringify(r.verdicts, null, 1) + "\n");
process.exit(r.code);
