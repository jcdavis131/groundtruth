// The CMS hospital-ratings bake read by /api/infra?op=hospitals (box tier):
//   lib/infra/data/cms-hospitals.json   CMS Hospital General Information rows joined to HIFLD
//                                       hospitals by exact street address + ZIP, keyed by HIFLD ID
// Built by the pure functions in lib/infra/cms.ts and labelled a derivation in
// its meta. Run once per round and commit the output; nothing asks CMS at
// request time (CMS answers no-store with no CORS, 1.8-4.7 s a page).
//
//   node scripts/bake-cms-hospitals.mjs
//   node scripts/bake-cms-hospitals.mjs --save-dir <dir>   (keep every answer read)
//   node scripts/bake-cms-hospitals.mjs --from <dir>       (rebuild from a saved set, no network)
//
// Keyless. It reads CMS's metastore (for the dataset's modified date), the
// datastore in pages of 1,500 with the named columns only (never the
// telephone), HIFLD's layer 6 description (dataLastEditDate) and HIFLD's rows
// (ID, ADDRESS, ZIP, STATUS, NAME, TYPE; every status) in pages of 2,000. The
// two names and types are read only for tenantConflict and no row stores them.
// The output depends only on those answers, so a rerun on a saved set is
// byte-identical.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { bakeCms, cmsPageUrl, CMS_DENY, CMS_METASTORE, CMS_PAGE, HIFLD_JOIN_FIELDS, HIFLD_JOIN_URL } from "../lib/infra/cms.ts";

const UA = "Mozilla/5.0 (compatible; eye-atlas-bake/1.0)";
const args = process.argv.slice(2);
const flag = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const saveDir = flag("--save-dir");
const fromDir = flag("--from");
if (saveDir) mkdirSync(saveDir, { recursive: true });

async function text(name, url) {
  if (fromDir) return readFileSync(path.join(fromDir, `${name}.json`), "utf8");
  const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const t = await res.text();
  if (saveDir) writeFileSync(path.join(saveDir, `${name}.json`), t);
  return t;
}

const sha = createHash("sha256");
const hsha = createHash("sha256");

const meta = JSON.parse(await text("cms-metastore", CMS_METASTORE));
const cms = [];
for (let page = 0; page < 10; page++) {
  const url = cmsPageUrl(page * CMS_PAGE);
  if (CMS_DENY.test(url)) throw new Error("the CMS query names a denied column");
  const t = await text(`cms-${page}`, url);
  sha.update(t);
  const j = JSON.parse(t);
  cms.push(...j.results);
  if (j.results.length < CMS_PAGE || cms.length >= j.count) break;
}

const layer = JSON.parse(await text("hifld-layer", `${HIFLD_JOIN_URL}?f=json`));
const edit = layer?.editingInfo?.dataLastEditDate;
const hifld = [];
for (let page = 0; page < 10; page++) {
  const qs = new URLSearchParams({ where: "1=1", outFields: HIFLD_JOIN_FIELDS.join(","), returnGeometry: "false", orderByFields: "FID", resultRecordCount: "2000", resultOffset: String(page * 2000), f: "json" });
  const t = await text(`hifld-${page}`, `${HIFLD_JOIN_URL}/query?${qs}`);
  hsha.update(t);
  const j = JSON.parse(t);
  hifld.push(...j.features.map((f) => f.attributes));
  if (!j.exceededTransferLimit && j.features.length < 2000) break;
}

const bake = bakeCms(cms, hifld, {
  cmsModified: typeof meta.modified === "string" ? meta.modified : null,
  hifldDataLastEdit: typeof edit === "number" ? new Date(edit).toISOString().slice(0, 10) : null,
  sha256: { cms: sha.digest("hex"), hifld: hsha.digest("hex") },
});
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const out = path.join(root, flag("--out") ?? "lib/infra/data/cms-hospitals.json");
if (!existsSync(path.dirname(out))) mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(bake) + "\n");
const m = bake.meta;
console.log(`cms: ${m.cmsRows} rows (${m.cmsDistinctCcn} CCNs, modified ${m.cmsModified}); hifld: ${m.hifldRows} rows (edited ${m.hifldDataLastEdit}); attached ${m.attached} (${m.attachedOpen} open, ${m.attachedOpenRated} open and rated, ${m.attachedClosed} not open); ${m.sharedKeys} shared-address keys refused`);
