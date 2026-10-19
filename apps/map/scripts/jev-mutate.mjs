#!/usr/bin/env node
// The Ask Jev panel's mutation proof: one deliberate break per rule, so we
// know each test bites. scripts/jev-mutations.sh applies each break, runs the
// Jev tests, records killed (a test failed) or survived (all passed), and
// restores the file with git checkout. CI runs it (.github/workflows/jev-mutations.yml).
//
// Rules covered (writeups jev-2026-10-18): ASK-PANEL-DATA-AUDIT.md (null
// value -> note, a gap is never 0, the source link's fallback, the per-topic
// marker, no panel-wide badge, reduced motion), ASK-PANEL-PLAIN-TEXT.md (every
// gap pattern row, the SEC note, the glossary and first use), the first
// review's follow-ups (cuts, trimmed reply, NID id, census and borough types,
// visible notes, the live region, Escape and its propagation, the scroll under
// reduced motion) and the second review's five fixes (parameter codes, route
// and box words in notes, the error sentence, upstream names, county or state),
// then the hallway-test polish (where a live count was made, the county's
// middle in kilometres, the D0-D4 and ng/L glosses, magnitudes in words, open
// water, Point details, the county water sentence), a break for each note
// rewrite the second review listed without one, and the second hallway pass
// (county labels say the county's middle, the state's middle, the water
// system's place and publisher, counts with commas, the SVI scale, the drought
// and one-day window notes, the old Valdez-Cordova area, no nested brackets,
// kilometres by latitude).
//
// Each break is an exact string swap (no regex), so an anchor that no longer
// matches the code fails loudly instead of passing for free.
//
//   node scripts/jev-mutate.mjs --list          names, one per line
//   node scripts/jev-mutate.mjs --check         every anchor present exactly once? (exit 1 if not)
//   node scripts/jev-mutate.mjs --rule <name>   the rule a break tests
//   node scripts/jev-mutate.mjs <name>          apply one break (exit 3 if its anchor is missing)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const PLAIN = "lib/jev/plain.ts";
const FORMAT = "lib/jev/format.ts";
const GLOSSARY = "lib/jev/glossary.ts";
const FOCUS = "lib/jev/focus.ts";
const ASK = "lib/jev/ask.ts";
const ANSWER = "components/hud/JevAnswer.tsx";
const PANEL = "components/hud/AskJevPanel.tsx";

/** A gap pattern row that never matches: its test regex becomes /(?!)/ (the old one is kept as an unused field). */
const ruleOff = (id) => ({
  name: `gap-rule-${id}`,
  rule: `plain text: gap pattern row "${id}"`,
  file: PLAIN,
  from: `id: "${id}",\n    test: /`,
  to: `id: "${id}",\n    test: /(?!)/, t0: /`,
});

const GAP_RULE_IDS = [
  "state-or-county-only",
  "fabric-per-point",
  "upstream-failed",
  "ct-legacy-counties",
  "alaska-forecast-zones",
  "boundary-changed",
  "sec-sample",
  "no-county",
  "no-water-service-area",
  "no-value-or-rent-index",
  "no-metro",
  "no-scheduled-release",
  "no-elevation",
  "ct-planning-regions",
];

