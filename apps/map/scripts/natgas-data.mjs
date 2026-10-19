#!/usr/bin/env node
// Refresh for the natural-gas data bundle (lib/gas/data/natgas_henryhub.json).
//
// Pulls the Henry Hub natural gas spot price, daily series, from FRED
// (series DHHNGSP, EIA source) via the key-free fredgraph.csv endpoint — the
// same key-free FRED path the gasoline pipeline already uses for GASREGW.
//
// Fails closed: unreachable source, empty response, unparseable rows, or
// values outside a sane $/MMBtu band all exit non-zero and leave the previous
// bundle in place (atomic write via temp file + rename, never a half-written
// bundle). No synthetic data, ever.
// Intended to run weekly alongside the gasoline refresh; register the cron
// outside this repo.

import { execFileSync } from "node:child_process";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

const FRED_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DHHNGSP";
const OUT_DIR = path.resolve("lib/gas/data");
const OUT = path.join(OUT_DIR, "natgas_henryhub.json");
// Temp file lives beside the bundle (same filesystem) so the final rename is
// atomic; /tmp is a different device on this VM (EXDEV).
const TMP = path.join(OUT_DIR, `.natgas_henryhub.${process.pid}.tmp`);

// Plausible Henry Hub daily spot band, $/MMBtu. The series has ranged roughly
// $1–$23 since 1997; anything outside 0.1–50 is source garbage, not history.
const MIN_PRICE = 0.1;
const MAX_PRICE = 50;
// FRED daily series skips weekends; a long holiday weekend can gap ~4 days.
// Anything beyond 10 days means the feed broke, not the calendar.
const MAX_GAP_DAYS = 10;

function fail(msg) {
  console.error(`natgas-data: ${msg}`);
  process.exit(1);
}

let csv;
try {
  csv = execFileSync(
    "curl",
    ["-sSL", "--max-time", "60", "--retry", "2", FRED_URL],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }
  );
} catch (e) {
  fail(`download failed: ${e.message}`);
}

const lines = csv.trim().split("\n");
if (lines.length < 2 || !lines[0].startsWith("observation_date")) {
  fail("unexpected CSV header — source format may have changed");
}

const history = [];
for (let i = 1; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line) continue;
  const [date, raw] = line.split(",");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) fail(`bad date on row ${i + 1}: ${line}`);
  if (raw === "." || raw === "") continue; // FRED marks missing observations with "."
  const price = Number(raw);
  if (!Number.isFinite(price)) fail(`bad price on row ${i + 1}: ${line}`);
  if (price < MIN_PRICE || price > MAX_PRICE) {
    fail(`price out of band on ${date}: $${price}/MMBtu (band ${MIN_PRICE}–${MAX_PRICE})`);
  }
  history.push([date, Math.round(price * 100) / 100]);
}

if (history.length < 100) fail(`too few rows: ${history.length} (expected thousands)`);

// Gap check — dates must ascend. The early series (1997–1999) has sparse
// reporting with multi-week holes, so the strict bound applies only to modern
// data (2020+), where a >10-day hole means the feed broke, not the calendar.
const MODERN_FROM = "2020-01-01";
const DAY = 86400000;
for (let i = 1; i < history.length; i++) {
  const gap = (Date.parse(history[i][0]) - Date.parse(history[i - 1][0])) / DAY;
  if (!(gap > 0)) fail(`dates not ascending at ${history[i][0]}`);
  if (history[i][0] >= MODERN_FROM && gap > MAX_GAP_DAYS) {
    fail(`date gap anomaly between ${history[i - 1][0]} and ${history[i][0]} (${gap} days)`);
  }
}

// Freshness check — the series must end within the last ~10 days.
const lastDate = history[history.length - 1][0];
const ageDays = (Date.now() - Date.parse(lastDate + "T12:00:00Z")) / DAY;
if (ageDays > 10) fail(`stale series: last observation ${lastDate} (${ageDays.toFixed(1)} days ago)`);

const last = history[history.length - 1][1];
const prev = history[history.length - 2][1];

const bundle = {
  meta: {
    built: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    method:
      "Henry Hub natural gas spot price, daily (FRED DHHNGSP, EIA source), pulled via the key-free fredgraph.csv endpoint.",
    sources: [FRED_URL],
    provenance: "scripts/natgas-data.mjs",
    freshness: "FRED daily cadence — refresh via npm run data:natgas",
    rows: history.length,
    first: history[0][0],
    last: lastDate,
  },
  series: {
    name: "Henry Hub Natural Gas Spot Price",
    unit: "$/MMBtu",
    current: last,
    prevDay: prev,
    changeDod: Math.round((last - prev) * 100) / 100,
    asof: lastDate,
    history,
  },
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(TMP, JSON.stringify(bundle));
renameSync(TMP, OUT);

console.log(
  `natgas data refresh complete: ${path.relative(process.cwd(), OUT)} ` +
    `(${history.length} daily rows, ${history[0][0]} → ${lastDate}, last $${last}/MMBtu)`
);
