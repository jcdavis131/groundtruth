#!/usr/bin/env node
// The rules' mutation proof: one deliberate break per rule AGENTS.md says a test enforces, so we know
// each test bites. scripts/rule-mutations.sh applies each break, runs only the test files that break
// names, records killed (a test failed), survived (all passed) or not-applied (the anchor moved), and
// restores the file's exact bytes. CI runs it (.github/workflows/rule-mutations.yml) and records the
// table; scripts/rules-table.test.mjs reads this registry and the table.
//
// The same pattern as jev-mutate.mjs (the Ask Jev panel's proof), with three differences. The files live
// under three roots (apps/map, data, scripts), so paths are relative to the repo root and each mutant
// names the runner for its tests (vitest files relative to apps/map, or plain `node <file>` from the
// root). Restoring puts back the saved bytes and checks their sha256, instead of asking git. And the
// CLI runs only when this file is run directly, so a test can import MUTANTS.
//
// Each break is an exact string swap (no regex), so an anchor that no longer matches the code fails
// loudly instead of passing for free. Every `to` differs from its `from`.
//
//   node scripts/rule-mutate.mjs --list                  names, one per line
//   node scripts/rule-mutate.mjs --check                 registry sound and every anchor present exactly once? (exit 1 if not)
//   node scripts/rule-mutate.mjs --rule <name>           the rule a break tests
//   node scripts/rule-mutate.mjs --row <name>            the AGENTS.md row (the start of its Rule cell) it belongs to
//   node scripts/rule-mutate.mjs --vitest <name>         vitest files (relative to apps/map) that must kill it
//   node scripts/rule-mutate.mjs --node <name>           node test files (relative to the repo root) that must kill it
//   node scripts/rule-mutate.mjs --all-vitest | --all-node | --files    every such file, once
//   node scripts/rule-mutate.mjs --apply <name>          apply one break (exit 3 anchor not found exactly once, 4 file already mutated)
//   node scripts/rule-mutate.mjs --restore [<name>]      put the saved bytes back (all applied, without a name); exit 5 if the file was edited since
//   node scripts/rule-mutate.mjs --status                the breaks applied now
//   node scripts/rule-mutate.mjs --render <results.tsv> <out.md> <out.json>   the kill table
//
// Environment: RULE_MUT_ROOT (the repo root, for tests on a copy), RULE_MUT_STATE (where saved bytes go),
// RULE_MUT_SHA (the commit the table was made on), RULE_MUT_CHECKOUT (the commit actually checked out, when that
// is a merge of it).

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ROOT = path.resolve(HERE, "..", "..", "..");

/** The AGENTS.md rows with a Checked status, by the start of their Rule cell (scripts/rules-table.test.mjs matches on it). */
export const ROW = {
  cites: "Every record cites its source",
  missing: "Missing means missing. No placeholder",
  mcp: "The MCP server tells a fresh client",
  legend: "The field's legend is derived",
  joined: "Missing means missing, for a joined field",
  eval: "The v4 eval's sealed material",
  embed: "No search or embedding of private individuals",
  athletes: "Professional athletes only by Cam's 2026-10-18 exception",
  large: "Large data, caches and model weights",
  env: "No `.env` files, token-shaped strings",
  pins: "Workflow actions are pinned to a full commit sha",
};

const WORLD = "apps/map/lib/mcp/world.ts";
const HOSTS = "apps/map/lib/cite/hosts.ts";
const COVERAGE = "apps/map/lib/mcp/coverage.ts";
const EMERGENCE = "apps/map/lib/fabric/emergence.ts";
const LEGEND = "apps/map/lib/fabric/legend.ts";
const VALIDATE = "data/schema/validate.mjs";
const ATHLETES = "data/athletes/validate.mjs";
const ALLOWLIST = "data/athletes/allowlist.json";
const GUARD = "scripts/guard.mjs";

const WORLD_TEST = ["lib/mcp/world.test.ts"];
const FIELD_TESTS = ["lib/fabric/emergence.test.ts", "lib/fabric/layerCoverage.test.ts"];
const SCHEMA_TEST = ["data/schema/validate.test.mjs"];
const ATHLETE_TEST = ["data/athletes/validate.test.mjs"];
const GUARD_TEST = ["scripts/guard.test.mjs"];

