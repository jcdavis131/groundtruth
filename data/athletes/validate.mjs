// Validator for athlete records (athlete/1). Plain Node, no install.
//
//   node data/athletes/validate.mjs <file.json | file.jsonl> ...
//
// An athlete record carries only the fields in allowlist.json: name, league, team, team city, arena, season,
// school, birthplace city, region and country, and the sources that cite them. It is the check behind Cam's
// 2026-10-18 decision ("Map + models, scoped"), written up in apps/map/docs/PEOPLE.md under Athletes.
//
// Checks, each reported as {code, path, message}:
//   field        a key that is not on the allowlist, at any depth (the record or a source entry)
//   denied       the same, when the key names something on the never-list (birth date, age, address,
//                family, contact, health); it fails either way, this code just names why
//   required     a required field is absent
//   type         a field is not a non-empty string (sources: a non-empty array of objects)
//   placeholder  a filler value: empty, null, n/a, tbd, unknown-as-filler and the rest of data/SCHEMA.md's list
//   shape        a value shaped like a date, a year standing alone, an age, an email, a phone number, a street
//                line, a PO box, a ZIP code or a coordinate (season, ids, URLs and retrievedAt excepted)
//   enum         league is not a professional league on the list
//   pattern      id, season, url or retrievedAt is malformed
//   needs        teamCity, arena or season without a team
//   uncited      a field no source entry lists, or a source listing a field the record does not carry
// Exit 0 when every input is valid, 1 otherwise, 2 on a usage error.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ALLOWLIST = JSON.parse(readFileSync(path.join(HERE, "allowlist.json"), "utf8"));

const FIELDS = ALLOWLIST.fields;
const SOURCE_FIELDS = ALLOWLIST.sourceFields;
const LEAGUES = new Set(ALLOWLIST.leagues);
const DENIED = ALLOWLIST.denied.keyParts;
/** The fields a source entry may cite: every record field but the record's own bookkeeping. */
export const CITABLE = Object.keys(FIELDS).filter((k) => !["schemaVersion", "id", "sources"].includes(k));

// data/SCHEMA.md, "Missing means absent" (origin/data-spec), trimmed and compared in lower case.
const PLACEHOLDERS = new Set([
  "", "null", "nil", "undefined", "nan", "n/a", "na", "tbd", "todo", "placeholder", "lorem ipsum", "-", "--", "?", "xxx",
  "missing", "unknown", "none",
]);

