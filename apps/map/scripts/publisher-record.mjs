// Record publisher replies for cite-check: fetch a record URL from the publisher itself and keep the reply as
// lib/cite/__fixtures__/publisher/<sourceId>/<recordId>.json, with retrievedAt and the full body's sha256 in
// the header. Modelled on scripts/world-record.mjs, which does the same for the app's own routes.
//
//   node scripts/publisher-record.mjs --from-fixtures [world-fixture-name ...]
//       every record URL cited by the items of the world fixtures (all twelve if none named), one request a
//       second per host. Existing recordings are kept; add --force to re-fetch them.
//       --per-source N records at most N URLs per source (the first N in fixture order); --timeout S sets the request timeout (default 60 s).
//   node scripts/publisher-record.mjs <sourceId> <record url>
//       one record. The URL must be on that source's host (lib/cite/hosts.ts); anything else is refused.
//
// Only HTTP 200 replies are recorded. A refusal (403, 429, 5xx) is printed and nothing is written: a stub for
// those is built in the tests, not recorded. A big body is trimmed to what a matcher reads (trimBody) and the
// header says so ("trimmed"); sha256 and bytes are always those of the full body as received.

import { mkdirSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { loadCite, root, worldItems } from "./cite-load.mjs";

const args = process.argv.slice(2);
const force = args.includes("--force");
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? Number(args[i + 1]) : dflt; };
const perSource = opt("--per-source", Infinity);
const timeoutS = opt("--timeout", 60);
const rest = args.filter((a, i) => a !== "--force" && !a.startsWith("--per-source") && !a.startsWith("--timeout") && !/^--(per-source|timeout)$/.test(args[i - 1] ?? ""));
const outRoot = path.join(root, "lib", "cite", "__fixtures__", "publisher");
const worldDir = path.join(root, "lib", "mcp", "__fixtures__", "world");

const cite = await loadCite();
const deps = { fetchImpl: fetch, clock: cite.realClock, gate: cite.createGate(cite.realClock), timeoutMs: timeoutS * 1000 };

/**
 * What a matcher reads, when the whole body is bigger than it needs. The header always keeps the full body's
 * sha256 and byte count; "trimmed" says what was cut. An ArcGIS reply loses its schema listing (fields,
 * fieldAliases); UCMR rows keep the seven attributes the matcher reads (the rest name sampling points and
 * facilities); an EDGAR submissions file keeps the identity fields (its filings list and addresses are not read).
 */
const UCMR_KEEP = ["F_PWS_ID", "Contaminant", "Analytical_Result_Value__ng_L_", "Result_At_or_Above_UCMR_MRL", "Minimum_Reporting_Level__ng_L_", "Collection_Date", "UCMR_Cycle"];
const SEC_KEEP = ["cik", "entityType", "sic", "sicDescription", "name", "tickers", "exchanges", "category", "stateOfIncorporation"];
function trimBody(sourceId, body) {
  if (sourceId === "bls-qcew") {
    if (body.length <= 100_000) return { body, trimmed: null };
    const lines = body.split(/\r?\n/);
    const keep = [lines[0], ...lines.slice(1).filter((l) => /^"\d+","0","10",/.test(l))];
    return { body: keep.join("\n") + "\n", trimmed: "header and the own_code 0, industry_code 10 rows" };
  }
  if (sourceId === "sec-edgar") {
    const j = JSON.parse(body);
    return { body: JSON.stringify(Object.fromEntries(SEC_KEEP.map((k) => [k, j[k]]))), trimmed: "identity fields only (" + SEC_KEEP.join(", ") + ")" };
  }
  let j;
  try {
    j = JSON.parse(body);
  } catch {
    if (body.length > 400_000) throw new Error(sourceId + ": non-JSON body over 400 KB with no trimming rule");
    return { body, trimmed: null };
  }
  if (sourceId === "cms-provider-data" && Array.isArray(j.results)) {
    const keep = ["facility_id", "hospital_type", "hospital_overall_rating", "hospital_overall_rating_footnote"];
    j.results = j.results.map((r) => Object.fromEntries(keep.map((k) => [k, r[k] ?? null])));
    return { body: JSON.stringify(j), trimmed: "kept 4 fields per row: " + keep.join(", ") };
  }
  if (!Array.isArray(j.features)) return { body, trimmed: null };
  const cut = ["fields", "fieldAliases"].filter((k) => k in j);
  for (const k of cut) delete j[k];
  if (sourceId === "epa-ucmr5-pat") j.features = j.features.map((f) => ({ attributes: Object.fromEntries(UCMR_KEEP.map((k) => [k, f.attributes?.[k] ?? null])) }));
  const note = [cut.length ? "dropped the ArcGIS schema listing (fields, fieldAliases)" : "", sourceId === "epa-ucmr5-pat" ? "kept 7 attributes per row: " + UCMR_KEEP.join(", ") : ""].filter(Boolean).join("; ");
  return { body: JSON.stringify(j), trimmed: note || null };
}

