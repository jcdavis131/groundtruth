// Builds the bundled companies snapshot from its public, keyless sources:
//
//   lib/companies/data/companies.json   every ticker in EDGAR's
//                                       company_tickers_exchange.json with
//                                       SIC, business-address city/state/ZIP,
//                                       county FIPS, a point, and the latest
//                                       annual XBRL facts from the frames API
//
// Why a snapshot: 6,000+ submissions fetches cannot happen at request time
// under the SEC fair-access policy (10 req/s, descriptive User-Agent), so
// this runs offline, at ~8 req/s, and commits the result with the date it
// was pulled. Everything a selection needs live (filings, fact histories) is
// fetched by app/api/companies on demand and cached.
//
//   node scripts/companies-data.mjs                 full build (resumes a partial file)
//   node scripts/companies-data.mjs --limit 200     first 200 listings (smoke test)
//   node scripts/companies-data.mjs --years 2024,2023
//   node scripts/companies-data.mjs --fresh          ignore the partial file
//   CONTACT=you@example.com node scripts/companies-data.mjs   contact for the User-Agent
//
// Nothing is typed in by hand. A company is placed only when its ZIP is in
// the Census ZCTA-to-county file and TIGERweb answers a centroid for it;
// otherwise countyFips/lon/lat stay null and the record says so. Facts come
// from the frames API only: one request per concept per period gives every
// filer at once, so the whole universe costs ~20 requests, not 6,000.
//
// shape per https://www.sec.gov/search-filings/edgar-application-programming-interfaces; unverified in sandbox

import fs from "node:fs";
import path from "node:path";

const CONTACT = process.env.CONTACT || "jcdavis131@gmail.com";
// No URL token: SEC answers 403 to a UA carrying "(+https://...)" (measured 2026-09-30); see SEC_USER_AGENT in lib/companies/edgar.ts.
const UA = `embedding-atlas/0.1 contact: ${CONTACT}`;
const OUT_DIR = path.resolve("lib/companies/data");
const OUT = path.join(OUT_DIR, "companies.json");
const PARTIAL = path.join(OUT_DIR, "companies.partial.json");
fs.mkdirSync(OUT_DIR, { recursive: true });

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const LIMIT = Number(argOf("--limit", "0")) || 0;
const FRESH = args.includes("--fresh");
const nowYear = new Date().getUTCFullYear();
// The current calendar year's frame is incomplete until most 10-Ks are in; pull the two finished years.
const YEARS = argOf("--years", `${nowYear - 1},${nowYear - 2}`)
  .split(",")
  .map((y) => Number(y.trim()))
  .filter((y) => Number.isFinite(y));

const SEC_FILES = "https://www.sec.gov/files";
const EDGAR = "https://data.sec.gov";
const ZCTA_COUNTY_URL = "https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt";
// TIGERweb ZCTA layer: could not be verified from the sandbox; if the query
// errors with "Invalid layer", look the id up in the service directory and
// change ZCTA_LAYER_ID here and in lib/companies/geo.ts.
const TIGER_ZCTA_SERVICE = "https://tigerweb.geo.census.gov/arcgis/rest/services/Generalized_ACS2023/Tracts_Blocks/MapServer";
const ZCTA_LAYER_ID = 2;