/**
 * name      kebab-case, unique; rules-table.test.mjs matches AGENTS.md's "Mutants:" names against it
 * row       the AGENTS.md row (ROW) whose rule this break violates
 * rule      the rule, in a sentence
 * file      path from the repo root
 * from, to  an exact swap; `from` must occur exactly once in `file`
 * vitest    test files (relative to apps/map) run with `npx vitest run`; node: files (relative to the root) run with `node`
 */
export const MUTANTS = [
  // ---- a citation is the source's own; a missing source yields no value
  {
    name: "borrowed-citation",
    row: ROW.cites,
    rule: "an item is cited to its own source's provenance, never to the route's first source (the FEMA-to-USDM bug)",
    file: WORLD,
    from: "  return (pick ? byId.find(pick) : undefined) ?? byId[0] ?? null;",
    to: "  return (pick ? byId.find(pick) : undefined) ?? byId[0] ?? arr(body.provenance).map((p) => obj(p) as unknown as Prov)[0] ?? null;",
    vitest: WORLD_TEST,
    node: [],
  },
  {
    name: "missing-source-yields-value",
    row: ROW.missing,
    rule: "a source the route lists as missing yields no item, never a value",
    file: WORLD,
    from: "  if (gone) return { none: id, reason: `${id}: the route lists it as missing: ${gone.reason}`, code: gone.code };",
    to: "  if (gone && false) return { none: id, reason: `${id}: the route lists it as missing: ${gone.reason}`, code: gone.code };",
    vitest: WORLD_TEST,
    node: [],
  },
  {
    name: "withheld-null-becomes-0",
    row: ROW.missing,
    rule: "a value BLS withheld is null with its reason, never 0",
    file: WORLD,
    from: "else if (withheld) push(s, item(qcew, fact, null, {",
    to: "else if (withheld) push(s, item(qcew, fact, 0, {",
    vitest: WORLD_TEST,
    node: [],
  },
  {
    name: "cut-list-without-coverage-status",
    row: ROW.mcp,
    rule: "a list cut at max_records says so in coverageStatus",
    file: WORLD,
    from: ", ...sec.cut];",
    to: ", ...[]];",
    vitest: WORLD_TEST,
    node: [],
  },
  {
    name: "wrong-record-host",
    row: ROW.cites,
    rule: "a record URL sits on its own publisher's host",
    file: WORLD,
    from: "return code ? `https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer/6/query",
    to: "return code ? `https://hazards.fema.gov/arcgis/rest/services/wbd/MapServer/6/query",
    vitest: WORLD_TEST,
    node: [],
  },
  {
    name: "cite-host-unchecked",
    row: ROW.cites,
    rule: "cite-check refuses a record URL that is not on the source's own host, and fetches nothing",
    file: HOSTS,
    from: "  if (!host.test(url)) return `the record URL is not on ${item.sourceId}'s own host`;",
    to: "  if (false && !host.test(url)) return `the record URL is not on ${item.sourceId}'s own host`;",
    vitest: ["lib/cite/citeCheck.test.ts"],
    node: [],
  },
  {
    name: "coverage-null-with-nullplaces",
    row: ROW.mcp,
    rule: "a place export that lists places with an unknown value carries coverageStatus partial, not none",
    file: COVERAGE,
    from: "groupByCode(data.nullPlaces, (x) => x)",
    to: "groupByCode(undefined, (x) => x)",
    vitest: ["lib/mcp/server.test.ts", "lib/mcp/tools.test.ts"],
    node: [],
  },
  // ---- the construct field says "not loaded" instead of painting zero (#58)
  {
    name: "partial-becomes-complete",
    row: ROW.missing,
    rule: "a unit the counted layers loaded only in part (a record limit, a floor, a missing part) reads partial, never complete",
    file: EMERGENCE,
    from: ': missed || partial ? "partial" : "complete";',
    to: ': missed ? "partial" : "complete";',
    vitest: FIELD_TESTS,
    node: [],
  },
  {
    name: "density-zero-restored",
    row: ROW.missing,
    rule: "a unit with no known area gets no density, never 0 (the value line before #58 read `: 0`)",
    file: EMERGENCE,
    from: 'const value = coverage !== "complete" || noArea ? null : normalise === "density" ? (count / area!) * 1000 : count;',
    to: 'const value = coverage !== "complete" ? null : normalise === "density" ? (area ? (count / area) * 1000 : 0) : count;',
    vitest: FIELD_TESTS,
    node: [],
  },
  {
    name: "no-area-reads-complete",
    row: ROW.missing,
    rule: "a unit with no known area under density reads partial, not complete",
    file: EMERGENCE,
    from: '      coverage: noArea && coverage === "complete" ? "partial" : coverage,',
    to: "      coverage,",
    vitest: FIELD_TESTS,
    node: [],
  },
  {
    name: "heat-rescales-on-partial-unit",
    row: ROW.missing,
    rule: "heat is scaled over complete units only: a partly loaded unit never moves another unit's heat",
    file: EMERGENCE,
    from: "const max = Math.max(0, ...sorted.map(([, v]) => v.value ?? 0));",
    to: "const max = Math.max(0, ...sorted.map(([, v]) => v.value ?? v.total));",
    vitest: FIELD_TESTS,
    node: [],
  },
  {
    name: "legend-max-from-partial-unit",
    row: ROW.legend,
    rule: "the legend's maximum never comes from a partly loaded unit",
    file: LEGEND,
    from: 'if (streamflow || v.coverage !== "complete" || v.value <= 0) continue;',
    to: "if (streamflow || v.value <= 0) continue;",
    vitest: ["lib/fabric/legend.test.ts"],
    node: [],
  },
  // ---- data: placeholders, codes that agree, joins, embedding
  {
    name: "placeholder-n-a-dropped",
    row: ROW.missing,
    rule: "n/a is a filler, not a value: a record carrying it fails with placeholder",
    file: VALIDATE,
    from: '"nan", "n/a", "tbd", "todo", "placeholder", "lorem ipsum", "-", "--", "?", "xxx", "missing"]);',
    to: '"nan", "tbd", "todo", "placeholder", "lorem ipsum", "-", "--", "?", "xxx", "missing"]);',
    vitest: [],
    node: SCHEMA_TEST,
  },
  {
    name: "county-in-state-dropped",
    row: ROW.joined,
    rule: "a record's county FIPS starts with its state FIPS, or it fails with county",
    file: VALIDATE,
    from: 'if (typeof p.countyFips === "string" && !p.countyFips.startsWith(p.stateFips))',
    to: 'if (false && typeof p.countyFips === "string" && !p.countyFips.startsWith(p.stateFips))',
    vitest: [],
    node: SCHEMA_TEST,
  },
  {
    name: "joins-count-dropped",
    row: ROW.joined,
    rule: "placed plus unplaced equals recordCount: every record is placed or says why not",
    file: VALIDATE,
    from: "if (j.placed + j.unplaced.length !== m.recordCount)",
    to: "if (false && j.placed + j.unplaced.length !== m.recordCount)",
    vitest: [],
    node: SCHEMA_TEST,
  },
  {
    name: "embeddable-drift-dropped",
    row: ROW.embed,
    rule: "a manifest's embeddableFields and embeddableName are checked against eye's rules for drift",
    file: VALIDATE,
    from: "  out.push(...embeddableProblems(m));",
    to: "  out.push(...[]);",
    vitest: [],
    node: SCHEMA_TEST,
  },
  // ---- athletes: the never-list
  {
    name: "denied-key-check-skipped",
    row: ROW.athletes,
    rule: "an athlete record never carries a never-list key: it fails with denied",
    file: ATHLETES,
    from: "    if (Object.hasOwn(allowed, k)) continue;",
    to: "    if (Object.hasOwn(allowed, k) || deniedPart(k)) continue;",
    vitest: [],
    node: ATHLETE_TEST,
  },
  {
    name: "denied-athlete-field-allowed",
    row: ROW.athletes,
    rule: "the athlete allowlist holds no never-list field (a birth date is never allowed)",
    file: ALLOWLIST,
    from: '    "birthCountry": { "required": false, "what": "birthplace: the country\'s name" },',
    to: '    "birthCountry": { "required": false, "what": "birthplace: the country\'s name" },\n    "birthDate": { "required": false, "what": "the player\'s birth date" },',
    vitest: [],
    node: ATHLETE_TEST,
  },
  // ---- scripts/guard.mjs, applied in a scratch checkout only; this PR does not change that file
  {
    name: "guard-size-limit-lifted",
    row: ROW.large,
    rule: "a tracked file over 5 MB fails the guard",
    file: GUARD,
    from: "const MAX_BYTES = 5 * 1024 * 1024;",
    to: "const MAX_BYTES = 5 * 1024 * 1024 * 1024;",
    vitest: [],
    node: GUARD_TEST,
  },
  {
    name: "guard-secret-pattern-dropped",
    row: ROW.env,
    rule: "a token-shaped string (an AWS key here) fails the guard",
    file: GUARD,
    from: '["aws key", /\\b(?:AKIA|ASIA)[0-9A-Z]{16}\\b/],',
    to: '["aws key", /(?!)/],',
    vitest: [],
    node: GUARD_TEST,
  },
  {
    name: "guard-pin-check-dropped",
    row: ROW.pins,
    rule: "a workflow action not pinned to a full commit sha fails the guard",
    file: GUARD,
    from: 'if (m && !m[1].startsWith("./") && !SHA_PIN.test(m[1])) out.push([i + 1, m[1]]);',
    to: 'if (false && m && !m[1].startsWith("./") && !SHA_PIN.test(m[1])) out.push([i + 1, m[1]]);',
    vitest: [],
    node: GUARD_TEST,
  },
  {
    name: "guard-eval-leak-dropped",
    row: ROW.eval,
    rule: "a tracked file named like the v4 eval's sealed material, or carrying its header marker, fails the guard",
    file: GUARD,
    from: "if (evalLeakName(base) || EVAL_MARKER.test(scan)) findings.push(`eval-leak ${f}`);",
    to: "if (false && (evalLeakName(base) || EVAL_MARKER.test(scan))) findings.push(`eval-leak ${f}`);",
    vitest: [],
    node: GUARD_TEST,
  },
];

