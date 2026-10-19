// B0 run 5: rebuild every record of records-corpus.json through the changed builders (record text =
// card head, public name where PUBLIC_NAME_RULE allows, place, then the card's fields).
//
//   fixtures: recordFixtures(), as every earlier run.
//   live:     the same keyless requests as before, re-asked with the logged URLs
//             (records-eval/pull-log-run2.json for the 8 live cards of run 2, run3/pull-log-run3.json for WRC).
//
// Same-rows check (as run 4): for each source, the new texts with B0's added segments removed must equal
// the corpus's texts for that (card, source) as a multiset (segments compared in any order, since B0
// moves the place forward). Each new record keeps that old text as prevText, so the judged blind pool
// can be carried over. A box that drifted is logged, not thrown; its records keep prevText null.
//
// Saves only {card, source, retrievedAt, embedText, prevText} and each request URL: no ids, geometry,
// or any field outside record text.
//
//   npx vite-node -c vitest.config.ts <this> <worktree> <records-eval dir> <outDir>
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { recordFixtures } from "@/lib/embed/__fixtures__/records";
import { buildDams } from "@/lib/infra/features";
import { buildFloodZones, buildHistoric, buildPublicLands, buildWetlands } from "@/lib/land/features";
import { buildImpaired } from "@/lib/water/impaired";
import { buildHospitals } from "@/lib/infra/hospitals";
import { buildSchools } from "@/lib/civic/schools";
import { buildWrcPlaces } from "@/lib/hazards/wrc";
import { codedDomains, type ArcgisLayerInfo } from "@/lib/server/arcgis";
import type { LayerFeature } from "@/lib/layers/types";

const [root, evalDir, outDir] = process.argv.slice(2);
if (!outDir) throw new Error("usage: <worktree> <records-eval dir> <outDir>");
mkdirSync(outDir, { recursive: true });
const UA = { "user-agent": "gods-eye-view records-eval (read-only research pull)" };
const FIXTURE = "fixture (lib/embed/__fixtures__/records.ts, captured rows)";
type Row = { card: string; embedText: string; source: string; retrievedAt: string | null; n: number };
type Rec = { card: string; source: string; retrievedAt: string | null; embedText: string; prevText: string | null };

const corpus: Row[] = JSON.parse(readFileSync(path.join(root, "lib/embed/__eval__/records-corpus.json"), "utf8"));
const textOf = (f: LayerFeature) => ((f.properties.extra as { embedText?: string } | undefined)?.embedText ?? null);

/** Labels B0 added, per card (always the head and "name"). */
const ADDED: Record<string, string[]> = {
  "hifld-hospitals": ["city"],
  "nces-public-schools": ["city", "county"],
  "nid-dams": ["county"],
  "npl-boundaries": ["city"],
  "fuds-properties": ["closest city"],
};
function strip(card: string, t: string): string {
  const drop = new Set(["collection", "agency", "name", ...(ADDED[card] ?? [])]);
  return t
    .split("; ")
    .filter((s) => !drop.has(s.slice(0, s.indexOf(": "))))
    .sort()
    .join("; ");
}
const canon = (t: string) => t.split("; ").sort().join("; ");

const out: Rec[] = [];
const log: unknown[] = [];

function take(card: string, source: string, at: string | null, features: LayerFeature[], extra: Record<string, unknown> = {}) {
  const texts = features.map(textOf).filter((t): t is string => t != null);
  const old = corpus.filter((r) => r.card === card && r.source === source);
  // old canonical text -> remaining count and its exact old text
  const pool = new Map<string, { text: string; left: number }>();
  for (const r of old) {
    const k = canon(r.embedText);
    const e = pool.get(k);
    if (e) e.left += r.n;
    else pool.set(k, { text: r.embedText, left: r.n });
  }
  const oldN = old.reduce((s, r) => s + r.n, 0);
  let matched = 0;
  const recs: Rec[] = texts.map((t) => {
    const e = pool.get(strip(card, t));
    if (e && e.left > 0) {
      e.left--;
      matched++;
      return { card, source, retrievedAt: at, embedText: t, prevText: e.text };
    }
    return { card, source, retrievedAt: at, embedText: t, prevText: null };
  });
  const same = texts.length === oldN && matched === oldN;
  log.push({ card, source, retrievedAt: at, records: texts.length, corpusRecords: oldN, matchedToCorpus: matched, sameRowsAsCorpus: same, ...extra });
  console.log(card, source, texts.length, "records;", "corpus", oldN, "matched", matched, same ? "SAME" : "DRIFT");
  out.push(...recs);
}

