// Self-test for scripts/flows-shape-check.mjs: fixture pairs through the pure
// compare(), then the command line against a throwaway git repo so `git show`
// and the exit codes are exercised too. Plain Node, no install, no network.
//   node apps/map/scripts/flows-shape-check.test.mjs
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DATA_DIR, FILES, compare } from "./flows-shape-check.mjs";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "flows-shape-check.mjs");

let failed = 0;
const check = (ok, msg) => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${msg}`);
};

// Fixtures: a 2 x 3 grid. Wind has no land; currents have two land cells (null).
const BASE_ASOF = "2026-10-18T20:15:00Z";
const HEAD_ASOF = "2026-10-19T02:15:00Z";
const NOW = Date.parse("2026-10-19T03:00:00Z");

function wind(asof, over = {}) {
  return {
    asof,
    source: "Open-Meteo (GFS 10 m wind)",
    grid: { lat0: -85, lon0: -180, dlat: 5, dlon: 5, nlat: 2, nlon: 3 },
    u: [1.5, -2.25, 0, 3.1, -0.4, 7.7],
    v: [-1, 2, 0.5, -3.3, 4.4, 0],
    ...over,
  };
}
function currents(asof, over = {}) {
  return {
    asof,
    source: "Open-Meteo Marine (ocean currents + SST)",
    grid: { lat0: -80, lon0: -180, dlat: 4, dlon: 4, nlat: 2, nlon: 3 },
    u: [0.12, null, -0.3, 0.05, null, 1.1],
    v: [-0.2, null, 0.4, -0.01, null, 0.9],
    sst: [27.1, null, 18.4, -1.2, null, 30.0],
    ...over,
  };
}

const rules = (r) => r.reasons.map((s) => s.split(":")[0]);
const expectPass = (name, base, head, msg) => {
  const r = compare(name, base, head, { now: NOW });
  check(r.ok && r.reasons.length === 0, `${msg}: ${r.ok ? r.summary : r.reasons.join("; ")}`);
};
const expectFail = (name, base, head, rule, msg) => {
  const r = compare(name, base, head, { now: NOW });
  const named = rules(r);
  check(!r.ok && named.includes(rule), `${msg} -> ${rule}: ${r.reasons.join("; ") || "(passed)"}`);
};

// Passes: same shape, newer values and as-of.
expectPass("wind.json", wind(BASE_ASOF), wind(HEAD_ASOF, { u: [2, -1, 0.3, 4, -0.1, 6], v: [0, 1, 1, -2, 3, 0.2] }), "wind refresh");
expectPass(
  "currents.json",
  currents(BASE_ASOF),
  currents(HEAD_ASOF, { u: [0.2, null, -0.1, 0.07, null, 1.3], sst: [27.3, null, 18.1, -1.5, null, 30.4] }),
  "currents refresh",
);
expectPass("wind.json", wind(BASE_ASOF), wind("2026-10-19T03:45:00Z"), "as-of inside the hour of slack");

// Fails, each with its named rule.
{
  const h = wind(HEAD_ASOF);
  delete h.v;
  expectFail("wind.json", wind(BASE_ASOF), h, "keys", "dropped key v");
}
expectFail("wind.json", wind(BASE_ASOF), wind(HEAD_ASOF, { w: [0, 0, 0, 0, 0, 0] }), "keys", "added key w");
expectFail("wind.json", wind(BASE_ASOF), wind(HEAD_ASOF, { grid: { lat0: -85, lon0: -180, dlat: 5, dlon: 5, nlat: 3, nlon: 2 } }), "grid", "changed grid");
expectFail("wind.json", wind(BASE_ASOF), wind(HEAD_ASOF, { grid: { lat0: -85, lon0: -180, dlat: 5, dlon: 5, nlat: 2, nlon: 3, extra: 1 } }), "grid", "grid gains a field");
expectFail("wind.json", wind(BASE_ASOF), wind(HEAD_ASOF, { u: [1, 2, 3, 4, 5] }), "length", "u one short");
expectFail("currents.json", currents(BASE_ASOF), currents(HEAD_ASOF, { sst: [1, 2, 3, 4, 5, 6, 7] }), "length", "sst one long");
expectFail("currents.json", currents(BASE_ASOF), currents(HEAD_ASOF, { u: [0.12, 0, -0.3, 0.05, 0, 1.1] }), "nulls", "land filled with 0");
expectFail("currents.json", currents(BASE_ASOF), currents(HEAD_ASOF, { sst: [27.1, null, null, -1.2, null, 30] }), "nulls", "an ocean cell went null");
expectFail("currents.json", currents(BASE_ASOF), currents(HEAD_ASOF, { u: [null, 0.1, -0.3, 0.05, null, 1.1] }), "mask", "same count, land moved");
expectFail("wind.json", wind(BASE_ASOF), wind("2026-10-18T14:00:00Z"), "asof", "older as-of");
expectFail("wind.json", wind(BASE_ASOF), wind(BASE_ASOF, { u: [2, 2, 2, 2, 2, 2] }), "asof", "same as-of");
expectFail("wind.json", wind(BASE_ASOF), wind("2026-10-19T05:00:00Z"), "asof", "as-of two hours ahead of now");
expectFail("wind.json", wind(BASE_ASOF), wind("not a date"), "asof", "as-of unparseable");
expectFail("wind.json", wind(BASE_ASOF), wind(HEAD_ASOF, { u: [1, NaN, 0, 3, -0.4, 7] }), "range", "NaN in u");
expectFail("wind.json", wind(BASE_ASOF), wind(HEAD_ASOF, { v: [1, Infinity, 0, 3, -0.4, 7] }), "range", "Infinity in v");
expectFail("wind.json", wind(BASE_ASOF), wind(HEAD_ASOF, { u: [1, 121, 0, 3, -0.4, 7] }), "range", "wind over 120 m/s");
expectFail("currents.json", currents(BASE_ASOF), currents(HEAD_ASOF, { v: [-0.2, null, 10.5, -0.01, null, 0.9] }), "range", "current over 10 m/s");
expectFail("currents.json", currents(BASE_ASOF), currents(HEAD_ASOF, { sst: [27.1, null, 18.4, -6, null, 30] }), "range", "sst under -5 degC");
expectFail("currents.json", currents(BASE_ASOF), currents(HEAD_ASOF, { sst: [27.1, null, "18.4", -1.2, null, 30] }), "range", "sst as a string");
expectFail("wind.json", wind(BASE_ASOF), wind(HEAD_ASOF, { source: "Somewhere else" }), "source", "source changed");

// Every difference is listed, not just the first.
{
  const h = wind(HEAD_ASOF, { u: [1, 2, 3], source: "x" });
  delete h.grid;
  const r = compare("wind.json", wind(BASE_ASOF), h, { now: NOW });
  const named = rules(r);
  check(
    ["keys", "grid", "length", "source"].every((k) => named.includes(k)),
    `all reasons listed: ${r.reasons.join("; ")}`,
  );
}

// Command line, against a throwaway repo: base committed, head in the working tree.
const made = [];
function repo(baseFiles) {
  const dir = mkdtempSync(path.join(tmpdir(), "flows-shape-"));
  made.push(dir);
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { stdio: "ignore" });
  git("init", "-q");
  git("config", "core.autocrlf", "false");
  git("config", "user.name", "flows-shape self-test");
  git("config", "user.email", "flows-shape@example.invalid");
  write(dir, baseFiles);
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  return dir;
}
function write(dir, files) {
  for (const [name, body] of Object.entries(files)) {
    const p = path.join(dir, ...DATA_DIR.split("/"), name);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, typeof body === "string" ? body : JSON.stringify(body));
  }
}
const run = (dir, ...args) => spawnSync(process.execPath, [script, "--root", dir, ...args], { encoding: "utf8" });
const lines = (r) => r.stdout.trim().split("\n");

const base = { "wind.json": wind(BASE_ASOF), "currents.json": currents(BASE_ASOF) };
{
  const dir = repo(base);
  const r = run(dir, "--base", "HEAD");
  check(r.status === 0 && lines(r).length === FILES.length && lines(r).every((l) => /PASS\s+unchanged/.test(l)), `cli unchanged tree: exit ${r.status}, ${lines(r).join(" | ")}`);
}
{
  const dir = repo(base);
  write(dir, { "wind.json": wind(HEAD_ASOF, { u: [2, -1, 0.3, 4, -0.1, 6] }), "currents.json": currents(HEAD_ASOF, { sst: [27.3, null, 18.1, -1.5, null, 30.4] }) });
  const r = run(dir, "--base", "HEAD");
  check(r.status === 0 && lines(r).length === 2 && lines(r).every((l) => /^\S+\s+PASS\s/.test(l)), `cli refresh: exit ${r.status}, ${lines(r).join(" | ")}`);
}
{
  const dir = repo(base);
  write(dir, { "currents.json": currents(HEAD_ASOF, { u: [0.12, 0, -0.3, 0.05, 0, 1.1] }) });
  const r = run(dir, "--base", "HEAD");
  const [w, c] = lines(r);
  check(r.status === 1 && /^wind\.json\s+PASS\s+unchanged/.test(w) && /^currents\.json\s+FAIL\s.*nulls: u non-null 4 -> 6/.test(c), `cli zero fill: exit ${r.status}, ${lines(r).join(" | ")}`);
}
{
  const dir = repo(base);
  write(dir, { "wind.json": JSON.stringify(wind(HEAD_ASOF)).replace("1.5", "NaN") });
  const r = run(dir, "--base", "HEAD");
  check(r.status === 1 && /^wind\.json\s+FAIL\s+parse:/.test(lines(r)[0]), `cli literal NaN: exit ${r.status}, ${lines(r)[0]}`);
}
{
  const dir = repo(base);
  const r = run(dir, "--base", "no-such-ref");
  check(r.status === 1 && lines(r).every((l) => /FAIL\s+base:/.test(l)), `cli missing base ref: exit ${r.status}, ${lines(r)[0]}`);
}
{
  const dir = repo(base);
  const r = run(dir, "--bogus");
  check(r.status === 2, `cli unknown argument: exit ${r.status}`);
}
for (const dir of made) rmSync(dir, { recursive: true, force: true });

console.log(failed ? `${failed} check(s) failed` : "all checks passed");
process.exit(failed ? 1 : 0);
