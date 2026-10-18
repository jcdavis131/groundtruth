#!/usr/bin/env node
// Refresh for the animated flow layers (lib/layers/flows.ts: "windflow" and
// "oceanflow").
//
// Fetches two coarse global vector grids, free and keyless:
//   1. 10 m wind (u/v, m/s) from Open-Meteo's forecast API (GFS under the hood),
//      5-degree grid, 35 x 72 points.
//   2. Ocean surface currents (u/v, m/s) + sea-surface temperature (degC) from
//      Open-Meteo's marine API, 4-degree grid, 41 x 90 points. Land cells come
//      back null and stay null in the bundle (never zero-filled: zero would
//      read as "calm water").
//
// Writes lib/flows/data/wind.json + currents.json atomically (tmp + rename).
// Fails fast: any stage exiting non-zero leaves the previous bundles in place.
//
// Refresh cadence: every 6 hours. GFS cycles every 6 h and the marine analysis
// updates a few times a day, so 6 h keeps the particles honest without
// hammering a free API. Register the cron outside this repo (same pattern as
// the gas weekly cron); the layer note shows the bundle's as-of time and flags
// staleness past 30 h.

import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(HERE, "..", "lib", "flows", "data");
const BATCH = 100; // locations per Open-Meteo request
const PAUSE_MS = 2000; // politeness pause between batches; the free API 429s bursts and resets sockets on rapid batches
const MAX_RETRIES = 6;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function grid(lat0, lat1, dlat, lon0, lon1, dlon) {
  const lats = [];
  for (let la = lat0; la <= lat1 + 1e-9; la += dlat) lats.push(Math.round(la * 1e6) / 1e6);
  const lons = [];
  for (let lo = lon0; lo <= lon1 + 1e-9; lo += dlon) lons.push(Math.round(lo * 1e6) / 1e6);
  return { lats, lons };
}

/** Meteorological "from" direction + speed -> east/north components. */
function uv(speed, dirDeg) {
  if (speed == null || dirDeg == null) return [null, null];
  const r = (dirDeg * Math.PI) / 180;
  const q = (x) => Math.round(x * 100) / 100;
  return [q(-speed * Math.sin(r)), q(-speed * Math.cos(r))];
}

async function fetchBatch(url) {
  let lastErr = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    let res;
    try {
      res = await fetch(url, { headers: { "user-agent": "eye.jcamd.com flows-data" } });
    } catch (err) {
      // Socket/reset/timeout errors: Open-Meteo occasionally drops rapid
      // sequential batch connections (observed: deterministic reset on the
      // 2nd rapid multi-location batch). Retry with backoff, like 429/5xx.
      lastErr = err;
      const wait = Math.min(30000, 2000 * 2 ** attempt);
      console.log(`  socket error (${err.cause?.code || err.message}), retrying in ${wait / 1000}s…`);
      await sleep(wait);
      continue;
    }
    if (res.ok) return res.json();
    lastErr = new Error(`HTTP ${res.status} for ${url.slice(0, 120)}…`);
    if (res.status !== 429 && res.status < 500) throw lastErr;
    const wait = Math.min(30000, 2000 * 2 ** attempt);
    console.log(`  rate-limited (HTTP ${res.status}), retrying in ${wait / 1000}s…`);
    await sleep(wait);
  }
  throw lastErr;
}

/** Fetch `current=` vars for every grid point, batched. Returns row-major currents. */
async function fetchGrid(baseUrl, params, { lats, lons }) {
  const nlat = lats.length;
  const nlon = lons.length;
  const flat = [];
  for (const la of lats) for (const lo of lons) flat.push([la, lo]);
  const out = new Array(flat.length);
  for (let i = 0; i < flat.length; i += BATCH) {
    const slice = flat.slice(i, i + BATCH);
    const url =
      `${baseUrl}?latitude=${slice.map((p) => p[0].toFixed(2)).join(",")}` +
      `&longitude=${slice.map((p) => p[1].toFixed(2)).join(",")}&${params}`;
    const body = await fetchBatch(url);
    const rows = Array.isArray(body) ? body : [body];
    if (rows.length !== slice.length) {
      throw new Error(`expected ${slice.length} locations, got ${rows.length}`);
    }
    rows.forEach((row, k) => {
      out[i + k] = row?.current ?? null;
    });
    if (i + BATCH < flat.length) await sleep(PAUSE_MS);
    if ((i / BATCH) % 10 === 0) console.log(`  …${i + slice.length}/${flat.length}`);
  }
  return { out, nlat, nlon };
}

