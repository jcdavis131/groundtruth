// Build the v4 gold file from the publishers' own rows. Plain Node 22.18+ (it loads apps/map/lib/cite, which is
// TypeScript, through the resolve hook cite-check uses), no install, no network.
//
//   node eval/gold/build-gold.mjs --tasks TASKS.json --out GOLD.json [--pool pool.json]
//
// Prints only the sha256 of the gold file it wrote. The gold file is sealed material (PREREG-TEMPLATE rule 6): --out
// must be outside the git root, and an existing file is never overwritten. A sidecar GOLD.json.unrecorded.json lists
// every task that did not become a gold row, with the reason, so nothing is dropped silently.
//
// TASKS.json: {tasks: [{question, placeKind, type: "exact" | "number" | "list", queries: [Q, ...] | routeMissing: R}]}
//   Q = {sourceId, fact, code, period?, upstreamRecordUrl, retrievedAt, field, decimals?}: the publisher's record the answer
//       is read from. It is run through cite-check's plan/classify against the RECORDED publisher reply
//       (apps/map/lib/cite/__fixtures__/publisher), with no value of its own, and the publisher's value is read from the verdict.
//   R = {reason, url?}: the reason code of a route's own missing entry and the publisher page behind it.
// How a row becomes gold:
//   a matcher reads a value (CONFIRMED, CONTRADICTED or CHANGED_SINCE_RETRIEVAL with a publisher value)  -> PUBLISHED, gold = that value
//   a matcher reads the publisher's own suppression flag (NOT_PUBLISHED)                                -> NOT_PUBLISHED, flag = the publisher's words
//   a route's missing entry whose code is not_published, not_in_release or withheld (the abstain codes) -> NOT_PUBLISHED (B4 amendment)
//   anything else (no recorded reply, UNREACHABLE, REFUSED, "no such record", a retry/narrow/redirect code) -> listed, not gold
// "No such record" is not NOT_PUBLISHED: the publisher said nothing about suppression.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { itemId, marker, parseArgs, readPool, sha256 } from "../lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const die = (msg) => {
  process.stderr.write(`build-gold: ${msg}\n`);
  process.exit(2);
};

const args = parseArgs(process.argv.slice(2));
if (typeof args.tasks !== "string" || typeof args.out !== "string") die("usage: node eval/gold/build-gold.mjs --tasks TASKS.json --out GOLD.json [--pool pool.json]");

// --out must be outside the git root. Resolve symlinks and ".." on the nearest existing ancestor first.
const gitRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: here, encoding: "utf8" }).trim();
function realPathOf(p) {
  let rest = "";
  let cur = path.resolve(p);
  while (!existsSync(cur)) {
    rest = path.join(path.basename(cur), rest);
    const up = path.dirname(cur);
    if (up === cur) break;
    cur = up;
  }
  return path.join(realpathSync(cur), rest);
}
const norm = (p) => (process.platform === "win32" ? p.toLowerCase() : p);
const outReal = norm(realPathOf(args.out));
const rootReal = norm(realpathSync(gitRoot));
const rel = path.relative(rootReal, outReal);
if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) die(`--out is inside the git root (${gitRoot}); the gold file must stay outside any repo`);
if (existsSync(args.out)) die("--out already exists; a sealed gold file is never overwritten");

// cite-check and the route-code table, loaded as TypeScript. Nothing here touches the network.
const mapRoot = path.resolve(here, "..", "..", "apps", "map");
register(pathToFileURL(path.join(mapRoot, "scripts", "ts-resolve-hook.mjs")).href);
const load = (p) => import(pathToFileURL(path.join(mapRoot, p)).href);
const { plan, classify, MATCHERS } = await load("lib/cite/citeCheck.ts");
const { recordedFor, toReply } = await load("lib/cite/recorded.ts");
const { codeForRouteEntry, ABSENCE_CODES } = await load("lib/mcp/absence.ts");

const ABSTAIN = new Set(Object.entries(ABSENCE_CODES).filter(([, v]) => v.action === "abstain").map(([k]) => k));

let spec;
try {
  spec = JSON.parse(readFileSync(args.tasks, "utf8"));
} catch (e) {
  die(`cannot read --tasks: ${e.message}`);
}
if (!Array.isArray(spec.tasks) || spec.tasks.length === 0) die("--tasks has no tasks array");
const poolIds = typeof args.pool === "string" ? new Set(readPool(args.pool).map((p) => itemId(p.question))) : null;

const items = {};
const unrecorded = [];
const TYPES = new Set(["exact", "number", "list"]);

