// The county storm-events bake read by /api/hazards?op=history&part=storms:
//   lib/hazards/data/storm-events/<ss>.json   one state's counties (52: 50 states, DC, Puerto Rico,
//                                             with Connecticut under its legacy county codes)
//   lib/hazards/data/storm-events/meta.json   the national tallies, the files read and every row
//                                             not attached, by year and why
// Built by the pure functions in lib/hazards/stormBake.ts and labelled a
// derivation in its meta. Run once per round and commit the output; nothing
// reads NCEI at request time.
//
//   node scripts/bake-storm-events.mjs
//   node scripts/bake-storm-events.mjs --listing <dir.html> --file 2025=<gz> --file 1996=<gz> --years 1996,2025
//   node scripts/bake-storm-events.mjs --save-dir <dir>   (also keeps each downloaded gz, for a local rerun)
//
// Keyless. With no flags it reads NCEI's directory listing, picks the newest
// compilation (c stamp) of each year's details file from 1996, and streams
// each file through gunzip and a quote-aware CSV reader one at a time (about
// 308 MB of gz in all; a file is never held whole, decompressed or not). The
// gz bytes are hashed as they stream, so meta records each input's sha256. The
// output depends only on the input bytes, so a rerun on the same files is
// byte-identical. Available memory is logged at the start and the end; under
// 2,000 MB the bake waits before the next file (up to 45 min). A file already
// in --save-dir is read from there.

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { freemem } from "node:os";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import path from "node:path";
import { csvStream, stormBaker, stormFiles, STORM_DIR } from "../lib/hazards/stormBake.ts";

const UA = "Mozilla/5.0 (compatible; eye-atlas-bake/1.0)";
const FLOOR_MB = 2000;
const args = process.argv.slice(2);
const flag = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const flags = (n) => args.flatMap((a, i) => (a === n && args[i + 1] ? [args[i + 1]] : []));
const files = new Map(flags("--file").map((s) => [Number(s.split("=")[0]), s.slice(s.indexOf("=") + 1)]));
const saveDir = flag("--save-dir");
const onlyYears = flag("--years") ? new Set(flag("--years").split(",").map(Number)) : null;

const mb = () => Math.round(freemem() / 1048576);
const t0 = Date.now();
console.log(`available at start: ${mb()} MB`);

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const counties = JSON.parse(readFileSync(path.join(root, "lib/places/data/counties.json"), "utf8")).rows.map((r) => ({ geoid: r.geoid, name: r.name, stusab: r.stusab }));
const out = path.join(root, flag("--out") ?? "lib/hazards/data/storm-events");

async function get(url) {
  const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(600_000) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res;
}

const listing = flag("--listing") ? readFileSync(flag("--listing"), "utf8") : await (await get(STORM_DIR)).text();
const wanted = stormFiles(listing).filter((f) => !onlyYears || onlyYears.has(f.year));
if (!wanted.length) throw new Error("no Storm Events details files found in the listing");

if (saveDir) mkdirSync(saveDir, { recursive: true });
const baker = stormBaker(counties);
let peak = 0;
for (const f of wanted) {
  // Under the floor, wait (every 30 s, up to 45 min) rather than start the next file.
  for (let waited = 0; mb() < FLOOR_MB; waited += 30) {
    if (waited >= 45 * 60) throw new Error(`available memory ${mb()} MB stayed under ${FLOOR_MB} MB for 45 min: stopping before ${f.file}`);
    if (waited % 300 === 0) console.log(`available ${mb()} MB is under ${FLOOR_MB} MB: waiting before ${f.file}`);
    await new Promise((r) => setTimeout(r, 30_000));
  }
  const saved = saveDir ? path.join(saveDir, f.file) : null;
  const local = files.get(f.year) ?? (saved && existsSync(saved) ? saved : undefined);
  const src = local ? createReadStream(local) : Readable.fromWeb((await get(f.url)).body);
  const hash = createHash("sha256");
  let bytes = 0;
  baker.beginFile(f);
  const csv = csvStream((r) => baker.row(r));
  const decoder = new TextDecoder("latin1");
  const gunzip = createGunzip();
  const keep = !local && saveDir ? createWriteStream(path.join(saveDir, f.file)) : null;
  src.on("data", (b) => {
    hash.update(b);
    bytes += b.length;
    keep?.write(b);
  });
  await new Promise((resolve, reject) => {
    src.on("error", reject);
    gunzip.on("error", reject);
    gunzip.on("data", (b) => csv.push(decoder.decode(b, { stream: true })));
    gunzip.on("end", () => {
      csv.push(decoder.decode());
      csv.end();
      resolve();
    });
    src.pipe(gunzip);
  });
  if (keep) await new Promise((resolve) => keep.end(resolve));
  baker.endFile({ sha256: hash.digest("hex"), bytes });
  const used = Math.round(process.memoryUsage().rss / 1048576);
  peak = Math.max(peak, used);
  console.log(`${f.year} ${f.file} ${bytes} B${local ? " (local)" : ""}; rss ${used} MB, available ${mb()} MB`);
}

const { meta, shards } = baker.result();
mkdirSync(out, { recursive: true });
for (const old of readdirSync(out)) if (/^\d{2}\.json$/.test(old)) rmSync(path.join(out, old));
for (const [st, sh] of Object.entries(shards)) writeFileSync(path.join(out, `${st}.json`), JSON.stringify(sh) + "\n");
writeFileSync(path.join(out, "meta.json"), JSON.stringify(meta) + "\n");
const rows = meta.files.reduce((a, f) => a + f.rows, 0);
const malformed = meta.files.reduce((a, f) => a + f.malformedRows, 0);
const mism = Object.values(meta.nameMismatch).flat().reduce((a, x) => a + x[3], 0);
const unm = Object.values(meta.unmatched).flat().reduce((a, x) => a + x[2], 0);
console.log(`storm events: ${meta.files.length} files, ${rows} rows (${malformed} malformed), ${meta.attachedRows} attached to ${meta.counties} counties in ${meta.shards.length} shards; ${mism} name mismatches, ${unm} unmatched; ${meta.types.length} types`);
console.log(`peak rss ${peak} MB; available at end ${mb()} MB; ${Math.round((Date.now() - t0) / 1000)} s`);