async function record(sourceId, url) {
  if (!cite.RECORD_HOSTS[sourceId]?.test(url)) throw new Error(`${url} is not on ${sourceId}'s host (lib/cite/hosts.ts)`);
  const recordId = cite.recordIdOf(sourceId, url);
  const file = path.join(outRoot, sourceId, `${recordId}.json`);
  if (existsSync(file) && !force) return "kept";
  let reply = await cite.fetchPublisher(url, deps);
  if (reply.status === 0) reply = await cite.fetchPublisher(url, deps); // one retry for a timeout
  if (reply.status !== 200) {
    console.error(`  ${sourceId} ${recordId}: HTTP ${reply.status}${reply.error ? " " + reply.error : ""}, not recorded`);
    return "failed";
  }
  // ArcGIS answers HTTP 200 with {"error": {...}} when its backend fails; that is not the publisher's record
  if (/^\s*\{\s*"error"\s*:/.test(reply.body)) {
    console.error(`  ${sourceId} ${recordId}: HTTP 200 carrying an error object (${reply.body.slice(0, 100)}), not recorded`);
    return "failed";
  }
  const { body, trimmed } = trimBody(sourceId, reply.body);
  mkdirSync(path.dirname(file), { recursive: true });
  const doc = { sourceId, recordId, url, retrievedAt: reply.fetchedAt, status: reply.status, bytes: Buffer.byteLength(reply.body, "utf8"), sha256: reply.sha256, trimmed, body };
  writeFileSync(file, JSON.stringify(doc, null, 1) + "\n");
  return "recorded";
}

const tally = { recorded: 0, kept: 0, failed: 0, skipped: 0 };
const taken = {};
if (rest[0] === "--from-fixtures") {
  const names = rest.slice(1);
  const files = (names.length ? names.map((n) => `${n}.json`) : readdirSync(worldDir).filter((f) => f.endsWith(".json"))).sort();
  const seen = new Set();
  for (const f of files) {
    for (const it of await worldItems(path.join(worldDir, f))) {
      if (!it.upstreamRecordUrl || seen.has(it.upstreamRecordUrl)) continue;
      seen.add(it.upstreamRecordUrl);
      if (cite.refusal(it) || !cite.RECORD_HOSTS[it.sourceId]) {
        tally.skipped++;
        continue;
      }
      if ((taken[it.sourceId] ?? 0) >= perSource) {
        tally.skipped++;
        continue;
      }
      taken[it.sourceId] = (taken[it.sourceId] ?? 0) + 1;
      tally[await record(it.sourceId, it.upstreamRecordUrl)]++;
    }
  }
} else if (rest.length === 2) {
  tally[await record(rest[0], rest[1])]++;
} else {
  console.error("usage: node scripts/publisher-record.mjs --from-fixtures [name ...] | <sourceId> <record url>   (add --force to re-fetch)");
  process.exit(2);
}
console.log(JSON.stringify(tally));
process.exit(tally.failed ? 1 : 0);
