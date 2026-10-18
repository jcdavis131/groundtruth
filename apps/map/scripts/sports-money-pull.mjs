#!/usr/bin/env node
// Refresh sketch for the sports-money data layer (lib/sports-money/).
//
// Two halves, because the two sources behave differently:
//
//   PART A - Spotrac cash trackers (automated, polite).
//     https://www.spotrac.com/nba/cash/_/year/{YYYY}/sort/cash_total
//     Spotrac rate-limits automated fetches (HTTP 402) if you hit it hard.
//     This puller fetches one season at a time with a generous delay between
//     requests, parses the Rank/Team/Active/Dead/Retained/Total-Cash table,
//     and appends the season to lib/sports-money/data/nba_payrolls.json.
//     Fails closed: on any fetch/parse error the bundle is left untouched and
//     the season is reported in the run log for a manual retry.
//
//   PART B - Forbes valuations (MANUAL, by design).
//     Forbes does not offer a data API and its list pages block automated
//     extraction. A script that silently mis-parses a paywalled list is worse
//     than an honest manual step. When Forbes publishes (October, annually):
//       1. Open https://www.forbes.com/nba-valuations/list/ and any
//          reputable republication of the full 30-team table (Hoops Rumors,
//          theScore, Bleacher Report, sportsnaut, ESPN all carry it).
//       2. Transcribe each team's value EXACTLY as published (USD billions).
//       3. Append an edition object to nba_valuations.json:
//          { "edition": "<pub year>", "published": "<YYYY-MM-DD>",
//            "season": "<the season the values are based on, e.g. '2024-25'>",
//            "league_avg_b": <Forbes-reported average>, "source_url": "<table URL>",
//            "valuations_b": { "ATL": <x>, ... } }
//          Then run this script's verify step (below) before leaving the tree.
//
//   npm run data:sports-money  ->  node scripts/sports-money-pull.mjs [--verify-only]
//
// Usage here (STAGED, do not commit to master): this script is a working
// sketch. The payroll-pull half is runnable; the Forbes half is a documented
// manual procedure until/unless Forbes offers machine access.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(new URL(".", import.meta.url).pathname, "..");
const PAYROLL_BUNDLE = path.join(ROOT, "lib", "sports-money", "data", "nba_payrolls.json");
const VAL_BUNDLE = path.join(ROOT, "lib", "sports-money", "data", "nba_valuations.json");

const TEAMS = ["ATL","BKN","BOS","CHA","CHI","CLE","DAL","DEN","DET","GSW","HOU","IND","LAC","LAL","MEM","MIA","MIL","MIN","NOP","NYK","OKC","ORL","PHI","PHX","POR","SAC","SAS","TOR","UTA","WAS"];
// Spotrac year param = season start year. Missing entries are filled by hand.
const PAYROLL_YEARS = { 2013: "2013-14", 2014: "2014-15", 2015: "2015-16", 2016: "2016-17", 2017: "2017-18", 2018: "2018-19", 2019: "2019-20", 2020: "2020-21", 2021: "2021-22", 2022: "2022-23", 2023: "2023-24", 2024: "2024-25" };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function money(s) {
  const m = s.replace(/[$,]/g, "").trim();
  const n = Number(m);
  if (!Number.isFinite(n)) throw new Error(`unparseable money: ${s}`);
  return n;
}

// Parse the Spotrac cash-tracker table out of the page text. The page renders
// rows as | Rank | Team | Record | Signed | Avg Age | Active | Dead | Retained | Total Cash |.
function parseCashTable(text, year) {
  const season = PAYROLL_YEARS[year];
  const rows = { active_usd: {}, dead_usd: {}, total_cash_usd: {} };
  const lines = text.split("\n").map((l) => l.trim());
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\|\s*(\d{1,2})\s*$/);
    if (!m) continue;
    // Rank line; next non-empty lines: Team, Record, Signed, Avg Age, Active, Dead, Retained, Total Cash
    const cells = [];
    for (let j = i + 1; j < lines.length && cells.length < 8; j++) {
      if (lines[j].startsWith("|")) cells.push(lines[j].replace(/^\|\s*/, "").replace(/\s*\|$/, "").trim());
    }
    if (cells.length < 8) continue;
    const code = cells[0].split(/\s+/)[0].toUpperCase();
    if (!TEAMS.includes(code)) continue;
    try {
      rows.active_usd[code] = money(cells[4]);
      rows.dead_usd[code] = money(cells[5]);
      rows.total_cash_usd[code] = money(cells[7]);
    } catch (e) {
      throw new Error(`year ${year}, team ${code}: ${e.message}`);
    }
    i += cells.length; // skip ahead past the row
  }
  const missing = TEAMS.filter((t) => rows.total_cash_usd[t] == null);
  if (missing.length) throw new Error(`year ${year}: missing teams after parse: ${missing.join(",")}`);
  return { season, rows };
}

