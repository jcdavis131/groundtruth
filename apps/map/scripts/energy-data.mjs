#!/usr/bin/env node
// Refresh for the energy data layers (lib/layers/ercotPrices.ts,
// lib/layers/usElectricityPrices.ts, lib/layers/globalGeneration.ts,
// lib/layers/datacenters.ts).
//
// Runs the lib/energy collectors end to end (all free public sources,
// stdlib-only Python, no keys):
//   1. collect_ercot.py   ERCOT MIS public reports: RTM + DAM settlement
//                         point prices, actual load by weather zone
//   2. collect_eia.py     EIA SEDS bulk download: state annual retail
//                         electricity prices by sector; MER monthly
//                         generation by fuel (fuel-mix proxy)
//   3. collect_ember.py   Ember open data: yearly generation by fuel,
//                         global
//   4. collect_osm.py     OpenStreetMap via Overpass: data-center
//                         locations + under-construction projects
//   5. build_bundles.py   emit versioned JSON bundles under lib/energy/data/
//
// Raw collector outputs land in lib/energy/data/raw/ (gitignored); only the
// bundles are committed. Fails fast: any stage exiting non-zero stops the
// refresh and leaves the previous bundles in place (never a half-written
// bundle). One exception: when only the osm stage fails, the script prints a
// PARTIAL line, keeps the previous datacenters.json and rebuilds the others.
//
// Cadence: ERCOT real-time prices move every 15 minutes, so the ERCOT bundle
// is a snapshot the moment it is built. Recommended refresh: ERCOT collectors
// (step 1) every 15-60 minutes, full refresh (all steps) daily. Register the
// cron outside this repo; this script takes an optional stage filter:
//   npm run data:energy -- --only=ercot

import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENERGY = path.join(ROOT, "lib", "energy");
const COLLECTORS = path.join(ENERGY, "collectors");
const RAW = path.join(ENERGY, "data", "raw");

function sh(cmd, args, opts = {}) {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { stdio: "inherit", ...opts });
}

const only = process.argv.find((a) => a.startsWith("--only="))?.split("=")[1];

mkdirSync(RAW, { recursive: true });
const env = { ...process.env, ENERGY_RAW: RAW };
const PY = "python3";

const stages = [
  ["ercot", "collect_ercot.py"],
  ["eia", "collect_eia.py"],
  ["ember", "collect_ember.py"],
  ["osm", "collect_osm.py"],
];
// The data-center layer has one free community source (Overpass), and
// collect_osm.py already retries it. When that stage still fails, keep the
// previous datacenters.json (its meta.built keeps its old date) and let the
// price and generation bundles refresh. Every other stage still fails fast.
const skip = [];
for (const [name, script] of stages) {
  if (only && only !== name) continue;
  try {
    sh(PY, [path.join(COLLECTORS, script)], { env });
  } catch (err) {
    if (name !== "osm") throw err;
    console.log(
      `PARTIAL: osm stage failed (exit ${err.status ?? "unknown"}); datacenters.json keeps its previous build`,
    );
    skip.push("datacenters.json");
  }
}

// Bundles rebuild from whatever raw is present, except a skipped bundle,
// which keeps its committed file.
const bundleArgs = ["--raw", RAW];
if (skip.length) bundleArgs.push("--skip", skip.join(","));
sh(PY, [path.join(ENERGY, "build_bundles.py"), ...bundleArgs], { env });

console.log(
  skip.length
    ? `energy data refresh PARTIAL: kept previous ${skip.join(", ")}; other bundles rebuilt`
    : "energy data refresh complete: lib/energy/data/*.json",
);