const MONTHS = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
// Shapes that mean a never-list value got into an allowed field. Run on every string but the exempt ones.
const SHAPES = [
  ["date", /\b\d{4}-\d{1,2}-\d{1,2}\b|\b\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\b/],
  ["date", new RegExp(`\\b(?:${MONTHS})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}\\b|\\b\\d{1,2}\\s+(?:${MONTHS})\\.?,?\\s+\\d{4}\\b`, "i")],
  ["year", /(?<![\w-])(?:19|20)\d{2}(?![\w-])/],
  ["age", /\b(?:age[ds]?|aged)\s*:?\s*\d{1,2}\b|\b\d{1,2}\s*(?:years?|yrs?)[\s-]*old\b|\b\d{1,2}\s*y\/?o\b/i],
  ["email", /[^\s@]+@[^\s@]+\.[a-z]{2,}/i],
  ["phone", /\+?\d[\d\s().-]{7,}\d/],
  ["street", /\b\d{1,6}\s+(?:[NSEW]\.?\s+)?[A-Za-z0-9.' -]*?\b(?:st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|way|ct|court|pl|place|ter|terrace|pkwy|parkway|hwy|highway|cir|circle)\b\.?/i],
  ["po box", /\bp\.?\s*o\.?\s*box\b/i],
  ["zip", /(?<![\w-])\d{5}(?:-\d{4})?(?![\w-])/],
  ["coordinate", /-?\d{1,3}\.\d{3,}/],
];

const ID = /^[a-z][a-z0-9-]*:[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const SEASON = /^\d{4}(?:-\d{2})?$/;
const URL_RE = /^https:\/\/[^\s]+$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
/** True when a timestamp's date is a day that exists (Date.parse rolls 02-31 over to March). */
const realDay = (t) => {
  const d = new Date(t);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === t.slice(0, 10);
};
const norm = (k) => k.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The never-list part a key matches, or undefined. Only asked of keys that are not on the allowlist. */
export function deniedPart(key) {
  const k = norm(key);
  return DENIED.find((p) => k.includes(p));
}

function keyProblems(obj, allowed, at, out) {
  for (const k of Object.keys(obj)) {
    if (Object.hasOwn(allowed, k)) continue;
    const part = deniedPart(k);
    if (part) out.push({ code: "denied", path: `${at}/${k}`, message: `${k} is on the never-list (${part}); athlete records never carry it` });
    else out.push({ code: "field", path: `${at}/${k}`, message: `${k} is not on the athlete allowlist` });
  }
  for (const [k, spec] of Object.entries(allowed)) {
    if (spec.required && !(k in obj)) out.push({ code: "required", path: `${at}/${k}`, message: `missing ${k}` });
  }
}

/** Problems with one string value: placeholder, then the never-list shapes unless exempt. */
function valueProblems(v, at, out, { shapes = true } = {}) {
  if (typeof v !== "string" || v.trim() === "") {
    out.push({ code: typeof v === "string" ? "placeholder" : "type", path: at, message: typeof v === "string" ? "empty string" : `expected a non-empty string, got ${v === null ? "null" : typeof v}` });
    return;
  }
  if (PLACEHOLDERS.has(v.trim().toLowerCase())) {
    out.push({ code: "placeholder", path: at, message: `${JSON.stringify(v)} is a filler, not a value; leave the field out` });
    return;
  }
  if (!shapes) return;
  for (const [what, re] of SHAPES) {
    if (re.test(v)) {
      out.push({ code: "shape", path: at, message: `looks like a ${what}` });
      return;
    }
  }
}

/** Every problem with one athlete record; empty when it is valid. */
export function validateAthlete(rec) {
  const out = [];
  if (!isObject(rec)) return [{ code: "type", path: "/", message: "an athlete record is a JSON object" }];
  keyProblems(rec, FIELDS, "", out);

  for (const [k, v] of Object.entries(rec)) {
    if (!Object.hasOwn(FIELDS, k) || k === "sources") continue;
    if (k === "schemaVersion") {
      if (v !== ALLOWLIST.schemaVersion) out.push({ code: "const", path: "/schemaVersion", message: `expected ${JSON.stringify(ALLOWLIST.schemaVersion)}` });
      continue;
    }
    const before = out.length;
    valueProblems(v, `/${k}`, out, { shapes: !["id", "season"].includes(k) });
    if (out.length > before) continue;
    if (k === "id" && !ID.test(v)) out.push({ code: "pattern", path: "/id", message: "expected <source>:<league id>, e.g. nba:<PERSON_ID>" });
    if (k === "season" && !SEASON.test(v)) out.push({ code: "pattern", path: "/season", message: "expected 2025 or 2025-26" });
    if (k === "league" && !LEAGUES.has(v)) out.push({ code: "enum", path: "/league", message: `expected one of ${[...LEAGUES].join(", ")}` });
  }

  for (const [k, spec] of Object.entries(FIELDS)) {
    if (spec.needs && k in rec && !(spec.needs in rec)) out.push({ code: "needs", path: `/${k}`, message: `${k} describes a team; it needs ${spec.needs}` });
  }

  const cited = new Set();
  if ("sources" in rec) {
    const s = rec.sources;
    if (!Array.isArray(s) || s.length === 0) out.push({ code: "type", path: "/sources", message: "expected a non-empty array: every record cites its source" });
    else {
      s.forEach((src, i) => {
        const at = `/sources/${i}`;
        if (!isObject(src)) {
          out.push({ code: "type", path: at, message: "a source entry is a JSON object" });
          return;
        }
        keyProblems(src, SOURCE_FIELDS, at, out);
        for (const k of ["sourceId", "upstreamId"]) if (k in src) valueProblems(src[k], `${at}/${k}`, out, { shapes: false });
        if ("url" in src) {
          const before = out.length;
          valueProblems(src.url, `${at}/url`, out, { shapes: false });
          if (out.length === before && !URL_RE.test(src.url)) out.push({ code: "pattern", path: `${at}/url`, message: "expected an https URL" });
        }
        if ("retrievedAt" in src) {
          const before = out.length;
          valueProblems(src.retrievedAt, `${at}/retrievedAt`, out, { shapes: false });
          if (out.length === before && (!UTC.test(src.retrievedAt) || !realDay(src.retrievedAt)))
            out.push({ code: "pattern", path: `${at}/retrievedAt`, message: "expected ISO 8601 UTC ending in Z" });
        }
        if ("fields" in src) {
          const f = src.fields;
          if (!Array.isArray(f) || f.length === 0) out.push({ code: "type", path: `${at}/fields`, message: "expected a non-empty array of field names" });
          else
            f.forEach((name, j) => {
              if (!CITABLE.includes(name)) out.push({ code: "uncited", path: `${at}/fields/${j}`, message: `${JSON.stringify(name)} is not a field a source can cite` });
              else if (!(name in rec)) out.push({ code: "uncited", path: `${at}/fields/${j}`, message: `${name} is cited but the record does not carry it` });
              else cited.add(name);
            });
        }
      });
    }
  }
  for (const k of CITABLE) {
    if (k in rec && !cited.has(k)) out.push({ code: "uncited", path: `/${k}`, message: `no source entry cites ${k}` });
  }
  return out;
}

/** Records in a .json (one object or an array) or .jsonl file, each with where it came from. */
export function readRecords(file) {
  const text = readFileSync(file, "utf8");
  if (file.endsWith(".jsonl")) {
    return text
      .split("\n")
      .map((line, i) => ({ line, where: `${file}:${i + 1}` }))
      .filter(({ line }) => line.trim() !== "")
      .map(({ line, where }) => ({ rec: JSON.parse(line), where }));
  }
  const v = JSON.parse(text);
  return (Array.isArray(v) ? v : [v]).map((rec, i) => ({ rec, where: Array.isArray(v) ? `${file}[${i}]` : file }));
}

function main(files) {
  if (files.length === 0) {
    console.error("usage: node data/athletes/validate.mjs <file.json | file.jsonl> ...");
    return 2;
  }
  let bad = 0;
  let n = 0;
  for (const file of files) {
    let recs;
    try {
      recs = readRecords(file);
    } catch (e) {
      console.log(`${file}: unreadable: ${e.message}`);
      bad++;
      continue;
    }
    const ids = new Set();
    for (const { rec, where } of recs) {
      n++;
      const errs = validateAthlete(rec);
      if (isObject(rec) && typeof rec.id === "string") {
        if (ids.has(rec.id)) errs.push({ code: "duplicate", path: "/id", message: `${rec.id} appears twice in this file` });
        ids.add(rec.id);
      }
      for (const e of errs) console.log(`${where}: ${e.code} ${e.path} ${e.message}`);
      if (errs.length) bad++;
    }
  }
  console.log(`${n} record(s), ${bad} invalid`);
  return bad ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