// ---------------------------------------------------------------------------- bytes

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/** How many times `needle` occurs in `hay` (both Buffers), overlaps counted. */
function count(hay, needle) {
  let n = 0;
  for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + 1)) n++;
  return n;
}

/** How many times a mutant's anchor occurs in its file under `root`. */
export function anchorCount(root, m) {
  return count(fs.readFileSync(path.join(root, m.file)), Buffer.from(m.from));
}

const byName = (name) => MUTANTS.find((m) => m.name === name);

/** Everything wrong with the registry and, under `root`, with its anchors and test files. Empty when sound. */
export function registryProblems(root = DEFAULT_ROOT) {
  const out = [];
  const names = MUTANTS.map((m) => m.name);
  for (const n of names) if (names.indexOf(n) !== names.lastIndexOf(n)) out.push(`${n}: duplicate name`);
  for (const m of MUTANTS) {
    const at = m.name;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(m.name)) out.push(`${at}: name is not kebab-case`);
    for (const k of ["row", "rule", "file", "from", "to"]) if (typeof m[k] !== "string" || m[k] === "") out.push(`${at}: ${k} is empty`);
    if (!Object.values(ROW).includes(m.row)) out.push(`${at}: row is not one of ROW`);
    if (m.from === m.to) out.push(`${at}: to equals from`);
    if (path.isAbsolute(m.file) || m.file.split("/").includes("..") || m.file.includes("\\")) out.push(`${at}: file is not a plain relative path`);
    if (!Array.isArray(m.vitest) || !Array.isArray(m.node) || m.vitest.length + m.node.length === 0) out.push(`${at}: names no test file`);
    for (const f of m.vitest ?? []) if (!fs.existsSync(path.join(root, "apps/map", f))) out.push(`${at}: vitest file apps/map/${f} does not exist`);
    for (const f of m.node ?? []) if (!fs.existsSync(path.join(root, f))) out.push(`${at}: node file ${f} does not exist`);
    if (!fs.existsSync(path.join(root, m.file))) {
      out.push(`${at}: ${m.file} does not exist`);
      continue;
    }
    const n = anchorCount(root, m);
    if (n !== 1) out.push(`${at}: anchor found ${n} times in ${m.file}`);
  }
  return out;
}