export const MUTANTS = [
  // ASK-PANEL-DATA-AUDIT.md
  {
    name: "null-value-as-0",
    rule: "audit: a null value renders its note, never 0",
    file: FORMAT,
    from: `text: isNull ? (it.note ? plainNote(it.note, lat) : "the source states no value here")`,
    to: `text: isNull ? "0"`,
  },
  {
    name: "gap-as-0",
    rule: "audit: a gap is a sentence, never 0",
    file: ANSWER,
    from: `gaps: s.gaps.map((gap) => g.gloss(gap.sentence)),`,
    to: `gaps: s.gaps.map(() => g.gloss("0")),`,
  },
  {
    name: "no-link-fallback",
    rule: "audit: source link is upstreamRecordUrl, else link",
    file: FORMAT,
    from: `return it.upstreamRecordUrl || it.link;`,
    to: `return it.upstreamRecordUrl ?? "";`,
  },
  {
    name: "marker-every-topic",
    rule: "audit: partial marker only on topics with missing[]",
    file: FORMAT,
    from: `marker: gaps.length ? `,
    to: `marker: true ? `,
  },
  {
    name: "panel-wide-badge",
    rule: "audit: no panel-wide partial badge",
    file: ANSWER,
    from: `<div data-jev-answer="">`,
    to: `<div data-jev-answer=""><span data-jev-badge="">partial</span>`,
  },
  {
    name: "reduced-motion-ignored",
    rule: "audit: no animation under reduced motion",
    file: ANSWER,
    from: `  if (reducedMotion) return { className: "" };\n`,
    to: ``,
  },
  // ASK-PANEL-PLAIN-TEXT.md: every pattern row, then the notes and the glossary
  ...GAP_RULE_IDS.map(ruleOff),
  {
    name: "sec-note-unrewritten",
    rule: "plain text: the SEC fixture note becomes plain words",
    file: PLAIN,
    from: `  [/within eye's SEC bundle \\(a committed fixture, pulled: null\\)/g, "from the sample of SEC filers we hold, not every company"],\n`,
    to: ``,
  },
  {
    name: "glossary-entry-missing",
    rule: "plain text: every acronym has a glossary entry (NWS removed)",
    file: GLOSSARY,
    from: `  NWS: "National Weather Service",\n`,
    to: ``,
  },
  {
    name: "glossary-no-first-use",
    rule: "plain text: an acronym is spelled out on first use",
    file: GLOSSARY,
    from: `first: !this.seen.has(w)`,
    to: `first: false`,
  },
  // First review's follow-ups
  {
    name: "cuts-dropped",
    rule: "follow-up a: lists cut at max_records say so",
    file: PLAIN,
    from: `if (m) out.push(`,
    to: `if (m && false) out.push(`,
  },
  {
    name: "truncated-dropped",
    rule: "follow-up a: a trimmed reply says so once",
    file: FORMAT,
    from: `return b.truncated ? truncatedSentence(b.truncated) : null;`,
    to: `return null;`,
  },
  {
    name: "nid-id-dropped",
    rule: "follow-up b: a private dam's line shows its NID id",
    file: FORMAT,
    from: `if (isNull && it.code?.startsWith("nid:"))`,
    to: `if (false && isNull && it.code?.startsWith("nid:"))`,
  },
  {
    name: "census-type-dropped",
    rule: "follow-up c: Nominatim type census asked by county FIPS",
    file: ASK,
    from: `census: "county", `,
    to: ``,
  },
  {
    name: "borough-type-dropped",
    rule: "follow-up c: Nominatim type borough asked by county FIPS",
    file: ASK,
    from: `borough: "county", `,
    to: ``,
  },
  {
    name: "note-hidden",
    rule: "follow-up d: notes beside values are visible text",
    file: ANSWER,
    from: `{r.note && (`,
    to: `{false && r.note && (`,
  },
  {
    name: "aria-live-whole-panel",
    rule: "follow-up e: aria-live wraps only the status line",
    file: PANEL,
    from: `aria-busy={status === "loading"}`,
    to: `aria-busy={status === "loading"}\n      aria-live="polite"`,
  },
  {
    name: "escape-key-wrong",
    rule: "follow-up f: Escape closes the panel",
    file: FOCUS,
    from: `return key === "Escape";`,
    to: `return key === "Esc";`,
  },
  {
    name: "escape-propagates",
    rule: "follow-up f: Escape stops propagation",
    file: FOCUS,
    from: `    e.stopPropagation();\n`,
    to: ``,
  },
  {
    name: "smooth-scroll-reduced",
    rule: "follow-up g: instant scroll under reduced motion",
    file: FOCUS,
    from: `behavior: reducedMotion ? "auto" : "smooth"`,
    to: `behavior: "smooth"`,
  },
  // Second review's five fixes
  {
    name: "fix1-tavg-unmapped",
    rule: "fix 1: tavg reads as average temperature",
    file: PLAIN,
    from: `tavg: "average temperature", `,
    to: ``,
  },
  {
    name: "fix1-pcp-unmapped",
    rule: "fix 1: pcp reads as precipitation",
    file: PLAIN,
    from: `pcp: "precipitation"`,
    to: ``,
  },
  {
    name: "fix1-code-kept",
    rule: "fix 1: trailing lowercase codes leave what/publisher",
    file: PLAIN,
    from: `const TRAILING_CODE = /\\s*\\(([a-z][a-z0-9_]*)\\)$/;`,
    to: `const TRAILING_CODE = /(?!)/;`,
  },
  {
    name: "fix2-route-note",
    rule: "fix 2: notes never say the route's records",
    file: PLAIN,
    from: `  [/^no record-level URL: a count of the route's records inside this box$/, "counted inside that area"],\n`,
    to: ``,
  },
  {
    name: "fix2-exactly-this-box",
    rule: "fix 2: notes never say no URL for exactly this box",
    file: PLAIN,
    from: `  [/^.+? has no URL for exactly this box$/, "the source link opens the whole list, not this count"],\n`,
    to: ``,
  },
  {
    name: "fix2-matched-to-box",
    rule: "fix 2: notes never say matched to this box here",
    file: PLAIN,
    from: `  [/^no record-level URL: a count over (.+?), matched to this box here$/, "counted from $1, inside that area"],\n`,
    to: ``,
  },
  {
    name: "fix2-box-tuple",
    rule: "fix 2: notes never show a box's corner numbers",
    file: PLAIN,
    from: `  [BOX_TUPLE, ""],\n`,
    to: ``,
  },
  {
    name: "fix2-county-box-clause",
    rule: "fix 2: the county box clause is a plain sentence",
    file: PLAIN,
    from: "  [/^the box ([\\d.]+) degrees around the county's Census internal point \\([^)]*\\)/, (m, lat) => `counted near the middle of the county (${aboutKm(m[1], lat)})`],\n",
    to: ``,
  },
  {
    name: "fix3-raw-error",
    rule: "fix 3: the error path shows one plain sentence",
    file: PANEL,
    from: `          {JEV_ERROR_SENTENCE}`,
    to: `          {state.error}`,
  },
  {
    name: "fix4-usgs-id",
    rule: "fix 4: usgs-wbd reads as USGS",
    file: PLAIN,
    from: `  "usgs-wbd": "USGS",\n`,
    to: ``,
  },
  {
    name: "fix4-census-id",
    rule: "fix 4: census-tigerweb reads as the Census Bureau",
    file: PLAIN,
    from: `  "census-tigerweb": "the Census Bureau",\n`,
    to: ``,
  },
  {
    name: "fix4-id-fallback",
    rule: "fix 4: an unknown upstream id reads as One of the sources",
    file: PLAIN,
    from: `return Object.hasOwn(UPSTREAM_NAMES, k) ? UPSTREAM_NAMES[k] : SOME_SOURCE;`,
    to: `return Object.hasOwn(UPSTREAM_NAMES, k) ? UPSTREAM_NAMES[k] : idOrName || SOME_SOURCE;`,
  },
  {
    name: "fix5-always-county",
    rule: "fix 5: fabric-per-point says county or state by place kind",
    file: PLAIN,
    from: '${m[1] ?? "county or state"}',
    to: "county",
  },
  // Hallway-test polish (2026-10-19): words a newcomer reads
  {
    name: "polish1-fact-box",
    rule: "polish 1: a fact label never says touching the box",
    file: PLAIN,
    from: `.replace(/touching the box/g, `,
    to: `.replace(/(?!)/g, `,
  },
  {
    name: "polish1-fact-never-county",
    rule: "polish 1: a county's live count says near the middle of this county",
    file: PLAIN,
    from: `kind === "county" ? "near the middle of this county" : "near this place"`,
    to: `"near this place"`,
  },
  {
    name: "polish2-eye-reads-directly",
    rule: "polish 2: the population note never says eye reads",
    file: PLAIN,
    from: `  [/, not a Census table eye reads directly/g, ", not a Census table"],\n`,
    to: ``,
  },
  {
    name: "polish2-null-not-0",
    rule: "polish 2: a note never says null, not 0",
    file: PLAIN,
    from: `  [/: null, not 0$/, ""],\n`,
    to: ``,
  },
  {
    name: "polish3-within-internal-point",
    rule: "polish 3: within 0.25 degrees of the internal point reads near the middle of the county",
    file: PLAIN,
    from: "  [/\\bwithin ([\\d.]+) degrees of the county's Census internal point/g, (m, lat) => `near the middle of the county (${aboutKm(m[1], lat)})`],\n",
    to: ``,
  },
  {
    name: "polish3-internal-point-anywhere",
    rule: "polish 3: the county's Census internal point reads the middle of the county",
    file: PLAIN,
    from: `  [/the county's Census internal point/g, "the middle of the county"],\n`,
    to: ``,
  },
  {
    name: "polish3-degrees-not-km",
    rule: "polish 3: degrees become rough kilometres",
    file: PLAIN,
    from: "return `about ${Math.round(Math.min(ns, ew))} km`;",
    to: "return `about ${degrees} degrees`;",
  },
  {
    name: "polish3-subtitle-internal-point",
    rule: "polish 3: the subtitle says centred on the middle of the county",
    file: PLAIN,
    from: `return "centred on the middle of the county";`,
    to: `return "centred on Census's internal point for the county";`,
  },
  {
    name: "polish3-fact-names-not-copied",
    rule: "polish 3: a fact drops names are not copied",
    file: PLAIN,
    from: `    .replace(/;\\s*names are not copied/g, "")\n`,
    to: ``,
  },
  {
    name: "polish3-note-names-not-copied",
    rule: "polish 3: a note drops names are not copied",
    file: PLAIN,
    from: `  [/,? names are not copied/g, ""],\n`,
    to: ``,
  },
  {
    name: "polish3-drought-unglossed",
    rule: "polish 3: Drought Monitor classes D0-D4 are glossed on first use",
    file: GLOSSARY,
    from: `const TERM_TOKEN = /\\bD[0-4]\\b|`,
    to: `const TERM_TOKEN = /`,
  },
  {
    name: "polish3-ngl-unglossed",
    rule: "polish 3: ng/L reads ng/L (parts per trillion) on first use",
    file: GLOSSARY,
    from: `  "ng/L": "parts per trillion",\n`,
    to: ``,
  },
  {
    name: "polish3-value-terms-unglossed",
    rule: "polish 3: terms are glossed inside a record's value",
    file: ANSWER,
    from: `: g.gloss(l.text, false),`,
    to: `: [l.text],`,
  },
  {
    name: "polish3-magnitude-code",
    rule: "polish 3: M4.5+ reads magnitude 4.5 or larger",
    file: PLAIN,
    from: `const MAGNITUDE = /\\bM(\\d+(?:\\.\\d+)?)\\+/g;`,
    to: `const MAGNITUDE = /(?!)/g;`,
  },
  {
    name: "polish4-ocean-bare-point",
    rule: "polish 4: a place with no name is titled Open water (lat, lon)",
    file: FORMAT,
    from: "return `Open water (${pt.lat.toFixed(1)}, ${pt.lon.toFixed(1)})`;",
    to: "return `${pt.lat.toFixed(4)}, ${pt.lon.toFixed(4)}`;",
  },
  {
    name: "polish5-place-fabric-what",
    rule: "polish 5: the what place fabric reads Point details",
    file: PLAIN,
    from: `  if (w === "place fabric") return "Point details";\n`,
    to: ``,
  },
  {
    name: "polish6-water-county-spot",
    rule: "polish 6: no water service area for a county says the middle of this county",
    file: PLAIN,
    from: `m[1] ? "the middle of this county" : "this spot"`,
    to: `"this spot"`,
  },
  // Second hallway pass (2026-10-19)
  {
    name: "hallway2-county-fact-overclaims",
    rule: "hallway 2.1: a county's live count says near the middle of this county, not in this county",
    file: PLAIN,
    from: `kind === "county" ? "near the middle of this county" : "near this place"`,
    to: `kind === "county" ? "in this county" : "near this place"`,
  },
  {
    name: "hallway2-state-representative-point",
    rule: "hallway 2.2: a state's subtitle says centred on the middle of the state",
    file: PLAIN,
    from: `return "centred on the middle of the state";`,
    to: `return "centred on the state's representative point";`,
  },
  {
    name: "hallway2-water-county-point",
    rule: "hallway 2.3: a county's water system is at the middle of this county",
    file: PLAIN,
    from: `kind === "county" ? "community water system at the middle of this county"`,
    to: `kind === "county" ? "community water system serving the point"`,
  },
  {
    name: "hallway2-water-spot-point",
    rule: "hallway 2.3: a point's water system is serving this spot",
    file: PLAIN,
    from: `kind === "point" ? "community water system serving this spot"`,
    to: `kind === "point" ? "community water system serving the point"`,
  },
  {
    name: "hallway2-water-gap-no-kind",
    rule: "hallway 2.3: a gap's what names the water system's place by kind",
    file: FORMAT,
    from: `const what = plainWhat(m.what, kind);`,
    to: `const what = plainWhat(m.what);`,
  },
  {
    name: "hallway2-water-publisher",
    rule: "hallway 2.4: the water publisher reads U.S. EPA, with boundaries from states and water systems",
    file: PLAIN,
    from: `  [/^U\\.S\\. EPA; the original data provider of each polygon \\(.*\\)$/, "U.S. EPA, with boundaries from states and water systems"],\n`,
    to: ``,
  },
  {
    name: "hallway2-population-no-commas",
    rule: "hallway 2.5: population served 279000 reads 279,000",
    file: PLAIN,
    from: "  [/\\bpopulation served (\\d{4,})\\b/g, (m) => `population served ${withCommas(m[1])}`],\n",
    to: ``,
  },
  {
    name: "hallway2-commas-wrong",
    rule: "hallway 2.5: thousands separators every three digits from the right",
    file: PLAIN,
    from: `return digits.replace(/\\B(?=(\\d{3})+(?!\\d))/g, ",");`,
    to: `return digits.replace(/\\B(?=(\\d{3})(?!\\d))/g, ",");`,
  },
  {
    name: "hallway2-svi-raw",
    rule: "hallway 2.5: the SVI value reads 0.83 (0 = least, 1 = most vulnerable among US counties)",
    file: FORMAT,
    from: `  if (scale) return scale;\n`,
    to: ``,
  },
  {
    name: "hallway2-svi-four-decimals",
    rule: "hallway 2.5: the SVI value has two decimals",
    file: PLAIN,
    from: "return m ? `${(v as number).toFixed(2)} (0 = least",
    to: "return m ? `${v as number} (0 = least",
  },
  {
    name: "hallway2-drought-none",
    rule: "hallway 2.5: the drought note says no drought, not none",
    file: PLAIN,
    from: `  [/^none (\\d+(?:\\.\\d+)?%)$/, "no drought $1"],\n`,
    to: ``,
  },
  {
    name: "hallway2-drought-shares-kept",
    rule: "hallway 2.5: the drought note drops shares as published",
    file: PLAIN,
    from: `, /^shares as published$/];`,
    to: `];`,
  },
  {
    name: "hallway2-one-day-window",
    rule: "hallway 2.5: a one-day window reads on that date",
    file: PLAIN,
    from: `  [/^window (\\d{4}-\\d{2}-\\d{2}) to \\1$/, "on $1"],\n`,
    to: ``,
  },
  {
    name: "hallway2-former-county-code",
    rule: "hallway 2.5: a former county code reads as the old Valdez-Cordova area",
    file: PLAIN,
    from: `  [/^filed by FEMA under the former county code (\\d{5})$/, (m) => formerArea(m[1])],\n`,
    to: ``,
  },
  {
    name: "hallway2-former-area-name",
    rule: "hallway 2.5: the old area is named, not only an old code",
    file: PLAIN,
    from: `  "02261": "Valdez-Cordova",\n`,
    to: ``,
  },
  {
    name: "hallway2-nested-gloss",
    rule: "hallway 2.6: an acronym alone in brackets is glossed inside them, never nested",
    file: GLOSSARY,
    from: `      if (inOwnParens(text, at, w)) seg.paren = true;\n`,
    to: ``,
  },
  {
    name: "hallway2-cbsa-gloss-repeats",
    rule: "hallway 2.6: CBSA's expansion does not repeat metro or micro area",
    file: GLOSSARY,
    from: `  CBSA: "Core-Based Statistical Area",`,
    to: `  CBSA: "Core-Based Statistical Area, a metro or micro area",`,
  },
  {
    name: "hallway2-km-flat",
    rule: "hallway 2.7: east-west kilometres shrink with latitude",
    file: PLAIN,
    from: `KM_PER_DEGREE * Math.abs(Math.cos((lat * Math.PI) / 180)) * d`,
    to: `KM_PER_DEGREE * d`,
  },
  {
    name: "hallway2-km-larger-axis",
    rule: "hallway 2.7: the smaller of north-south and east-west is said",
    file: PLAIN,
    from: `Math.round(Math.min(ns, ew))`,
    to: `Math.round(Math.max(ns, ew))`,
  },
  {
    name: "hallway2-km-no-latitude",
    rule: "hallway 2.7: each place's notes are measured at its own latitude",
    file: FORMAT,
    from: `toSection(k, topics[k], b.place?.kind, typeof lat === "number" ? lat : null)`,
    to: `toSection(k, topics[k], b.place?.kind, null)`,
  },
  // The second review's note rewrites that had no break of their own
  {
    name: "review-record-level-url",
    rule: "review: notes drop the no record-level URL: prefix",
    file: PLAIN,
    from: `  [/^no record-level URL:\\s*/, ""],\n`,
    to: ``,
  },
  {
    name: "review-http-403",
    rule: "review: HTTP 403 to a non-browser user agent reads blocks automated readers",
    file: PLAIN,
    from: `  [/blocks automated clients \\(HTTP 403 to a non-browser user agent, (checked [^)]*)\\)/g, "blocks automated readers ($1)"],\n`,
    to: ``,
  },
  {
    name: "review-hifld-id",
    rule: "review: a note drops the hifld-hosp: id",
    file: PLAIN,
    from: `  [/,? for hospital hifld-hosp:\\S+/g, ""],\n`,
    to: ``,
  },
  {
    name: "review-route-caveats",
    rule: "review: a note drops the route's caveats aside",
    file: PLAIN,
    from: `  [/ \\(the route's caveats say how that code relates to this county\\)/g, ""],\n`,
    to: ``,
  },
  {
    name: "review-publisher-snake-id",
    rule: "review: a publisher drops a bracketed id like (FEMA_HQ_Preparedness_NIC)",
    file: PLAIN,
    from: `return dropCode(q.replace(/\\s*\\([A-Za-z0-9]+(?:_[A-Za-z0-9]+)+\\)/g, "").trim());`,
    to: `return dropCode(q);`,
  },
  {
    name: "review-basis-api-route",
    rule: "review: a point's basis never shows an /api/ route",
    file: PLAIN,
    from: `.replace(/\\/api\\/\\S+/g, "this atlas")`,
    to: ``,
  },
];

