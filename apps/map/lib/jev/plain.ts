// The Ask Jev panel's person-facing words (writeups jev-2026-10-18:
// ASK-PANEL-PLAIN-TEXT.md). world_context writes its reasons and notes for
// agents ("pass a county FIPS", "(join:legacy_ct_counties)", "pulled: null"),
// and that is its first job, so the bundle is left as it is. The panel maps
// each known pattern to a fixed sentence here. No model writes anything.
//
// A reason no pattern matches is shown as the tool wrote it, and the fixture
// test fails and prints it, so every new pattern gets a row here.

/** One row of the pattern table: a test on the reason text and the sentence it becomes. */
interface GapRule {
  id: string;
  test: RegExp;
  /** The sentence, given the publisher named in the reason (or "The source" when it names none). */
  say: (publisher: string, m: RegExpExecArray) => string;
}

const STATE_OR_COUNTY_ONLY = "This is listed by county. Pick a county or a spot on the map to see it.";

/** Drop a leading "source-id: the route lists it as missing: " so the publisher's name comes first. */
function leadName(s: string): string {
  return s.replace(/^.*?the route lists it as missing:\s*/, "").trim();
}

/** The patterns, first match wins. Rows 1-13 are the spec's table; later rows were added after it (each says when). */
export const GAP_RULES: readonly GapRule[] = [
  {
    id: "state-or-county-only",
    test: /a state has no single water system|a state is too large for the record routes|not asked for a state|county-level\b.*\bonly|a state has no single metro/,
    say: () => STATE_OR_COUNTY_ONLY,
  },
  {
    id: "fabric-per-point",
    test: /the fabric is per point; call world_context with lon\/lat(?: \(the (county|state)'s point)?/,
    // The reason names the kind of place asked about: a state is a state, not a county.
    say: (_p, m) => `Elevation, flood zone and watershed need a spot on the map. Click inside the ${m[1] ?? "county or state"}.`,
  },
  {
    id: "upstream-failed",
    test: /^(?:(.*?) )?failed on this call/,
    say: (p) => `${capitalize(p)} didn't answer just now. Try again in a minute.`,
  },
  {
    id: "ct-legacy-counties",
    test: /lists Connecticut under its 8 legacy counties/,
    say: (p) => `${p} still files Connecticut under its 8 old counties, not the planning regions Census uses now, so nothing is filed under this region.`,
  },
  {
    id: "alaska-forecast-zones",
    test: /files Alaska by forecast zones/,
    say: (p) => `${p} files Alaska by weather zones, not counties, so there's no county count.`,
  },
  {
    id: "boundary-changed",
    test: /boundary changed after 2010/,
    say: (p) => `This county's boundary changed after 2010, so ${p}'s older figures don't fit it.`,
  },
  {
    id: "sec-sample",
    test: /eye's SEC bundle is a committed fixture/,
    say: () => "We hold only a sample of SEC filers, so we can't count the companies based here.",
  },
  {
    id: "no-county",
    test: /no county resolved|no county polygon at this point/,
    say: () => "This spot isn't inside any US county (open water, or outside the US).",
  },
  {
    id: "no-water-service-area",
    test: /\bno\b.*\bservice area contains( the county's Census internal point)?/,
    // A county is asked at its middle (Census's internal point), and the reason says so.
    say: (_p, m) => `No public water system's mapped area covers ${m[1] ? "the middle of this county" : "this spot"}. It may use a private well, or a system EPA hasn't mapped.`,
  },
  {
    id: "no-value-or-rent-index",
    test: /publishes no (?:value|rent index) for this place/,
    say: (p) => `${p} publishes no figure for this place.`,
  },
  {
    id: "no-metro",
    test: /none: this county is in no metropolitan/,
    say: () => "Not part of any metro or micro area.",
  },
  {
    id: "no-scheduled-release",
    test: /none of the sources\b.*\bscheduled release/,
    say: () => "No new data from these sources is scheduled in the next 30 days.",
  },
  {
    id: "no-elevation",
    test: /gave no elevation/,
    say: () => "USGS has no elevation for this spot.",
  },
  // Added 2026-10-19 with the panel's follow-up (the CT capitol fixture's identity gap; not in the spec's table).
  {
    id: "ct-planning-regions",
    test: /Census uses planning regions\b.*\bpublish only legacy counties/,
    say: () => "Connecticut's counties are now 9 planning regions. Some sources still file by the 8 old counties, so a fact can be missing here for that reason alone.",
  },
];

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Parameter codes some sources carry in brackets ("NOAA Climate at a Glance (tavg)"), as words. */
const PARAM_CODES: Readonly<Record<string, string>> = { tavg: "average temperature", pcp: "precipitation" };

/** A trailing lowercase code in brackets: "(tavg)", "(pcp)". */
const TRAILING_CODE = /\s*\(([a-z][a-z0-9_]*)\)$/;

/** The place fabric's upstream ids (and the names some reasons use for them), as the publisher a person knows. */
const UPSTREAM_NAMES: Readonly<Record<string, string>> = {
  "census-tigerweb": "the Census Bureau",
  "census tigerweb": "the Census Bureau",
  "usgs-wbd": "USGS",
  "usgs wbd": "USGS",
  "fema-nfhl": "FEMA",
  "fema nfhl": "FEMA",
};
const SOME_SOURCE = "One of the sources";

/** The publisher for an upstream id or name, else "One of the sources": an id is never shown. */
export function upstreamName(idOrName: string | null | undefined): string {
  const k = (idOrName ?? "").trim().toLowerCase();
  return Object.hasOwn(UPSTREAM_NAMES, k) ? UPSTREAM_NAMES[k] : SOME_SOURCE;
}

/** A gap's `what` as a person reads it: no upstream ids, parameter codes as words, other trailing codes dropped. `kind` is the kind of place asked about. */
export function plainWhat(what: string, kind?: string | null): string {
  const w = waterWords(what.trim(), kind);
  if (w === "place fabric") return "Point details";
  const fabric = /^place fabric: (.+)$/.exec(w);
  if (fabric) {
    const name = upstreamName(fabric[1]);
    return `place details from ${name === SOME_SOURCE ? "one of the sources" : name}`;
  }
  return w.replace(TRAILING_CODE, (_all, code: string) => (Object.hasOwn(PARAM_CODES, code) ? ` (${PARAM_CODES[code]})` : ""));
}

/** A publisher's name with a trailing lowercase code dropped: "NOAA Climate at a Glance (tavg)" is "NOAA Climate at a Glance". */
function dropCode(p: string): string {
  return p.replace(TRAILING_CODE, "").trim();
}

/** The publisher a reason names, read from the reason itself, else from the gap's `what`. */
export function reasonPublisher(rule: string, reason: string, what: string): string {
  const r = leadName(reason);
  const pick = (re: RegExp, s: string) => re.exec(s)?.[1]?.trim() || null;
  let p: string | null = null;
  if (rule === "ct-legacy-counties") p = pick(/^(.+?) lists Connecticut/, r);
  else if (rule === "alaska-forecast-zones") p = pick(/^(.+?) files Alaska/, r);
  else if (rule === "boundary-changed") p = pick(/so (.+?)'s 2010-based/, r);
  else if (rule === "no-value-or-rent-index") p = pick(/^(.+?) publishes no/, r);
  else if (rule === "upstream-failed") {
    p = pick(/^(.+?) failed on this call/, r);
    if (!p || /^that upstream$/i.test(p)) p = pick(/^place fabric: (.+)$/, what);
    return upstreamName(p);
  }
  if (!p) return "The source";
  return dropCode(p);
}

export interface PlainGap {
  /** The pattern's id, or null when no pattern matched (the reason is shown as written). */
  rule: string | null;
  text: string;
}

/** A gap reason as a person reads it. */
export function plainReason(what: string, reason: string): PlainGap {
  const r = reason.trim();
  for (const rule of GAP_RULES) {
    const m = rule.test.exec(r);
    if (m) return { rule: rule.id, text: rule.say(reasonPublisher(rule.id, r, what), m) };
  }
  return { rule: null, text: r.replace(/[.\s]+$/, "") + "." };
}

// ---- notes ------------------------------------------------------------------

/** Whole clauses (a note splits on "; ") that are only for agents: dropped. */
const DROP_CLAUSES = [/^not every registrant$/, /^shares as published$/];

/** Four numbers in brackets: a search box's corners, "(-88.4466,30.4346,-87.9466,30.9346)". */
const BOX_TUPLE = /\s*\(-?\d+(?:\.\d+)?,\s*-?\d+(?:\.\d+)?,\s*-?\d+(?:\.\d+)?,\s*-?\d+(?:\.\d+)?\)/g;

/** Kilometres in a degree of latitude (north-south), near enough everywhere. */
const KM_PER_DEGREE = 111;

/**
 * A search box's half-width in degrees as rough kilometres. A degree north-south
 * is about 111 km everywhere; east-west it shrinks with the latitude (111 x
 * cos(lat)). The smaller of the two is said, so "about N km" never overstates
 * how far the count reached. With no latitude, north-south only.
 */
export function aboutKm(degrees: string, lat?: number | null): string {
  const d = Number(degrees);
  const ns = KM_PER_DEGREE * d;
  const ew = typeof lat === "number" ? KM_PER_DEGREE * Math.abs(Math.cos((lat * Math.PI) / 180)) * d : ns;
  return `about ${Math.round(Math.min(ns, ew))} km`;
}

/** Digits with thousands separators: "279000" is "279,000". */
export function withCommas(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Former county codes FEMA still files declarations under, by the area's old
 * name. Alaska's Valdez-Cordova Census Area (02261) was split in 2019 into
 * Chugach (02063) and Copper River (02066); Connecticut's 8 counties were
 * replaced by planning regions in 2022.
 */
const FORMER_AREAS: Readonly<Record<string, string>> = {
  "02261": "Valdez-Cordova",
  "09001": "Fairfield County",
  "09003": "Hartford County",
  "09005": "Litchfield County",
  "09007": "Middlesex County",
  "09009": "New Haven County",
  "09011": "New London County",
  "09013": "Tolland County",
  "09015": "Windham County",
};

/** "filed by FEMA under the former county code 02261", as a person reads it. */
export function formerArea(code: string): string {
  return Object.hasOwn(FORMER_AREAS, code) ? `FEMA still files this under the old ${FORMER_AREAS[code]} area` : "FEMA still files this under an old county code";
}

/** "M4.5+": an earthquake magnitude, written as words. */
const MAGNITUDE = /\bM(\d+(?:\.\d+)?)\+/g;
const MAGNITUDE_WORDS = "magnitude $1 or larger";

/** Phrase rewrites inside a note (one clause at a time), in order. */
/** A rewrite's replacement: fixed text, or a function of the match (whole, then groups) and the place's latitude. */
type NoteTo = string | ((m: string[], lat: number | null | undefined) => string);

const NOTE_REWRITES: readonly [RegExp, NoteTo][] = [
  // Live counts in a search box: say where they were counted, without the box's corners or the route.
  [/^the box ([\d.]+) degrees around the county's Census internal point \([^)]*\)/, (m, lat) => `counted near the middle of the county (${aboutKm(m[1], lat)})`],
  [/^the box ([\d.]+) degrees around the point \([^)]*\)/, (m, lat) => `counted within ${aboutKm(m[1], lat)} of the spot you picked`],
  [/^within ([\d.]+) degrees of the point$/, (m, lat) => `within ${aboutKm(m[1], lat)} of the spot you picked`],
  [/\bwithin ([\d.]+) degrees of the county's Census internal point/g, (m, lat) => `near the middle of the county (${aboutKm(m[1], lat)})`],
  [/the county's Census internal point/g, "the middle of the county"],
  [/,? names are not copied/g, ""],
  [MAGNITUDE, MAGNITUDE_WORDS],
  [/^no record-level URL: a count of the route's records inside this box$/, "counted inside that area"],
  [/^no record-level URL: a count over (.+?), matched to this box here$/, "counted from $1, inside that area"],
  [/^.+? has no URL for exactly this box$/, "the source link opens the whole list, not this count"],
  [BOX_TUPLE, ""],
  [/within eye's SEC bundle \(a committed fixture, pulled: null\)/g, "from the sample of SEC filers we hold, not every company"],
  [/^no record-level URL:\s*/, ""],
  [/upstreamUrl is the publisher's own schedule for this release/g, "the source link is the publisher's own schedule for this release"],
  [/,? for hospital hifld-hosp:\S+/g, ""],
  [/: null, not 0$/, ""],
  [/ \(the route's caveats say how that code relates to this county\)/g, ""],
  // After the caveats aside is gone: the old area's name, not its code.
  [/^filed by FEMA under the former county code (\d{5})$/, (m) => formerArea(m[1])],
  // Counts with thousands separators.
  [/\bpopulation served (\d{4,})\b/g, (m) => `population served ${withCommas(m[1])}`],
  // The Drought Monitor's share of the area in no class, and a one-day release window.
  [/^none (\d+(?:\.\d+)?%)$/, "no drought $1"],
  [/^window (\d{4}-\d{2}-\d{2}) to \1$/, "on $1"],
  [/blocks automated clients \(HTTP 403 to a non-browser user agent, (checked [^)]*)\)/g, "blocks automated readers ($1)"],
  [/, not a Census table eye reads directly/g, ", not a Census table"],
  [/labelled by NID id/g, "labelled by its NID id"],
  [/\beye's\b/g, "this atlas's"],
];

/** A rewrite applied to one clause. A function's match arrives as strings only (replace's offset and whole-input arguments are left out). */
function rewrite(s: string, re: RegExp, to: NoteTo, lat: number | null | undefined): string {
  if (typeof to === "string") return s.replace(re, to);
  return s.replace(re, (...a: unknown[]) => {
    const groups = a.findIndex((x) => typeof x === "number");
    return to((groups < 0 ? a : a.slice(0, groups)) as string[], lat);
  });
}

/** An item's note as a person reads it. `lat` is the place's latitude, for distances in kilometres. */
export function plainNote(note: string, lat?: number | null): string {
  const clauses = note
    .split(/;\s+/)
    .map((c) => NOTE_REWRITES.reduce((s, [re, to]) => rewrite(s, re, to, lat), c.trim()))
    .filter((c) => c && !DROP_CLAUSES.some((re) => re.test(c)));
  return clauses.join("; ");
}

/** world_context asks for water at a point: for a county, that point is its middle. */
const WATER_AT_POINT = /community water system serving the point/g;

/** The water system's label for the kind of place asked about: the county's middle, the spot picked, else no place at all. */
function waterWords(s: string, kind?: string | null): string {
  return s.replace(
    WATER_AT_POINT,
    kind === "county" ? "community water system at the middle of this county" : kind === "point" ? "community water system serving this spot" : "community water system",
  );
}

/**
 * A fact's label as a person reads it: where a live count was made (near the
 * place asked about, or near the middle of the county when a county was asked:
 * the count is a box around that middle, not the whole county), the water
 * system's place, no aside about copying names, and a magnitude in words.
 */
export function plainFact(fact: string, kind?: string | null): string {
  return waterWords(fact, kind)
    .replace(/touching the box/g, kind === "county" ? "near the middle of this county" : "near this place")
    .replace(/;\s*names are not copied/g, "")
    .replace(MAGNITUDE, MAGNITUDE_WORDS);
}

/** Publisher lines written for the record, as a person reads them. */
const PUBLISHER_REWRITES: readonly [RegExp, string][] = [
  // EPA's service-area layer credits each polygon's own provider.
  [/^U\.S\. EPA; the original data provider of each polygon \(.*\)$/, "U.S. EPA, with boundaries from states and water systems"],
];

/** A publisher's name without the agent-facing ids some carry in brackets ("(FEMA_HQ_Preparedness_NIC)"). */
export function plainPublisher(p: string): string {
  const q = PUBLISHER_REWRITES.reduce((s, [re, to]) => s.replace(re, to), p.trim());
  return dropCode(q.replace(/\s*\([A-Za-z0-9]+(?:_[A-Za-z0-9]+)+\)/g, "").trim());
}

/** The place's point basis, as the subtitle says it. */
export function plainBasis(basis: string | undefined | null): string | null {
  if (!basis) return null;
  if (/internal point/i.test(basis)) return "centred on the middle of the county";
  if (/representative point/i.test(basis)) return "centred on the middle of the state";
  if (basis === "as given") return null;
  return basis.replace(/\/api\/\S+/g, "this atlas").replace(/\beye's\b/g, "this atlas's");
}

/** A 0-to-1 scale's unit as the source writes it: "0 least to 1 most vulnerable among US counties". */
const ZERO_TO_ONE = /^0 least to 1 most (.+)$/;

/**
 * A value on a 0-to-1 scale as a person reads it: two decimals, then the scale
 * in brackets ("0.83 (0 = least, 1 = most vulnerable among US counties)"). Null
 * when the unit is not such a scale.
 */
export function plainScale(v: unknown, unit: string | undefined | null): string | null {
  const m = typeof v === "number" && unit ? ZERO_TO_ONE.exec(unit.trim()) : null;
  return m ? `${(v as number).toFixed(2)} (0 = least, 1 = most ${m[1]})` : null;
}

// ---- record cuts ------------------------------------------------------------

/** A topic's basis line for a list cut at max_records: "hospitals: 3 of 7 shown (max_records)". */
const CUT = /^(.+?): (\d+) of (at least )?(\d+) shown \(max_records\)$/;

/** The cut lines in a topic's coverageStatus.basis, as plain sentences ("3 of 7 hospitals shown."). */
export function cutSentences(basis: readonly string[] | undefined): string[] {
  const out: string[] = [];
  for (const b of basis ?? []) {
    const m = CUT.exec(b.trim());
    if (m) out.push(`${m[2]} of ${m[3] ?? ""}${m[4]} ${m[1]} shown.`);
  }
  return out;
}

/** The reply-wide note when world_context dropped items to stay under its size limit. */
export function truncatedSentence(t: unknown): string | null {
  if (!t || typeof t !== "object") return null;
  const n = (t as { droppedItems?: unknown }).droppedItems;
  const count = typeof n === "number" && n > 0 ? n : null;
  return count
    ? `This answer was long, so ${count === 1 ? "1 line was" : `${count} lines were`} left out to keep it short.`
    : "This answer was long, so some lines were left out to keep it short.";
}