// One query -> {value, url, period, sha256, tolerance} or {skip: reason} or {flag, url, period, sha256}.
function readQuery(qy) {
  const item = { fact: qy.fact, value: null, code: qy.code, period: qy.period, sourceId: qy.sourceId, upstreamRecordUrl: qy.upstreamRecordUrl, retrievedAt: qy.retrievedAt };
  const p = plan(item);
  if ("refused" in p) return { skip: `refused by cite-check: ${p.refused}` };
  const rec = recordedFor(qy.sourceId, p.url);
  if (!rec) return { skip: `no recorded reply for ${p.url}` };
  const v = classify(item, toReply(rec));
  const base = { url: p.url, period: v.period, sha256: v.sha256 };
  if (v.status === "NOT_PUBLISHED") return { ...base, flag: v.reason };
  if (["CONFIRMED", "CONTRADICTED", "CHANGED_SINCE_RETRIEVAL"].includes(v.status) && v.publisherValue !== null) {
    const tol = qy.field ? MATCHERS[qy.sourceId]?.tolerance?.[qy.field] : undefined;
    return { ...base, value: v.publisherValue, tolerance: tol };
  }
  return { skip: `${v.status}: ${v.reason}` };
}

for (const t of spec.tasks) {
  if (typeof t.question !== "string" || typeof t.placeKind !== "string" || !TYPES.has(t.type)) die(`task needs question, placeKind and type exact|number|list: ${JSON.stringify(t).slice(0, 80)}`);
  const id = itemId(t.question);
  if (poolIds && !poolIds.has(id)) die(`task ${id} is not a question in --pool`);
  if (items[id] || unrecorded.some((u) => u.id === id)) die(`task ${id} appears twice`);
  const skip = (reason) => unrecorded.push({ id, question: t.question, reason });

  if (t.routeMissing) {
    const code = codeForRouteEntry({ reason: t.routeMissing.reason });
    if (!ABSTAIN.has(code)) skip(`route entry ${t.routeMissing.reason} is code ${code}, not an abstain code (not_published, not_in_release, withheld)`);
    else if (!/^https:\/\//.test(t.routeMissing.url ?? "")) skip(`route entry ${t.routeMissing.reason} (${code}) has no publisher URL`);
    else items[id] = { type: t.type, verdict: "NOT_PUBLISHED", gold: null, flag: `route missing entry ${t.routeMissing.reason} (code ${code})`, url: t.routeMissing.url, placeKind: t.placeKind };
    continue;
  }
  if (!Array.isArray(t.queries) || t.queries.length === 0) {
    skip("task has neither queries nor routeMissing");
    continue;
  }
  const got = t.queries.map(readQuery);
  const bad = got.find((g) => g.skip);
  if (bad) {
    skip(bad.skip);
    continue;
  }
  if (got.some((g) => g.flag !== undefined)) {
    if (got.length === 1) items[id] = { type: t.type, verdict: "NOT_PUBLISHED", gold: null, flag: got[0].flag, url: got[0].url, period: got[0].period, sha256: got[0].sha256, placeKind: t.placeKind };
    else skip("mixed: one of several queries is suppressed by the publisher");
    continue;
  }
  if (t.type === "list") {
    const gold = got.map((g, i) => (typeof g.value === "number" && t.queries[i].decimals !== undefined ? g.value.toFixed(t.queries[i].decimals) : String(g.value)));
    items[id] = { type: "list", verdict: "PUBLISHED", gold, url: got[0].url, sources: got.map((g) => ({ url: g.url, period: g.period, sha256: g.sha256 })), placeKind: t.placeKind };
  } else if (got.length !== 1) skip(`type ${t.type} takes one query, the task has ${got.length}`);
  else if (t.type === "number" && (typeof got[0].value !== "number" || got[0].tolerance === undefined)) skip("a number task needs a numeric publisher value and the matcher's declared tolerance for query.field");
  else {
    const g = got[0];
    items[id] = { type: t.type, verdict: "PUBLISHED", gold: g.value, ...(t.type === "number" ? { tolerance: g.tolerance } : {}), url: g.url, period: g.period, sha256: g.sha256, placeKind: t.placeKind };
  }
}

const sortedItems = Object.fromEntries(Object.entries(items).sort(([a], [b]) => (a < b ? -1 : 1)));
const text = JSON.stringify({ marker: marker("gold"), items: sortedItems }, null, 1) + "\n";
const side = JSON.stringify({ unrecorded: unrecorded.sort((a, b) => (a.id < b.id ? -1 : 1)) }, null, 1) + "\n";
writeFileSync(args.out, text, { flag: "wx" });
writeFileSync(args.out + ".unrecorded.json", side, { flag: "wx" });
process.stdout.write(sha256(text) + "\n");