// ---------------------------------------------------------------------------- apply and restore

function stateDirOf(root, env = process.env) {
  return path.resolve(env.RULE_MUT_STATE ?? path.join(os.tmpdir(), `rule-mutate-${sha256(Buffer.from(root)).slice(0, 10)}`));
}

function readState(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "applied.json"), "utf8"));
  } catch {
    return {};
  }
}

function writeState(dir, state) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "applied.json"), JSON.stringify(state, null, 1) + "\n");
}

/**
 * Apply one break: save the file's bytes and sha256, swap the anchor. Returns {code, message}:
 * 0 applied; 2 no such mutant; 3 anchor not found exactly once; 4 the file already has a break applied.
 */
export function applyMutant(name, { root = DEFAULT_ROOT, state = stateDirOf(root) } = {}) {
  const m = byName(name);
  if (!m) return { code: 2, message: `no mutant ${name}` };
  const applied = readState(state);
  const clash = Object.entries(applied).find(([, s]) => s.file === m.file);
  if (clash) return { code: 4, message: `${m.file} already has ${clash[0]} applied; restore it first` };
  const full = path.join(root, m.file);
  const before = fs.readFileSync(full);
  if (count(before, Buffer.from(m.from)) !== 1) return { code: 3, message: `${m.name}: anchor not found exactly once in ${m.file}` };
  const at = before.indexOf(Buffer.from(m.from));
  const after = Buffer.concat([before.subarray(0, at), Buffer.from(m.to), before.subarray(at + Buffer.byteLength(m.from))]);
  fs.mkdirSync(state, { recursive: true });
  fs.writeFileSync(path.join(state, `${m.name}.orig`), before);
  fs.writeFileSync(full, after);
  applied[m.name] = { file: m.file, sha256Before: sha256(before), sha256After: sha256(after) };
  writeState(state, applied);
  return { code: 0, message: `${m.name}: ${m.file}` };
}

