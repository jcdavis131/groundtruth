// What a snapshot's records may be embedded or trained on, derived from eye's own rules. Plain Node, no install
// (node 22.18 or later: it imports eye's embedFields.ts with Node's built-in type stripping).
//
//   node data/schema/embeddable.mjs <collection>                      print {embeddableFields, embeddableName}
//   node data/schema/embeddable.mjs --backfill <manifest.json> ...    write both into existing manifests
//
// A manifest's `embeddableFields` lists the `details` keys eye agrees to embed for its collection, and
// `embeddableName` says when the record's `name` may be embedded. Both come from eye's EMBED_TEXT and
// PUBLIC_NAME_RULE (apps/map/lib/catalog/embedFields.ts), never by hand. A consumer embeds or trains on a record's
// `text`, the `details` keys in `embeddableFields`, and `name` only where `embeddableName` allows it. Everything
// else in `details` is for display and citation (data/SCHEMA.md, "What may be embedded").
//
// EMBED_TEXT names upstream fields (PRIMARY_PURPOSE); a snapshot's `details` uses eye's display keys ("primary
// purpose"). DETAILS_KEY is the bridge, read from each builder named below. It is the one reviewed table here:
// it says which details key carries each EMBED_TEXT field, or null when no details key carries that field alone.
// The derivation fails when EMBED_TEXT gains or loses a field the table doesn't cover, so a change to eye's
// embedding allowlist can't reach a manifest without a review of this table.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { EMBED_TEXT, PUBLIC_NAME_RULE, embeddableField } from "../../apps/map/lib/catalog/embedFields.ts";

/** The details key that carries each EMBED_TEXT field, per collection the snapshot builder knows. */
export const DETAILS_KEY = {
  // lib/infra/features.ts (the dams builder's details and its recordText call)
  "nid-dams": {
    PRIMARY_PURPOSE: "primary purpose",
    PRIMARY_DAM_TYPE: "dam type",
    HAZARD_POTENTIAL: "hazard potential",
    CONDITION_ASSESSMENT: "condition assessment",
    COUNTYSTATE: "county",
    STATE: "state",
    YEAR_COMPLETED: "year completed",
  },
  // lib/civic/schools.ts. GSLO and GSHI are both in "grades". LCITY and LSTATE appear only inside "address",
  // which also holds the street, so no details key carries them; the record text does.
  "nces-public-schools": {
    SCHOOL_LEVEL: "level",
    SCHOOL_TYPE_TEXT: "type",
    CHARTER_TEXT: "charter",
    VIRTUAL: "virtual",
    SY_STATUS_TEXT: "status",
    ULOCALE: "locale",
    GSLO: "grades",
    GSHI: "grades",
    LCITY: null,
    NMCNTY: "county",
    LSTATE: null,
  },
  // lib/land/features.ts (the NRHP builder)
  "nrhp-listed": {
    ResType: "resource type",
    Is_NHL: "national historic landmark",
    CertDate: "listed",
    City: "city",
    County: "county",
    State: "state",
  },
};

/** `embeddableName` values: the record's name may be embedded only when its nameRule is public-name, or never. */
export const NAME_WHEN_PUBLIC = "when-nameRule-public-name";
export const NAME_NEVER = "never";

/** {embeddableFields, embeddableName} for a collection. Throws when eye's rules and DETAILS_KEY disagree. */
export function embeddableFor(collection) {
  const fields = EMBED_TEXT[collection];
  const map = DETAILS_KEY[collection];
  if (!fields) throw new Error(`${collection} is not a collection in eye's EMBED_TEXT`);
  if (!map) throw new Error(`${collection} has no DETAILS_KEY table in data/schema/embeddable.mjs`);
  const unmapped = fields.filter((f) => !Object.hasOwn(map, f));
  if (unmapped.length) throw new Error(`EMBED_TEXT["${collection}"] has ${unmapped.join(", ")}, which DETAILS_KEY doesn't map: review which details key carries it`);
  const stale = Object.keys(map).filter((f) => !fields.includes(f));
  if (stale.length) throw new Error(`DETAILS_KEY["${collection}"] maps ${stale.join(", ")}, which EMBED_TEXT no longer embeds`);
  const out = [];
  for (const f of fields) {
    const key = map[f];
    if (key === null) continue;
    if (!embeddableField(f) || !embeddableField(key)) throw new Error(`${collection}: ${f} -> ${JSON.stringify(key)} fails eye's embeddableField (deny list, published name or an unreviewed *name field)`);
    if (!out.includes(key)) out.push(key);
  }
  return { embeddableFields: out, embeddableName: Object.hasOwn(PUBLIC_NAME_RULE, collection) ? NAME_WHEN_PUBLIC : NAME_NEVER };
}

/** Problems when a manifest's embeddableFields or embeddableName differ from the derivation. Absent fields aren't checked here. */
export function embeddableProblems(m) {
  if (!m || typeof m !== "object" || (!("embeddableFields" in m) && !("embeddableName" in m))) return [];
  let want;
  try {
    want = embeddableFor(m.collection);
  } catch (e) {
    return [{ code: "embeddable", path: "/embeddableFields", message: e.message }];
  }
  const out = [];
  for (const k of ["embeddableFields", "embeddableName"])
    if (JSON.stringify(m[k]) !== JSON.stringify(want[k]))
      out.push({ code: "embeddable", path: `/${k}`, message: `${JSON.stringify(m[k] ?? null)} but eye's embedFields.ts gives ${JSON.stringify(want[k])} for ${m.collection} (run node data/schema/embeddable.mjs --backfill)` });
  return out;
}

/**
 * The manifest text with both fields set, every other byte kept: a field already there is replaced in place, a
 * missing one is appended after the last key, as the builders write it (two-space JSON).
 */
export function withEmbeddable(text) {
  const m = JSON.parse(text);
  const want = embeddableFor(m.collection);
  let out = text;
  for (const [k, v] of Object.entries(want)) {
    const body = JSON.stringify(v, null, 2).replace(/\n/g, "\n  ");
    const at = new RegExp(`\\n  "${k}": (\\[[^\\]]*\\]|"[^"]*")`);
    if (at.test(out)) out = out.replace(at, () => `\n  "${k}": ${body}`);
    else out = out.replace(/\n}\n?$/, () => `,\n  "${k}": ${body}\n}\n`);
  }
  const back = JSON.parse(out);
  if (JSON.stringify({ ...m, ...want }) !== JSON.stringify(back)) throw new Error("backfill changed more than the two fields");
  return out;
}

function main(argv) {
  if (argv[0] === "--backfill" && argv.length > 1) {
    for (const f of argv.slice(1)) {
      const text = readFileSync(f, "utf8");
      const next = withEmbeddable(text);
      if (next !== text) writeFileSync(f, next);
      console.log(`${next === text ? "same " : "wrote"} ${f}`);
    }
    return 0;
  }
  if (argv.length === 1 && !argv[0].startsWith("-")) {
    console.log(JSON.stringify(embeddableFor(argv[0])));
    return 0;
  }
  console.log("usage: node data/schema/embeddable.mjs <collection> | --backfill <manifest.json> ...");
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = main(process.argv.slice(2));
