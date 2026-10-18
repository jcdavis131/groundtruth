// Builds the national HUC-12 drainage table the downstream trace walks:
//
//   lib/fabric/data/huc12-tohuc.json   every HUC-12 in the USGS Watershed Boundary
//                                      Dataset with the HUC-12 (or terminal) it
//                                      drains to, grouped by HUC-4
//
// Why bundle it: the WBD MapServer answers a cold query in tens of seconds and
// often with a 502/504, so a live walk across the Mississippi basin could take
// minutes or fail. ToHUC changes only when WBD is republished; the outlines and
// names the trace draws are still fetched live, in batches.
//
// Resumable: progress is kept in .tmp-wbd/ one file per HUC-4, so a re-run
// only asks for basins it does not have. Run:  node scripts/wbd-data.mjs
// Polite: at most CONCURRENCY requests in flight, backoff on failure.

import fs from "node:fs";
import path from "node:path";

const UA = "embedding-atlas/0.1 (+https://github.com/jcdavis131/gods-eye-view; open-source globe)";
const WBD = "https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer";
const OUT = path.resolve("lib/fabric/data/huc12-tohuc.json");
const TMP = path.resolve(".tmp-wbd");
const CONCURRENCY = Number(process.env.WBD_CONCURRENCY ?? 3);
fs.mkdirSync(TMP, { recursive: true });
fs.mkdirSync(path.dirname(OUT), { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, tries = 6) {
  let wait = 3000;
  for (let i = 1; i <= tries; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 90_000);
      const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error(`${res.status}`);
      const j = await res.json();
      if (j.error) throw new Error(j.error.message ?? "arcgis error");
      return j;
    } catch (err) {
      if (i === tries) throw err;
      await sleep(wait);
      wait = Math.min(60_000, wait * 2);
    }
  }
}

async function huc4List() {
  const q = new URLSearchParams({ where: "1=1", outFields: "huc4", returnGeometry: "false", orderByFields: "huc4", f: "json", resultRecordCount: "2000" });
  const j = await getJson(`${WBD}/2/query?${q}`);
  return [...new Set((j.features ?? []).map((f) => String(f.attributes.huc4 ?? f.attributes.HUC4)).filter((h) => /^\d{4}$/.test(h)))];
}

async function basin(huc4) {
  const file = path.join(TMP, `${huc4}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  const rows = [];
  for (let offset = 0; offset < 20_000; offset += 2000) {
    const q = new URLSearchParams({
      where: `huc12 LIKE '${huc4}%'`,
      outFields: "huc12,tohuc",
      returnGeometry: "false",
      orderByFields: "huc12",
      resultOffset: String(offset),
      resultRecordCount: "2000",
      f: "json",
    });
    const j = await getJson(`${WBD}/6/query?${q}`);
    for (const f of j.features ?? []) {
      const a = Object.fromEntries(Object.entries(f.attributes).map(([k, v]) => [k.toLowerCase(), v]));
      if (/^\d{12}$/.test(String(a.huc12))) rows.push([String(a.huc12), String(a.tohuc ?? "").trim()]);
    }
    if (!j.exceededTransferLimit) break;
  }
  fs.writeFileSync(file, JSON.stringify(rows));
  return rows;
}

const list = await huc4List();
console.log(`${list.length} HUC-4 basins; ${fs.readdirSync(TMP).length} already pulled`);
let done = 0;
let failed = [];
const queue = [...list];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const h = queue.shift();
      const t0 = Date.now();
      try {
        const rows = await basin(h);
        done++;
        console.log(`${h} ${rows.length} rows ${((Date.now() - t0) / 1000).toFixed(1)}s  [${done}/${list.length}]`);
      } catch (err) {
        failed.push(h);
        console.log(`${h} FAILED ${err.message}`);
      }
    }
  }),
);

// Compact: per HUC-4, "huc12>tohuc" pairs joined with "|"; tohuc keeps its own
// terminals (OCEAN, CLOSED BASIN, CANADA, MEXICO) verbatim.
const basins = {};
let count = 0;
for (const h of list) {
  const file = path.join(TMP, `${h}.json`);
  if (!fs.existsSync(file)) continue;
  const rows = JSON.parse(fs.readFileSync(file, "utf8"));
  basins[h] = rows.map(([a, b]) => `${a}>${b}`).join("|");
  count += rows.length;
}
const out = {
  source: "USGS Watershed Boundary Dataset, WBD MapServer layer 6 (12-digit HU): huc12, tohuc",
  url: `${WBD}/6`,
  pulled: new Date().toISOString().slice(0, 10),
  complete: failed.length === 0 && Object.keys(basins).length === list.length,
  basinCount: Object.keys(basins).length,
  count,
  basins,
};
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`wrote ${OUT}: ${count} HUC-12s in ${out.basinCount}/${list.length} basins${failed.length ? `; failed: ${failed.join(",")} (re-run to fill)` : ""}`);
