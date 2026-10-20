// Record-existence agreement for a reconciled-plan file: fetch each in-table upstream_publisher link once, live, and
// compare "a record came back" with the reconciler's upstreamConfirmed. Prints one row per URL and one per fact.
//
//   node scripts/cite-grades.mjs <grades.json> [--json]
//
// 25 s timeout, one request a second per host (hosts in parallel), the per-host accepted User-Agent. Keyless, public hosts only
// (lib/cite/hosts.ts); a link outside the table is never fetched. Needs Node 22.18+ and apps/map's node_modules (see cite-load.mjs).
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { root, loadCite } from "./cite-load.mjs";

const file = process.argv[2];
if (!file || file.startsWith("--")) {
  console.error("usage: node scripts/cite-grades.mjs <grades.json> [--json]");
  process.exit(2);
}
const load = (rel) => import(pathToFileURL(path.join(root, rel)).href);
const { inTableFacts, byUrl, compare } = await load("lib/cite/grades.ts");
const cite = await loadCite();
const deps = { fetchImpl: fetch, clock: cite.realClock, gate: cite.createGate(cite.realClock), timeoutMs: 25_000 };

const facts = inTableFacts(JSON.parse(readFileSync(file, "utf8")));
const rows = byUrl(facts);
const byHost = new Map();
for (const r of rows) byHost.set(new URL(r.url).host, [...(byHost.get(new URL(r.url).host) ?? []), r.url]);
const replies = new Map();
await Promise.all([...byHost.values()].map(async (list) => { for (const u of list) replies.set(u, await cite.fetchPublisher(u, deps)); }));

const outcomes = compare(rows, replies);
const tally = { agree: 0, disagree: 0, unreachable: 0 };
for (const o of outcomes) tally[o.outcome]++;
console.log(`# ${facts.length} in-table facts, ${rows.length} unique URLs, ${[...replies.values()].filter((r) => r.status === 200).length} answered 200`);
console.log(`# facts: agree ${tally.agree}, disagree ${tally.disagree}, unreachable ${tally.unreachable}`);
console.log("\nURL\tsourceId\tstatus\tbody_sha256\tfacts(plan:upstreamConfirmed:outcome)");
for (const r of rows) {
  const rep = replies.get(r.url);
  const st = rep.status === 0 ? `error: ${rep.error ?? ""}` : rep.status === 200 && /^\s*\{\s*"error"\s*:/.test(rep.body) ? "200 carrying an error object" : String(rep.status);
  const os = r.facts.map((f) => `${f.plan}:${f.upstreamConfirmed}:${outcomes.find((o) => o.fact === f).outcome}`).join(" ");
  console.log([r.url, r.sourceId, st, rep.sha256 ?? "", os].join("\t"));
}
console.log("\nplan\tsourceId\treconciler\toutcome\tfact\tlink");
for (const o of outcomes.filter((x) => x.outcome !== "agree")) {
  console.log([o.fact.plan, o.fact.sourceId, o.fact.upstreamConfirmed ? "confirmed" : o.fact.wrong ? "wrong" : "unsupported", o.outcome, o.fact.fact.slice(0, 140), o.fact.link].join("\t"));
}
if (process.argv.includes("--json")) console.log(JSON.stringify(outcomes.map((o) => ({ plan: o.fact.plan, link: o.fact.link, outcome: o.outcome, status: replies.get(o.fact.link).status, sha256: replies.get(o.fact.link).sha256 ?? null }))));
