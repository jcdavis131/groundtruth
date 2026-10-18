// The county hazard-history bakes read by /api/hazards?op=history:
//   lib/hazards/data/spc-tornado-county.json  tornadoes per county per year (NOAA SPC, 1950-2025)
//   lib/hazards/data/landslide-county.json    USGS landslide susceptibility per county (2024)
// Both are derivations, built by the pure functions in lib/hazards/bake.ts and
// labelled as such in their meta. Run once and commit the output; nothing
// reads the upstream files at request time.
//
//   node scripts/bake-hazard-history.mjs
//   node scripts/bake-hazard-history.mjs --spc <file> --spc-hdr <headers file> --csv <file>
//
// Keyless. With no flags it downloads SPC's file (about 9 MB) and USGS's CSV
// (about 230 kB). SPC's Last-Modified is recorded (from the saved response
// headers when given files); ScienceBase sends the request time as
// Last-Modified, so the CSV is identified by its sha256 alone. The output
// depends only on the input bytes and SPC's header, so a rerun on the same
// files is byte-identical.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { bakeLandslide, bakeSpc, LANDSLIDE_CSV_URL, SPC_URL } from "../lib/hazards/bake.ts";

const UA = "Mozilla/5.0 (compatible; eye-atlas-bake/1.0)";
const args = process.argv.slice(2);
const flag = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};

function lastModifiedFrom(hdrFile) {
  if (!hdrFile) return null;
  const m = readFileSync(hdrFile, "utf8").match(/^last-modified:\s*(.+?)\s*$/im);
  return m ? m[1] : null;
}

async function input(fileFlag, hdrFlag, url) {
  const file = flag(fileFlag);
  if (file) return { text: readFileSync(file, "utf8"), lastModified: lastModifiedFrom(flag(hdrFlag)) };
  const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return { text: await res.text(), lastModified: res.headers.get("last-modified") };
}

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const counties = JSON.parse(readFileSync(path.join(root, "lib/places/data/counties.json"), "utf8")).rows.map((r) => ({ geoid: r.geoid, name: r.name, stusab: r.stusab }));
const out = path.join(root, flag("--out") ?? "lib/hazards/data");
mkdirSync(out, { recursive: true });

const spcIn = await input("--spc", "--spc-hdr", SPC_URL);
const sha = (t) => createHash("sha256").update(t).digest("hex");
const spc = bakeSpc(spcIn.text, counties, spcIn.lastModified, sha(spcIn.text));
writeFileSync(path.join(out, "spc-tornado-county.json"), JSON.stringify(spc) + "\n");
console.log(`spc: ${spc.meta.rows} rows, ${spc.meta.counties} counties, ${spc.meta.noCounty} with no county, ${spc.meta.legacyCt.length} legacy CT codes, ${spc.meta.unmatched.length} unmatched`);

const csvIn = await input("--csv", "--csv-hdr", LANDSLIDE_CSV_URL);
// ScienceBase answers Last-Modified with the request time, so it is not recorded; the sha256 identifies the input.
const ls = bakeLandslide(csvIn.text, counties, sha(csvIn.text));
writeFileSync(path.join(out, "landslide-county.json"), JSON.stringify(ls) + "\n");
console.log(`landslide: ${ls.meta.rows} rows, ${ls.meta.exact} exact, ${ls.meta.renamed.length} renamed, ${ls.meta.unmatched.length} unmatched`);