async function get(url: string): Promise<any> {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(90_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(JSON.stringify(j.error));
  return j;
}

function bboxOf(url: string): [number, number, number, number] {
  const g = JSON.parse(new URL(url).searchParams.get("geometry")!);
  return [g.xmin, g.ymin, g.xmax, g.ymax];
}

const LABELS: Record<string, string[]> = {
  "nid-dams": ["pittsburgh-pa", "flint-hills-ks", "sierra-foothills-ca"],
  "padus-units": ["front-range-co", "everglades-fl"],
  "fema-nfhl-zones": ["galveston-tx", "kansas-city-mo"],
  "nwi-wetlands": ["chesapeake-md", "prairie-nd"],
  "nrhp-listed": ["charleston-sc", "santa-fe-nm"],
  "attains-impaired": ["columbus-oh", "puget-wa"],
  "hifld-hospitals": ["pittsburgh-pa", "kansas-city-mo", "central-montana"],
  "nces-public-schools": ["columbus-oh", "santa-fe-nm", "dodge-city-ks"],
  "wrc-communities": ["sierra-foothills-ca", "santa-fe-nm", "pittsburgh-pa", "central-montana"],
};

async function main() {
  // PAD-US and NFHL fixtures are written test rows, not captured; no run put them in the corpus.
  for (const g of recordFixtures()) if (g.captured) take(g.card, FIXTURE, null, g.features);

  const run2: Array<{ card: string; url: string; rows: number }> = JSON.parse(readFileSync(path.join(evalDir, "pull-log-run2.json"), "utf8"));
  const run3: Array<{ card: string; url: string; rows: number }> = JSON.parse(readFileSync(path.join(evalDir, "run3/pull-log-run3.json"), "utf8"));
  const domainsEntry = run2.find((l) => l.card === "padus-units" && l.url.endsWith("?f=json"))!;
  const domains = codedDomains((await get(domainsEntry.url)) as ArcgisLayerInfo);
  const entries = [...run2.filter((l) => !l.url.endsWith("?f=json")), ...run3.filter((l) => l.card === "wrc-communities")];
  const seen: Record<string, number> = {};
  for (const l of entries) {
    const i = (seen[l.card] = (seen[l.card] ?? -1) + 1);
    const label = LABELS[l.card]?.[i];
    if (!label) throw new Error(`no label for ${l.card} #${i}`);
    const at = new Date().toISOString();
    let features: LayerFeature[];
    let rows = 0;
    try {
      const j = await get(l.url);
      rows = j.features.length;
      switch (l.card) {
        case "nid-dams": features = buildDams(j.features); break;
        case "padus-units": features = buildPublicLands(j.features, domains, { box: bboxOf(l.url), minDeg: 0.0005 }); break;
        case "fema-nfhl-zones": features = buildFloodZones(j.features); break;
        case "nwi-wetlands": features = buildWetlands(j.features, []); break;
        case "nrhp-listed": features = buildHistoric(j.features, "point"); break;
        case "attains-impaired": features = buildImpaired(j.features, "line"); break;
        case "hifld-hospitals": features = buildHospitals(j.features); break;
        case "nces-public-schools": features = buildSchools(j.features).features; break;
        case "wrc-communities": features = buildWrcPlaces(j.features, 0, "national"); break;
        default: throw new Error(`no builder for ${l.card}`);
      }
    } catch (e) {
      log.push({ card: l.card, source: `keyless pull: ${label}`, url: l.url, retrievedAt: at, error: String(e) });
      console.log(l.card, label, "ERROR", String(e));
      continue;
    }
    take(l.card, `keyless pull: ${label}`, at, features, { url: l.url, rows, loggedRows: l.rows });
  }
  writeFileSync(path.join(outDir, "new-records.json"), JSON.stringify(out));
  writeFileSync(path.join(outDir, "pull-log-run5.json"), JSON.stringify(log, null, 1));
  console.log("total", out.length, "with prevText", out.filter((r) => r.prevText != null).length, "distinct", new Set(out.map((r) => `${r.card}|${r.embedText}`)).size);
}
main();