/**
 * Put the saved bytes back, for one break or (no name) every applied one. Returns {code, message}:
 * 0 restored; 2 that break is not applied; 5 the saved bytes are damaged or the file was edited since the apply
 * (nothing is overwritten then).
 */
export function restoreMutant(name, { root = DEFAULT_ROOT, state = stateDirOf(root) } = {}) {
  const applied = readState(state);
  const names = name === undefined ? Object.keys(applied) : [name];
  const lines = [];
  let code = 0;
  for (const n of names) {
    const s = applied[n];
    if (!s) {
      lines.push(`${n} is not applied`);
      code = Math.max(code, 2);
      continue;
    }
    const full = path.join(root, s.file);
    const orig = fs.readFileSync(path.join(state, `${n}.orig`));
    if (sha256(orig) !== s.sha256Before) {
      lines.push(`${n}: the saved bytes of ${s.file} do not hash to what was saved; not restored`);
      code = 5;
      continue;
    }
    if (!fs.existsSync(full) || sha256(fs.readFileSync(full)) !== s.sha256After) {
      lines.push(`${n}: ${s.file} was edited after the break was applied; not restored`);
      code = 5;
      continue;
    }
    fs.writeFileSync(full, orig);
    if (sha256(fs.readFileSync(full)) !== s.sha256Before) {
      lines.push(`${n}: ${s.file} does not hash to the saved sha256 after the restore`);
      code = 5;
      continue;
    }
    delete applied[n];
    fs.rmSync(path.join(state, `${n}.orig`), { force: true });
    writeState(state, applied);
    lines.push(`restored ${n} ${s.file} sha256 ${s.sha256Before}`);
  }
  return { code, message: lines.join("\n") };
}

// ---------------------------------------------------------------------------- the kill table

const RESULTS = ["killed", "survived", "not-applied"];

/** Parse results.tsv lines `name<TAB>result<TAB>first failing test` into rows, in registry order. */
export function parseResults(tsv) {
  const got = new Map();
  for (const line of tsv.split("\n")) {
    if (!line.trim()) continue;
    const [name, result, ...rest] = line.split("\t");
    if (!byName(name)) throw new Error(`results name an unknown mutant: ${name}`);
    if (!RESULTS.includes(result)) throw new Error(`${name}: result ${JSON.stringify(result)} is not one of ${RESULTS.join(", ")}`);
    got.set(name, { name, result, firstFailingTest: rest.join("\t") || null });
  }
  return MUTANTS.map((m) => got.get(m.name) ?? { name: m.name, result: "not-applied", firstFailingTest: "never run" });
}

