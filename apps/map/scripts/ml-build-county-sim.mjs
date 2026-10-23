// Build the served county-sim-v1 bundle from the LIVE Zillow files.
// Usage: node --experimental-strip-types scripts/ml-build-county-sim.mjs [--zhvi /path.csv] [--zori /path.csv] [--out lib/ml/data/county_sim_v1.json]
// Features per county (latest vintage): [12m ZHVI change, 5y ZHVI change,
// 10y ZHVI change, 12m ZORI change (0 = Zillow has no rent row, documented)].
// Standardised across counties; the bundle stores the z-vectors. CPU-only, no new deps.
import { readFileSync, writeFileSync } from "fs";
import { pathToFileURL } from "url";
import { join } from "path";

const root = new URL("..", import.meta.url).pathname;
const args = process.argv.slice(2);
const at = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : "");
const outPath = at("--out") || join(root, "lib/ml/data/county_sim_v1.json");

const sim = await import(pathToFileURL(join(root, "lib/ml/county_sim.ts")).href);

function parseLine(line) {
  const out = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

async function load(url, local) {
  const text = local ? readFileSync(local, "utf8") : await (await fetch(url, { headers: { accept: "text/csv" } })).text();
  const lines = text.split("\n");
  const header = parseLine(lines[0]);
  const dates = [];
  for (let i = 0; i < header.length; i++) if (/^\d{4}-\d{2}-\d{2}$/.test(header[i])) dates.push({ i, m: header[i].slice(0, 7) });
  const iT = header.indexOf("RegionType"), iS = header.indexOf("State"), iN = header.indexOf("RegionName");
  const iA = header.indexOf("StateCodeFIPS"), iB = header.indexOf("MunicipalCodeFIPS");
  const map = new Map();
  for (let l = 1; l < lines.length; l++) {
    const c = parseLine(lines[l]);
    if (c.length < dates.length || c[iT] !== "county") continue;
    const fips = String(c[iA]).padStart(2, "0") + String(c[iB]).padStart(3, "0");
    map.set(fips, { name: c[iN], state: c[iS], values: dates.map(({ i }) => { const v = parseFloat(c[i]); return Number.isFinite(v) ? v : null; }) });
  }
  return { map, vintage: dates[dates.length - 1].m };
}

const zhvi = await load("https://files.zillowstatic.com/research/public_csvs/zhvi/County_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv", at("--zhvi"));
const zori = await load("https://files.zillowstatic.com/research/public_csvs/zori/County_zori_uc_sfrcondomfr_sm_month.csv", at("--zori"));
const retrievedAt = new Date().toISOString();
console.log(`zhvi counties=${zhvi.map.size} vintage=${zhvi.vintage}; zori counties=${zori.map.size} vintage=${zori.vintage}`);

const vecs = [];
for (const [fips, z] of zhvi.map) {
  const t = sim.trajectoryFeatures(z.values);
  if (!t) continue;
  const r = zori.map.get(fips);
  let rentChg = 0, hasRent = false;
  if (r) {
    const v = r.values.filter((x) => x != null);
    if (v.length >= 13) {
      const c = v[v.length - 1] / v[v.length - 13] - 1;
      if (Number.isFinite(c) && Math.abs(c) < 10) { rentChg = c; hasRent = true; }
    }
  }
  vecs.push({ fips, name: z.name, state: z.state, features: [...t, rentChg], hasRent });
}
const { mean, sd } = sim.standardize(vecs);
const counties = {};
for (const v of vecs) counties[v.fips] = { name: v.name, state: v.state, z: sim.applyStandardize(v.features, mean, sd), hasRent: v.hasRent };
const withRent = vecs.filter((v) => v.hasRent).length;

const bundle = {
  version: sim.SIM_VERSION,
  vintage: zhvi.vintage,
  source: {
    publisher: "Zillow",
    dataset: "ZHVI county + ZORI county, files.zillowstatic.com/research/public_csvs",
    release: zhvi.vintage,
    retrievedAt,
  },
  featureNames: ["zhvi_12m_change", "zhvi_5y_change", "zhvi_10y_change", "zori_12m_change"],
  mean, sd, counties,
  n: vecs.length,
  nWithRent: withRent,
  caveats: [
    "v1 uses Zillow home values + rents only; jobs/wages/water terms are the named v2 extension.",
    "Counties with no Zillow rent row get the mean (0 after standardisation) for the rent term.",
  ],
};
writeFileSync(outPath, JSON.stringify(bundle));
console.log(`counties=${vecs.length} withRent=${withRent} -> ${outPath}`);