// Same table as lib/companies/facts.ts CONCEPTS; keep in step.
const CONCEPTS = [
  { key: "Revenues", taxonomy: "us-gaap", concepts: ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet"], unit: "USD", instant: false },
  { key: "NetIncomeLoss", taxonomy: "us-gaap", concepts: ["NetIncomeLoss", "ProfitLoss"], unit: "USD", instant: false },
  { key: "OperatingIncomeLoss", taxonomy: "us-gaap", concepts: ["OperatingIncomeLoss"], unit: "USD", instant: false },
  { key: "Assets", taxonomy: "us-gaap", concepts: ["Assets"], unit: "USD", instant: true },
  { key: "StockholdersEquity", taxonomy: "us-gaap", concepts: ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"], unit: "USD", instant: true },
  { key: "CashAndCashEquivalentsAtCarryingValue", taxonomy: "us-gaap", concepts: ["CashAndCashEquivalentsAtCarryingValue"], unit: "USD", instant: true },
  { key: "LongTermDebt", taxonomy: "us-gaap", concepts: ["LongTermDebt", "LongTermDebtNoncurrent"], unit: "USD", instant: true },
  { key: "EntityNumberOfEmployees", taxonomy: "dei", concepts: ["EntityNumberOfEmployees"], unit: "pure", instant: true, optional: true },
];

// ---- politeness: at most 8 requests a second to SEC, 6 to TIGERweb
const gates = new Map();
async function polite(name, minIntervalMs) {
  const g = gates.get(name) ?? { next: 0 };
  gates.set(name, g);
  const now = Date.now();
  const slot = Math.max(now, g.next);
  g.next = slot + minIntervalMs;
  if (slot > now) await new Promise((r) => setTimeout(r, slot - now));
}

async function get(name, url, { accept = "application/json", retries = 3, minIntervalMs = 125 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await polite(name, minIntervalMs);
    try {
      const r = await fetch(url, { headers: { "user-agent": UA, accept, "accept-encoding": "gzip, deflate" }, redirect: "follow" });
      if (r.status === 404) return null;
      if (r.status === 429 || r.status >= 500) {
        lastErr = new Error(`${r.status} ${url}`);
        await new Promise((res) => setTimeout(res, 2000 * (attempt + 1)));
        continue;
      }
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return r;
    } catch (err) {
      lastErr = err;
      await new Promise((res) => setTimeout(res, 1000 * (attempt + 1)));
    }
  }
  throw lastErr;
}

const padCik = (cik) => String(cik).padStart(10, "0");
const str = (v) => {
  const s = v == null ? "" : String(v).trim();
  return s ? s : null;
};
const normalizeZip = (zip) => {
  const m = String(zip ?? "")
    .trim()
    .match(/^(\d{5})(?:-?\d{4})?$/);
  return m ? m[1] : null;
};

// ---- 1. universe
console.log("EDGAR: company_tickers_exchange.json");
const tx = await (await get("sec", `${SEC_FILES}/company_tickers_exchange.json`)).json();
const F = tx.fields;
const col = (n) => {
  const i = F.indexOf(n);
  if (i < 0) throw new Error("company_tickers_exchange.json: column missing " + n);
  return i;
};
const iCik = col("cik");
const iName = col("name");
const iTicker = col("ticker");
const iExch = F.indexOf("exchange");
let listings = tx.data
  .map((r) => ({ cik: Number(r[iCik]), name: String(r[iName] ?? "").trim(), ticker: String(r[iTicker] ?? "").trim().toUpperCase(), exchange: iExch >= 0 ? str(r[iExch]) : null }))
  .filter((l) => Number.isFinite(l.cik) && l.cik > 0 && l.ticker);
if (LIMIT) listings = listings.slice(0, LIMIT);
console.log(`  ${listings.length} listings`);

// ---- 2. ZCTA -> county
console.log("Census: ZCTA to county relationship file");
const relText = await (await get("census", ZCTA_COUNTY_URL, { accept: "text/plain,*/*", minIntervalMs: 0 })).text();
const relLines = relText.split(/\r?\n/).filter((l) => l.trim());
const relH = relLines[0].split("|").map((h) => h.trim().replace(/^﻿/, ""));
const rZ = relH.indexOf("GEOID_ZCTA5_20");
const rC = relH.indexOf("GEOID_COUNTY_20");
const rL = relH.indexOf("AREALAND_PART");
if (rZ < 0 || rC < 0) throw new Error("relationship file: expected GEOID_ZCTA5_20 and GEOID_COUNTY_20 columns, got " + relH.join("|"));
const zctaCounty = new Map();
for (const line of relLines.slice(1)) {
  const c = line.split("|");
  const z = c[rZ]?.trim();
  const county = c[rC]?.trim();
  if (!/^\d{5}$/.test(z ?? "") || !/^\d{5}$/.test(county ?? "")) continue;
  const land = rL >= 0 ? Number(c[rL]) || 0 : 0;
  const cur = zctaCounty.get(z);
  if (!cur || land > cur.land) zctaCounty.set(z, { county, land });
}
console.log(`  ${zctaCounty.size} ZCTAs`);

// ---- 3. frames: one call per concept per period, every filer at once
const frames = new Map(); // key -> Map<cik, {val,end,accn}>
for (const year of YEARS) {
  for (const spec of CONCEPTS) {
    const period = spec.instant ? `CY${year}Q4I` : `CY${year}`;
    for (const concept of spec.concepts) {
      const url = `${EDGAR}/api/xbrl/frames/${spec.taxonomy}/${concept}/${spec.unit}/${period}.json`;
      process.stdout.write(`EDGAR frames: ${spec.taxonomy}/${concept}/${period} `);
      const r = await get("sec", url);
      if (!r) {
        console.log(spec.optional ? "(not published; optional)" : "(404)");
        continue;
      }
      const j = await r.json();
      const m = new Map();
      for (const d of j.data ?? []) if (Number.isFinite(d.cik) && Number.isFinite(d.val)) m.set(Number(d.cik), { val: d.val, end: d.end, accn: d.accn });
      frames.set(`${year}:${spec.key}:${concept}`, { period, rows: m, concept });
      console.log(`${m.size} filers`);
    }
  }
}

function factsFor(cik) {
  const out = {};
  for (const spec of CONCEPTS) {
    let best = null;
    for (const year of YEARS) {
      for (const concept of spec.concepts) {
        const f = frames.get(`${year}:${spec.key}:${concept}`);
        const row = f?.rows.get(cik);
        if (!row) continue;
        if (!best || row.end > best.end) best = { value: row.val, period: f.period, end: row.end, accn: row.accn, concept };
      }
      if (best) break; // newest year first; fall back to the older year only when the newer has nothing
    }
    out[spec.key] = best;
  }
  return out;
}

// ---- 4. per company: submissions (address, SIC), county, centroid
const partial = !FRESH && fs.existsSync(PARTIAL) ? JSON.parse(fs.readFileSync(PARTIAL, "utf8")) : { companies: [] };
const done = new Map(partial.companies.map((c) => [c.cik, c]));
console.log(`resuming with ${done.size} companies already built`);
const centroidCache = new Map();
async function centroid(zcta) {
  if (centroidCache.has(zcta)) return centroidCache.get(zcta);
  const qs = new URLSearchParams({ where: `ZCTA5='${zcta}'`, outFields: "ZCTA5,CENTLAT,CENTLON", returnGeometry: "false", f: "json" });
  const r = await get("tigerweb", `${TIGER_ZCTA_SERVICE}/${ZCTA_LAYER_ID}/query?${qs}`, { minIntervalMs: 170 });
  const j = r ? await r.json() : null;
  if (j?.error) throw new Error(`TIGERweb layer ${ZCTA_LAYER_ID}: ${j.error.message ?? "error"} (check ZCTA_LAYER_ID)`);
  const a = j?.features?.[0]?.attributes;
  const lat = Number(a?.CENTLAT);
  const lon = Number(a?.CENTLON);
  const pt = Number.isFinite(lat) && Number.isFinite(lon) ? [Math.round(lon * 1e4) / 1e4, Math.round(lat * 1e4) / 1e4] : null;
  centroidCache.set(zcta, pt);
  return pt;
}

let n = 0;
let placed = 0;
let noFeature = 0;
const started = Date.now();
for (const l of listings) {
  n++;
  if (done.has(l.cik)) continue;
  const r = await get("sec", `${EDGAR}/submissions/CIK${padCik(l.cik)}.json`);
  const sub = r ? await r.json() : null;
  const b = sub?.addresses?.business ?? {};
  const zip = normalizeZip(b.zipCode);
  const state = str(b.stateOrCountry);
  const county = zip ? (zctaCounty.get(zip)?.county ?? null) : null;
  let lon = null;
  let lat = null;
  let geo = null;
  if (zip && county) {
    const pt = await centroid(zip);
    if (pt) {
      [lon, lat] = pt;
      geo = "zcta-centroid";
      placed++;
    } else noFeature++;
  }
  const rec = {
    cik: l.cik,
    name: sub?.name ? String(sub.name).trim() : l.name,
    ticker: l.ticker,
    exchange: l.exchange,
    sic: str(sub?.sic),
    sicDescription: str(sub?.sicDescription),
    state,
    city: str(b.city),
    zip,
    countyFips: county,
    lon,
    lat,
    geo,
    fiscalYearEnd: str(sub?.fiscalYearEnd),
    stateOfIncorporation: str(sub?.stateOfIncorporation),
    facts: factsFor(l.cik),
    pulled: new Date().toISOString().slice(0, 10),
  };
  done.set(l.cik, rec);
  if (n % 25 === 0 || n === listings.length) {
    fs.writeFileSync(PARTIAL, JSON.stringify({ companies: [...done.values()] }));
    const rate = (n / ((Date.now() - started) / 1000)).toFixed(1);
    console.log(`  ${n}/${listings.length} · placed ${placed} · no centroid ${noFeature} · ${rate}/s`);
  }
}
// A centroid query that never returns a feature means the layer id is wrong; do not ship an unplaced universe silently.
if (placed === 0 && noFeature > 0) throw new Error(`TIGERweb returned no features for ${noFeature} ZCTAs; ZCTA_LAYER_ID=${ZCTA_LAYER_ID} is probably wrong. Nothing written.`);

const companies = [...done.values()].sort((a, b) => a.cik - b.cik);
const bundle = {
  source: "SEC EDGAR company_tickers_exchange.json + submissions API (business address, SIC) + XBRL frames API; US Census Bureau 2020 ZCTA-to-county relationship file and TIGERweb ZCTA centroids",
  pulled: new Date().toISOString().slice(0, 10),
  counts: {
    companies: companies.length,
    geocoded: companies.filter((c) => c.lon != null).length,
    withFacts: companies.filter((c) => Object.values(c.facts).some((v) => v)).length,
  },
  frameYears: YEARS,
  companies,
};
fs.writeFileSync(OUT, JSON.stringify(bundle) + "\n");
fs.rmSync(PARTIAL, { force: true });
console.log(`wrote ${OUT}: ${bundle.counts.companies} companies, ${bundle.counts.geocoded} placed, ${bundle.counts.withFacts} with facts`);