/** The kill table as Markdown and as JSON (rules-table.test.mjs --table reads the JSON). */
export function renderTable(rows, sha = null, checkout = null) {
  const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
  const n = (r) => rows.filter((x) => x.result === r).length;
  const counts = { killed: n("killed"), survived: n("survived"), notApplied: n("not-applied"), total: rows.length };
  const lines = [
    "## Rule mutation proof",
    "",
    `Commit: \`${sha ?? "unknown"}\`${checkout && checkout !== sha ? ` (the job checked out \`${checkout}\`, that commit merged with its base)` : ""}. Each break is run against only the test files it names (vitest from apps/map, or node from the repo root).`,
    "",
    "| # | Mutant | AGENTS.md row | Rule | Result | First failing test |",
    "|---|---|---|---|---|---|",
    ...rows.map((r, i) => {
      const m = byName(r.name);
      const shown = r.result === "killed" ? "killed" : `**${r.result.toUpperCase()}**`;
      return `| ${i + 1} | \`${r.name}\` | ${cell(m.row)} | ${cell(m.rule)} | ${shown} | ${cell(r.firstFailingTest)} |`;
    }),
    "",
    `**${counts.killed} killed, ${counts.survived} survived, ${counts.notApplied} not applied, of ${counts.total}.**`,
    "",
  ];
  const json = {
    schema: "rule-mutations/1",
    sha,
    counts,
    mutants: rows.map((r) => ({ name: r.name, row: byName(r.name).row, result: r.result, firstFailingTest: r.firstFailingTest })),
  };
  return { md: lines.join("\n"), json: JSON.stringify(json, null, 1) + "\n", counts };
}

// ---------------------------------------------------------------------------- CLI

function main(argv) {
  const root = path.resolve(process.env.RULE_MUT_ROOT ?? DEFAULT_ROOT);
  const [arg, a, b, c] = argv;
  const need = (name) => {
    const m = byName(name);
    if (!m) {
      console.error(`no mutant ${name}`);
      process.exit(2);
    }
    return m;
  };
  const uniq = (xs) => [...new Set(xs)].sort();
  switch (arg) {
    case "--list":
      console.log(MUTANTS.map((m) => m.name).join("\n"));
      return 0;
    case "--check": {
      const bad = registryProblems(root);
      for (const p of bad) console.error(p);
      console.log(`${MUTANTS.length} mutants, ${bad.length} problems`);
      return bad.length ? 1 : 0;
    }
    case "--rule":
      console.log(need(a).rule);
      return 0;
    case "--row":
      console.log(need(a).row);
      return 0;
    case "--vitest":
      console.log(need(a).vitest.join(" "));
      return 0;
    case "--node":
      console.log(need(a).node.join(" "));
      return 0;
    case "--all-vitest":
      console.log(uniq(MUTANTS.flatMap((m) => m.vitest)).join(" "));
      return 0;
    case "--all-node":
      console.log(uniq(MUTANTS.flatMap((m) => m.node)).join(" "));
      return 0;
    case "--files":
      console.log(uniq(MUTANTS.map((m) => m.file)).join(" "));
      return 0;
    case "--apply": {
      const r = applyMutant(a, { root });
      (r.code ? console.error : console.log)(r.message);
      return r.code;
    }
    case "--restore": {
      const r = restoreMutant(a, { root });
      if (r.message) (r.code ? console.error : console.log)(r.message);
      return r.code;
    }
    case "--status": {
      const applied = readState(stateDirOf(root));
      console.log(Object.keys(applied).join("\n"));
      return 0;
    }
    case "--render": {
      if (!a || !b || !c) {
        console.error("usage: node scripts/rule-mutate.mjs --render <results.tsv> <out.md> <out.json>");
        return 2;
      }
      const t = renderTable(parseResults(fs.readFileSync(a, "utf8")), process.env.RULE_MUT_SHA || null, process.env.RULE_MUT_CHECKOUT || null);
      fs.writeFileSync(b, t.md);
      fs.writeFileSync(c, t.json);
      console.log(t.md);
      return t.counts.survived || t.counts.notApplied ? 1 : 0;
    }
    default:
      console.error("usage: node scripts/rule-mutate.mjs --list | --check | --rule <n> | --row <n> | --vitest <n> | --node <n> | --all-vitest | --all-node | --files | --apply <n> | --restore [<n>] | --status | --render <tsv> <md> <json>");
      return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = main(process.argv.slice(2));
