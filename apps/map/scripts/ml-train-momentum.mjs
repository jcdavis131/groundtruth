// Train momentum-v1 on the REAL Zillow county ZHVI file and write the bundle.
// Usage: node --experimental-strip-types scripts/ml-train-momentum.mjs [--csv /path/to.csv] [--out lib/ml/data/momentum_v1.json]
// Downloads the live Zillow file unless --csv is given. CPU-only, no new deps.
// The model code is imported straight from lib/ml/momentum_forecast.ts (Node
// type-stripping) so the script and the served code cannot drift: one source
// of truth.
//
// Kill rule (SPEC-1.1): the model must beat naive + seasonal on the spatial
// holdout (MAE) and beat naive on the regime-shift slice. If it fails, the
// script prints KILLED, writes no bundle, and exits 1 — the eval report keeps
// the learning.
import { readFileSync, writeFileSync } from "fs";
import { pathToFileURL } from "url";
import { join } from "path";

const root = new URL("..", import.meta.url).pathname;

const args = process.argv.slice(2);
const csvIdx = args.indexOf("--csv");
const csvPath = csvIdx >= 0 ? args[csvIdx + 1] ?? "" : "";
const outIdx = args.indexOf("--out");
const outPath = outIdx >= 0 && args[outIdx + 1] ? args[outIdx + 1] : join(root, "lib/ml/data/momentum_v1.json");

// 1. Import the lib directly (single source of truth; needs --experimental-strip-types).
const ml = await import(pathToFileURL(join(root, "lib/ml/momentum_forecast.ts")).href);

// 2. Get the CSV.
const retrievedAt = new Date().toISOString();
let csv;
if (csvPath) {
  csv = readFileSync(csvPath, "utf8");
} else {
  const url = "https://files.zillowstatic.com/research/public_csvs/zhvi/County_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv";
  const res = await fetch(url, { headers: { accept: "text/csv,text/plain,*/*" } });
  if (!res.ok) throw new Error(`Zillow fetch failed: HTTP ${res.status}`);
  csv = await res.text();
}

function parseCsv(text) {
  const lines = text.split("\n");
  const header = lines[0].split(",");
  const dateCols = [];
  for (let i = 0; i < header.length; i++) if (/^\d{4}-\d{2}-\d{2}$/.test(header[i])) dateCols.push({ i, m: header[i].slice(0, 7) });
  const iType = header.indexOf("RegionType"), iState = header.indexOf("State"), iId = header.indexOf("RegionID");
  const counties = [];
  for (let l = 1; l < lines.length; l++) {
    const c = lines[l].split(",");
    if (c.length < dateCols.length || c[iType] !== "county") continue;
    const fips = String(c[iId]).padStart(5, "0");
    counties.push({
      fips,
      state: c[iState],
      months: dateCols.map((d) => d.m),
      values: dateCols.map(({ i }) => { const v = parseFloat(c[i]); return Number.isFinite(v) ? v : null; }),
    });
  }
  return counties;
}

const counties = parseCsv(csv);
const vintage = counties[0].months[counties[0].months.length - 1];
console.log(`counties=${counties.length} vintage=${vintage}`);

const rows = ml.buildPanel(counties);
console.log(`panel rows=${rows.length}`);

// 3. Spatial holdout eval.
const spatial = ml.splitSpatial(rows);
const lambda = ml.pickLambda(spatial.train, [0.01, 0.1, 1, 10, 100], vintage);
const model = ml.trainRidge(spatial.train, lambda, vintage);
const evalSpatial = ml.evaluateSplit(model, spatial.test);
const rq = ml.residualQuantiles(model, spatial.test);
model.residualP10 = rq.p10;
model.residualP90 = rq.p90;

// 4. Regime-shift eval.
const regime = ml.splitRegime(rows, "2019-12", "2020-01", "2023-12");
const modelR = ml.trainRidge(regime.train, lambda, vintage);
const evalRegime = ml.evaluateSplit(modelR, regime.test);

const pct = (x) => (x * 100).toFixed(3) + "%";
console.log(`--- spatial holdout (n=${evalSpatial.n}, lambda=${lambda}) ---`);
console.log(`ridge    MAE=${pct(evalSpatial.ridge.mae)} RMSE=${pct(evalSpatial.ridge.rmse)}`);
console.log(`naive    MAE=${pct(evalSpatial.naive.mae)} RMSE=${pct(evalSpatial.naive.rmse)}`);
console.log(`seasonal MAE=${pct(evalSpatial.seasonal.mae)} RMSE=${pct(evalSpatial.seasonal.rmse)}`);
console.log(`paired ridge-vs-naive: meanDiff=${(evalSpatial.pairedVsNaive.meanDiff * 100).toFixed(4)}pp t=${evalSpatial.pairedVsNaive.t.toFixed(1)}`);
console.log(`--- regime shift train<=2019-12 test=2020-01..2023-12 (n=${evalRegime.n}) ---`);
console.log(`ridge    MAE=${pct(evalRegime.ridge.mae)} RMSE=${pct(evalRegime.ridge.rmse)}`);
console.log(`naive    MAE=${pct(evalRegime.naive.mae)} RMSE=${pct(evalRegime.naive.rmse)}`);
console.log(`seasonal MAE=${pct(evalRegime.seasonal.mae)} RMSE=${pct(evalRegime.seasonal.rmse)}`);
console.log(`paired ridge-vs-naive: meanDiff=${(evalRegime.pairedVsNaive.meanDiff * 100).toFixed(4)}pp t=${evalRegime.pairedVsNaive.t.toFixed(1)}`);

// 5. Kill rule.
const survivesA = evalSpatial.ridge.mae < evalSpatial.naive.mae && evalSpatial.ridge.mae < evalSpatial.seasonal.mae;
const survivesB = evalRegime.ridge.mae < evalRegime.naive.mae;
if (!survivesA || !survivesB) {
  console.log(`KILLED: spatial=${survivesA} regime=${survivesB}. No bundle written.`);
  process.exit(1);
}

// 6. Bundle.
const bundle = {
  ...model,
  featureNames: [...ml.FEATURE_NAMES],
  horizonMonths: ml.HORIZON_MONTHS,
  evalSpatial,
  evalRegime,
  formula: ml.FORMULA,
  source: {
    publisher: "Zillow",
    dataset: "ZHVI county, all homes (smoothed, seasonally adjusted), files.zillowstatic.com/research/public_csvs",
    release: vintage,
    retrievedAt,
  },
  sources: ["Zillow ZHVI county file (files.zillowstatic.com/research/public_csvs)"],
  caveats: [
    "Zillow revises recent months in each release, so backtest months are cleaner than live months.",
    "County coverage grows over time: early months over-represent large metros.",
    "A county is not a tradable asset; this is a descriptive model, not advice.",
  ],
};
writeFileSync(outPath, JSON.stringify(bundle, null, 2));
console.log(`wrote ${outPath}`);
