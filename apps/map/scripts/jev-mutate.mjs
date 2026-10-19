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
// and box words in notes, the error sentence, upstream names, county or state).
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
    from: `text: isNull ? (it.note ? plainNote(it.note) : "the source states no value here")`,
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
    from: `  [/^the box ([\\d.]+) degrees around the county's Census internal point \\([^)]*\\)/, "counted within $1 degrees of the county's Census internal point"],\n`,
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