function count(hay, needle) {
  let n = 0;
  for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + 1)) n++;
  return n;
}

function read(file) {
  return fs.readFileSync(path.join(APP, file), "utf8");
}

const [arg, name] = process.argv.slice(2);
const names = MUTANTS.map((m) => m.name);
if (new Set(names).size !== names.length) {
  console.error("duplicate mutant names");
  process.exit(2);
}

if (arg === "--list") {
  console.log(names.join("\n"));
} else if (arg === "--check") {
  let bad = 0;
  for (const m of MUTANTS) {
    const n = count(read(m.file), m.from);
    if (n !== 1) {
      console.error(`${m.name}: anchor found ${n} times in ${m.file}`);
      bad++;
    }
  }
  console.log(`${MUTANTS.length} mutants, ${bad} bad anchors`);
  process.exit(bad ? 1 : 0);
} else if (arg === "--rule") {
  const m = MUTANTS.find((x) => x.name === name);
  if (!m) process.exit(2);
  console.log(m.rule);
} else {
  const m = MUTANTS.find((x) => x.name === arg);
  if (!m) {
    console.error(`no mutant ${arg}`);
    process.exit(2);
  }
  const src = read(m.file);
  if (count(src, m.from) !== 1) {
    console.error(`${m.name}: anchor not found exactly once in ${m.file}`);
    process.exit(3);
  }
  const i = src.indexOf(m.from);
  fs.writeFileSync(path.join(APP, m.file), src.slice(0, i) + m.to + src.slice(i + m.from.length));
  console.log(`${m.name}: ${m.file}`);
}
