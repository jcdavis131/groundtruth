#!/usr/bin/env node
// Weekly refresh for the gas-price data layers (lib/layers/gasPrices.ts,
// lib/layers/gasForecast.ts).
//
// Runs the gas-forecaster pipeline end to end:
//   1. download the 10 EIA weekly retail-gasoline .xls files (national + 9 states)
//   2. data/pull_data.py      FRED + Hugging Face raw pulls (free, no keys)
//   3. data/parse_states.py   parse .xls (pure-Python BIFF reader) + VERIFICATION GATE
//                             (parsed national R1 must equal FRED GASREGW exactly;
//                             fails closed on mismatch)
//   4. models/state_models.py per-series walk-forward ridge fits
//   5. site_bundle.py         emit lib/gas/data/gas_prices.json + gas_forecasts.json
//
// Fails fast: any stage exiting non-zero stops the refresh and leaves the
// previous bundles in place (never a half-written bundle).
// Intended to run weekly (EIA prints Mondays); register the cron outside this repo.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const FORECASTER = path.join(os.homedir(), "workspace", "gas-forecaster");
const XLS_DIR = path.join(FORECASTER, "data", "raw", "eia_xls");
const CODES = ["nus", "sca", "sco", "sfl", "sma", "smn", "sny", "soh", "stx", "swa"];

function sh(cmd, args, opts = {}) {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { stdio: "inherit", ...opts });
}

if (!existsSync(FORECASTER)) {
  console.error(`gas-forecaster not found at ${FORECASTER}; nothing refreshed.`);
  process.exit(1);
}
mkdirSync(XLS_DIR, { recursive: true });

// 1. EIA weekly .xls files (free, no key). Re-download every refresh; EIA
//    revises past weeks occasionally, and the parse step re-verifies.
for (const code of CODES) {
  const name = `pet_pri_gnd_dcus_${code}_w.xls`;
  sh("curl", [
    "-sSL", "--max-time", "60", "--retry", "2",
    "-o", path.join(XLS_DIR, name),
    `https://www.eia.gov/dnav/pet/xls/${name}`,
  ]);
}

// 2-5. Python pipeline (numpy/pandas/requests only; no installs).
const PY = "python3";
sh(PY, ["data/pull_data.py"], { cwd: FORECASTER });
sh(PY, ["data/parse_states.py"], { cwd: FORECASTER });
sh(PY, ["models/state_models.py"], { cwd: FORECASTER });
sh(PY, ["site_bundle.py"], { cwd: FORECASTER });

console.log("gas data refresh complete: lib/gas/data/gas_prices.json + gas_forecasts.json");
