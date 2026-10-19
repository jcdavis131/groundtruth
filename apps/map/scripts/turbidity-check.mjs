// Offline check of the in-browser turbidity pipeline, from Node.
//
//   node scripts/turbidity-check.mjs <lon> <lat> [resolution m] [before ISO date]
//   node scripts/turbidity-check.mjs -98.34 29.28 20 2025-01-19
//
// Compiles lib/water/turbidity.worker.ts (+ dogliotti, utm) with tsc into
// .tmp-turb/ and runs the same run() the Web Worker runs, printing the scene
// it chose and the chips it produced. Used to reproduce the TurbidityVision
// explainer's Bexar County medians before the layer shipped.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";

const [lon, lat] = [Number(process.argv[2] ?? -98.34), Number(process.argv[3] ?? 29.28)];
const res = Number(process.argv[4] ?? 20);
const before = process.argv[5] ? Date.parse(process.argv[5]) + 86_400_000 : Date.now();
if (![lon, lat, res, before].every(Number.isFinite)) {
  console.error("usage: node scripts/turbidity-check.mjs <lon> <lat> [resolution m] [before ISO date]");
  process.exit(1);
}

mkdirSync(".tmp-turb", { recursive: true });
execSync(
  "npx tsc lib/water/turbidity.worker.ts lib/water/dogliotti.ts lib/water/utm.ts --outDir .tmp-turb --module es2022 --target es2022 --moduleResolution bundler --lib es2022,webworker --skipLibCheck --types node",
  { stdio: "inherit" },
);
const wp = ".tmp-turb/turbidity.worker.js";
writeFileSync(wp, readFileSync(wp, "utf8").replace('from "./dogliotti"', 'from "./dogliotti.js"').replace('from "./utm"', 'from "./utm.js"'));
writeFileSync(".tmp-turb/package.json", '{ "type": "module" }');

const { run } = await import(pathToFileURL(wp).href);
const span = (res * 1400) / 100_000;
const bbox = [lon - span / 2, lat - span / 2, lon + span / 2, lat + span / 2];
const t0 = Date.now();
const r = await run({ type: "run", id: 1, bbox, before, lookbackDays: 90, maxCloud: 40, resolution: res });
if (r.type !== "result") {
  console.log(r);
  process.exit(0);
}
const s = r.scene;
console.log(`scene ${s.id}  ${s.datetime}  tile cloud ${s.cloud.toFixed(1)} %  window cloud ${(s.localCloud * 100).toFixed(2)} %  (${s.candidates.length} inspected)`);
console.log(`convention ${s.convention}  dark-water B8A ${s.check.darkWaterB8A.toFixed(4)}  land NDVI ${s.check.landNdvi.toFixed(3)}  negative ${(s.check.negativeFraction * 100).toFixed(2)} %  ${s.check.pass ? "PASS" : "FAIL"}`);
console.log(`pixel ${s.pixelM} m (overview ${s.overview})  read ${(s.bytesRead / 1e6).toFixed(1)} MB in ${((Date.now() - t0) / 1000).toFixed(1)} s  window ${r.window.map((x) => x.toFixed(3)).join(",")}`);
const meds = r.chips.map((c) => c.stats.median).sort((a, b) => a - b);
const q = (p) => meds[Math.min(meds.length - 1, Math.floor(p * meds.length))];
console.log(`${r.chips.length} chips  median-of-medians ${q(0.5)?.toFixed(2)}  p10 ${q(0.1)?.toFixed(2)}  p90 ${q(0.9)?.toFixed(2)} FNU`);
for (const c of r.chips.slice().sort((a, b) => b.stats.n - a.stats.n).slice(0, 12)) {
  console.log(`  (${c.lon.toFixed(4)}, ${c.lat.toFixed(4)})  n ${String(c.stats.n).padStart(5)}  median ${c.stats.median.toFixed(2).padStart(8)}  p10 ${c.stats.p10.toFixed(2).padStart(8)}  p90 ${c.stats.p90.toFixed(2).padStart(9)}`);
}