async function pullSeason(year) {
  const url = `https://www.spotrac.com/nba/cash/_/year/${year}/sort/cash_total`;
  console.log(`fetching ${url}`);
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; sports-money-refresh/1.0)" } });
  if (res.status === 402) throw new Error(`year ${year}: Spotrac rate-limited us (HTTP 402). Stop, wait an hour, resume with this year.`);
  if (!res.ok) throw new Error(`year ${year}: HTTP ${res.status}`);
  const text = await res.text();
  return parseCashTable(text, year);
}

function verifyBundles() {
  // Hard gates: every valuations edition needs 30 teams (except the known 2021a MEM gap),
  // every payroll season needs all 30 codes, money must be positive and sane.
  const val = JSON.parse(readFileSync(VAL_BUNDLE, "utf8"));
  for (const e of val.editions) {
    const teams = Object.keys(e.valuations_b);
    const expected = e.edition === "2021a" ? 29 : 30;
    if (teams.length !== expected) throw new Error(`valuations edition ${e.edition}: ${teams.length} teams, want ${expected}`);
    for (const [t, v] of Object.entries(e.valuations_b)) {
      if (!TEAMS.includes(t)) throw new Error(`valuations edition ${e.edition}: unknown team ${t}`);
      if (!(v > 0.1 && v < 30)) throw new Error(`valuations edition ${e.edition}: team ${t} value ${v} out of range`);
    }
  }
  if (!existsSync(PAYROLL_BUNDLE)) throw new Error("payroll bundle missing");
  const pay = JSON.parse(readFileSync(PAYROLL_BUNDLE, "utf8"));
  for (const [season, s] of Object.entries(pay.seasons)) {
    for (const key of ["active_usd", "dead_usd", "total_cash_usd"]) {
      const teams = Object.keys(s[key] ?? {});
      if (teams.length !== 30) throw new Error(`payroll ${season}.${key}: ${teams.length} teams, want 30`);
      for (const [t, v] of Object.entries(s[key])) {
        if (!TEAMS.includes(t)) throw new Error(`payroll ${season}.${key}: unknown team ${t}`);
        if (!(v >= 0 && v < 1e9)) throw new Error(`payroll ${season}.${key}: team ${t} value ${v} out of range`);
      }
    }
  }
  console.log("verify OK: bundles consistent");
}

async function main() {
  const verifyOnly = process.argv.includes("--verify-only");
  verifyBundles();
  if (verifyOnly) return;

  const pay = JSON.parse(readFileSync(PAYROLL_BUNDLE, "utf8"));
  const missing = Object.keys(PAYROLL_YEARS).filter((y) => !pay.seasons[PAYROLL_YEARS[y]]);
  if (!missing.length) { console.log("all payroll seasons present; nothing to pull"); return; }

  for (const y of missing) {
    const { season, rows } = await pullSeason(y); // throws on 402 -> stops, bundle untouched
    const next = JSON.parse(readFileSync(PAYROLL_BUNDLE, "utf8")); // re-read, append atomically
    next.seasons[season] = rows;
    const tmp = PAYROLL_BUNDLE + ".tmp";
    writeFileSync(tmp, JSON.stringify(next, null, 1) + "\n");
    // verify before swapping in: never a half-written bundle
    const backup = readFileSync(PAYROLL_BUNDLE, "utf8");
    try {
      writeFileSync(PAYROLL_BUNDLE, readFileSync(tmp, "utf8"));
      verifyBundles();
      console.log(`season ${season} appended`);
    } catch (e) {
      writeFileSync(PAYROLL_BUNDLE, backup);
      throw e;
    } finally {
      try { (await import("node:fs")).unlinkSync(tmp); } catch {}
    }
    await sleep(20_000); // 20s between Spotrac requests: polite beats fast
  }
  console.log("sports-money refresh complete");
}

main().catch((e) => { console.error(`FAILED: ${e.message}`); process.exit(1); });
