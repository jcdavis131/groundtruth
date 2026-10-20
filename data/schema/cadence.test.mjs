// Tests for the cadence table (data/cadence.json) and its checks in data/schema/validate.mjs. Plain Node, no install.
//   node data/schema/cadence.test.mjs
// data/schema/validate.test.mjs runs this file, so the data.yml "schema and fixture tests" step does too.
//
// The table says, per collection, how often the publisher itself says it releases, with the publisher's page and
// the sentence. A number needs a stated cadence word that one of the quotes carries; where the publisher states
// none the row is null with a reason. Nothing here fetches a page: the quotes are checked against the stated word,
// and the table is checked against the committed manifests.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "..");
const VALIDATE = path.join(HERE, "validate.mjs");
const MANIFESTS = path.join(ROOT, "data", "manifests");
const CADENCE = path.join(ROOT, "data", "cadence.json");

let passed = 0;
let failed = 0;
const check = (ok, msg, detail = "") => {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  cadence: ${msg}${!ok && detail ? `\n      ${detail}` : ""}`);
};
/** Runs fn; it returns true, or a string saying what was wrong. A throw is a failure with the message as detail. */
const attempt = (msg, fn) => {
  try {
    const r = fn();
    check(r === true, msg, typeof r === "string" ? r : "");
  } catch (e) {
    check(false, msg, String(e?.message ?? e));
  }
};

const V = await import("./validate.mjs");
const call = (name, ...args) => {
  if (typeof V[name] !== "function") throw new Error(`validate.mjs does not export ${name}`);
  return V[name](...args);
};
const show = (errs) => errs.map((e) => `${e.code} ${e.path} ${e.message}`).join("; ") || "no problems";
const probs = (table, collections) => call("cadenceProblems", table, collections);
const hasProblem = (errs, re) => errs.some((e) => re.test(`${e.code} ${e.path} ${e.message}`));

// ---------------------------------------------------------------- fixtures (made-up names; nothing here is fetched)
const numbered = (over = {}) => ({
  collection: "alpha-things",
  publisher: "Alpha Agency",
  statedCadence: "weekly",
  expectedDays: 7,
  sources: [{ url: "https://example.org/alpha/about", quote: "Alpha data are published weekly.", readAt: "2026-10-20" }],
  ...over,
});
const unstated = (over = {}) => ({
  collection: "beta-things",
  publisher: "Beta Agency",
  expectedDays: null,
  reason: "publisher-cadence-unstated",
  sources: [{ url: "https://example.org/beta/data", quote: "A schedule of updates will be posted in the near future.", readAt: "2026-10-20" }],
  ...over,
});
const table = (...rows) => ({ schemaVersion: "cadence/1", collections: rows });
const without = (o, k) => {
  const c = { ...o };
  delete c[k];
  return c;
};

// ---------------------------------------------------------------- the rules, one fixture each
attempt("validate.mjs exports cadenceProblems and a closed table of cadence words", () =>
  typeof V.cadenceProblems === "function" && V.CADENCE_DAYS && V.CADENCE_DAYS.weekly === 7 && V.CADENCE_DAYS.daily === 1 && V.CADENCE_DAYS.annual === 365 ? true : "missing export or wrong table");
attempt("a faithful table (one number with its quote, one null with its reason) passes", () => {
  const errs = probs(table(numbered(), unstated()), ["alpha-things", "beta-things"]);
  return errs.length === 0 ? true : show(errs);
});
attempt("a manifest collection with no row fails, naming the collection", () => {
  const errs = probs(table(numbered()), ["alpha-things", "beta-things"]);
  return hasProblem(errs, /cadence.*beta-things.*no row/) ? true : show(errs);
});
attempt("a row for a collection with no committed manifest fails", () => {
  const errs = probs(table(numbered(), unstated()), ["alpha-things"]);
  return hasProblem(errs, /cadence.*beta-things.*no committed manifest/) ? true : show(errs);
});
attempt("a collection listed twice fails", () => {
  const errs = probs(table(numbered(), numbered()), ["alpha-things"]);
  return hasProblem(errs, /cadence.*alpha-things.*twice/) ? true : show(errs);
});
attempt("expectedDays that disagrees with the stated cadence word fails", () => {
  const errs = probs(table(numbered({ expectedDays: 30 })), ["alpha-things"]);
  return hasProblem(errs, /cadence.*weekly.*7/) ? true : show(errs);
});
attempt("a number whose quotes never carry the stated cadence word fails", () => {
  const errs = probs(table(numbered({ sources: [{ url: "https://example.org/alpha/about", quote: "Alpha data are published regularly by the agency.", readAt: "2026-10-20" }] })), ["alpha-things"]);
  return hasProblem(errs, /cadence.*weekly/) ? true : show(errs);
});
attempt("a cadence word outside the closed table fails", () => {
  const errs = probs(table(numbered({ statedCadence: "fortnightly", expectedDays: 14 })), ["alpha-things"]);
  return errs.length > 0 ? true : "a fortnightly row passed";
});
attempt("zero or a negative interval fails", () => {
  const a = probs(table(numbered({ expectedDays: 0 })), ["alpha-things"]);
  const b = probs(table(numbered({ expectedDays: -7 })), ["alpha-things"]);
  return a.length > 0 && b.length > 0 ? true : `zero: ${show(a)}; negative: ${show(b)}`;
});
attempt("a null row without a reason fails", () => {
  const errs = probs(table(without(unstated(), "reason")), ["beta-things"]);
  return errs.length > 0 ? true : "a null row with no reason passed";
});
attempt("a reason outside the closed list fails", () => {
  const errs = probs(table(unstated({ reason: "we-guessed" })), ["beta-things"]);
  return errs.length > 0 ? true : "an unknown reason passed";
});
attempt("a null row may not carry a stated cadence word", () => {
  const errs = probs(table(unstated({ statedCadence: "weekly" })), ["beta-things"]);
  return hasProblem(errs, /cadence/) ? true : show(errs);
});
attempt("a numbered row may not carry a null reason", () => {
  const errs = probs(table(numbered({ reason: "publisher-cadence-unstated" })), ["alpha-things"]);
  return hasProblem(errs, /cadence/) ? true : show(errs);
});
attempt("a numbered row needs the stated cadence word", () => {
  const errs = probs(table(without(numbered(), "statedCadence")), ["alpha-things"]);
  return errs.length > 0 ? true : "a number with no stated cadence passed";
});
attempt("a row that cites no source fails", () => {
  const errs = probs(table(unstated({ sources: [] })), ["beta-things"]);
  return errs.length > 0 ? true : "a row with no source passed";
});
attempt("a source with no url, or an http url, or no quote fails", () => {
  const src = (over) => [{ url: "https://example.org/beta/data", quote: "A schedule of updates will be posted in the near future.", readAt: "2026-10-20", ...over }];
  const noUrl = probs(table(unstated({ sources: [without(src({})[0], "url")] })), ["beta-things"]);
  const http = probs(table(unstated({ sources: src({ url: "http://example.org/beta/data" }) })), ["beta-things"]);
  const noQuote = probs(table(unstated({ sources: [without(src({})[0], "quote")] })), ["beta-things"]);
  return noUrl.length > 0 && http.length > 0 && noQuote.length > 0 ? true : `no url: ${noUrl.length}, http: ${http.length}, no quote: ${noQuote.length}`;
});
attempt("a readAt that is not a calendar day fails", () => {
  const errs = probs(table(unstated({ sources: [{ url: "https://example.org/beta/data", quote: "A schedule of updates will be posted in the near future.", readAt: "2026-02-31" }] })), ["beta-things"]);
  return hasProblem(errs, /cadence.*readAt|readAt/) ? true : show(errs);
});
attempt("a field the schema does not name fails (no side channel for a guessed number)", () => {
  const errs = probs(table(unstated({ guessedDays: 30 })), ["beta-things"]);
  return errs.length > 0 ? true : "an extra field passed";
});

// ---------------------------------------------------------------- the committed table
const manifestCollections = () =>
  [...new Set(readdirSync(MANIFESTS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name))].sort();
attempt("cadence.schema.json declares JSON Schema 2020-12", () => {
  const s = JSON.parse(readFileSync(path.join(HERE, "cadence.schema.json"), "utf8"));
  return s.$schema === "https://json-schema.org/draft/2020-12/schema" ? true : `declares ${s.$schema}`;
});
attempt("data/cadence.json passes against the committed manifests' collections", () => {
  const t = JSON.parse(readFileSync(CADENCE, "utf8"));
  const errs = probs(t, manifestCollections());
  return errs.length === 0 ? true : show(errs);
});
attempt("every committed collection has exactly one row, and every row cites an https page with a quote", () => {
  const t = JSON.parse(readFileSync(CADENCE, "utf8"));
  const rows = t.collections;
  for (const c of manifestCollections()) {
    const mine = rows.filter((r) => r.collection === c);
    if (mine.length !== 1) return `${c} has ${mine.length} rows`;
    if (!mine[0].sources.every((s) => /^https:\/\/\S+$/.test(s.url) && s.quote.length >= 10)) return `${c} has a source without an https url or a quote`;
  }
  return true;
});
attempt("no committed row carries a number without a stated cadence word and a quote that says it", () => {
  const t = JSON.parse(readFileSync(CADENCE, "utf8"));
  for (const r of t.collections.filter((x) => x.expectedDays !== null)) {
    if (V.CADENCE_DAYS?.[r.statedCadence] !== r.expectedDays) return `${r.collection}: ${r.expectedDays} days is not the table's value for ${r.statedCadence}`;
    if (!r.sources.some((s) => new RegExp(V.CADENCE_STEMS[r.statedCadence], "i").test(s.quote))) return `${r.collection}: no quote carries "${r.statedCadence}"`;
  }
  return true;
});

// ---------------------------------------------------------------- the CLI
const run = (...args) => spawnSync(process.execPath, [VALIDATE, "cadence", ...args], { encoding: "utf8" });
attempt("validate.mjs cadence exits 0 on the committed table", () => {
  const r = run();
  return r.status === 0 && /ok /.test(r.stdout) ? true : `exit ${r.status}: ${r.stdout}${r.stderr}`.slice(0, 600);
});
attempt("validate.mjs cadence exits 1 and names the collection when a row is missing", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "gt-cadence-"));
  const t = JSON.parse(readFileSync(CADENCE, "utf8"));
  const dropped = t.collections[0].collection;
  t.collections = t.collections.slice(1);
  const f = path.join(dir, "cadence.json");
  writeFileSync(f, JSON.stringify(t, null, 2) + "\n");
  const r = run("--cadence", f);
  return r.status === 1 && r.stdout.includes("FAIL") && r.stdout.includes(dropped) ? true : `exit ${r.status}: ${r.stdout}${r.stderr}`.slice(0, 600);
});

console.log(`\ncadence: ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