function writeBundle(name, bundle) {
  mkdirSync(OUT_DIR, { recursive: true });
  const tmp = path.join(OUT_DIR, `${name}.json.tmp`);
  const dst = path.join(OUT_DIR, `${name}.json`);
  writeFileSync(tmp, JSON.stringify(bundle));
  renameSync(tmp, dst);
  console.log(`wrote ${dst} (${(JSON.stringify(bundle).length / 1024).toFixed(1)} KB)`);
}

async function main() {
  // 1. Wind: 10 m, GFS via Open-Meteo.
  console.log("fetching wind grid…");
  const wg = grid(-85, 85, 5, -180, 175, 5);
  const { out: wcur, nlat: wnlat, nlon: wnlon } = await fetchGrid(
    "https://api.open-meteo.com/v1/forecast",
    "current=wind_speed_10m,wind_direction_10m&wind_speed_unit=ms&forecast_days=1&timezone=UTC",
    wg,
  );
  const wu = new Array(wcur.length);
  const wv = new Array(wcur.length);
  let wAsOf = null;
  wcur.forEach((c, i) => {
    const [u, v] = uv(c?.wind_speed_10m ?? null, c?.wind_direction_10m ?? null);
    wu[i] = u;
    wv[i] = v;
    if (!wAsOf && c?.time) wAsOf = c.time;
  });
  const wMissing = wu.filter((x) => x == null).length;
  if (wMissing > wu.length * 0.05) throw new Error(`wind grid ${wMissing}/${wu.length} missing — aborting`);
  writeBundle("wind", {
    asof: wAsOf ? `${wAsOf}:00Z`.replace(" ", "T") : new Date().toISOString(),
    source: "Open-Meteo (GFS 10 m wind)",
    grid: { lat0: -85, lon0: -180, dlat: 5, dlon: 5, nlat: wnlat, nlon: wnlon },
    u: wu,
    v: wv,
  });

  // 2. Ocean currents + SST via the marine API (velocity arrives in km/h).
  console.log("fetching currents grid…");
  const cg = grid(-80, 80, 4, -180, 176, 4);
  const { out: ccur, nlat: cnlat, nlon: cnlon } = await fetchGrid(
    "https://marine-api.open-meteo.com/v1/marine",
    "current=ocean_current_velocity,ocean_current_direction,sea_surface_temperature&timezone=UTC",
    cg,
  );
  const cu = new Array(ccur.length);
  const cv = new Array(ccur.length);
  const csst = new Array(ccur.length);
  let cAsOf = null;
  ccur.forEach((c, i) => {
    const ms = c?.ocean_current_velocity == null ? null : (c.ocean_current_velocity / 3.6);
    const [u, v] = uv(ms, c?.ocean_current_direction ?? null);
    cu[i] = u;
    cv[i] = v;
    csst[i] = c?.sea_surface_temperature == null ? null : Math.round(c.sea_surface_temperature * 10) / 10;
    if (!cAsOf && c?.time) cAsOf = c.time;
  });
  const cHave = cu.filter((x) => x != null).length;
  if (cHave < ccur.length * 0.2) throw new Error(`currents grid only ${cHave}/${ccur.length} ocean cells — aborting`);
  writeBundle("currents", {
    asof: cAsOf ? `${cAsOf}:00Z`.replace(" ", "T") : new Date().toISOString(),
    source: "Open-Meteo Marine (ocean currents + SST)",
    grid: { lat0: -80, lon0: -180, dlat: 4, dlon: 4, nlat: cnlat, nlon: cnlon },
    u: cu,
    v: cv,
    sst: csst,
  });

  console.log("flows data refresh complete: lib/flows/data/wind.json + currents.json");
}

main().catch((err) => {
  console.error(`flows-data FAILED: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
