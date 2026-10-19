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
    test: /the fabric is per point; call world_context with lon\/lat/,
    say: () => "Point details (elevation, flood zone, watershed) need a spot on the map. Click inside the county.",
  },
  {
    id: "upstream-failed",
    test: /^(?:(.*?) )?failed on this call/,
    say: (p) => `${p} didn't answer just now. Try again in a minute.`,
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
    test: /\bno\b.*\bservice area contains/,
    say: () => "No public water system's mapped area covers this spot. It may use a private well, or a system EPA hasn't mapped.",
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
  }
  if (!p) return "The source";
  return p;
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
const DROP_CLAUSES = [/^not every registrant$/];

/** Phrase rewrites inside a note, in order. */
const NOTE_REWRITES: readonly [RegExp, string][] = [
  [/within eye's SEC bundle \(a committed fixture, pulled: null\)/g, "from the sample of SEC filers we hold, not every company"],
  [/^no record-level URL:\s*/, ""],
  [/upstreamUrl is the publisher's own schedule for this release/g, "the source link is the publisher's own schedule for this release"],
  [/,? for hospital hifld-hosp:\S+/g, ""],
  [/: null, not 0$/, ""],
  [/ \(the route's caveats say how that code relates to this county\)/g, ""],
  [/blocks automated clients \(HTTP 403 to a non-browser user agent, (checked [^)]*)\)/g, "blocks automated readers ($1)"],
  [/, not a Census table eye reads directly/g, ", not a Census table"],
  [/labelled by NID id/g, "labelled by its NID id"],
  [/\beye's\b/g, "this atlas's"],
];

/** An item's note as a person reads it. */
export function plainNote(note: string): string {
  const clauses = note
    .split(/;\s+/)
    .map((c) => NOTE_REWRITES.reduce((s, [re, to]) => s.replace(re, to), c.trim()))
    .filter((c) => c && !DROP_CLAUSES.some((re) => re.test(c)));
  return clauses.join("; ");
}

/** A publisher's name without the agent-facing ids some carry in brackets ("(FEMA_HQ_Preparedness_NIC)"). */
export function plainPublisher(p: string): string {
  return p.replace(/\s*\([A-Za-z0-9]+(?:_[A-Za-z0-9]+)+\)/g, "").trim();
}

/** The place's point basis, as the subtitle says it. */
export function plainBasis(basis: string | undefined | null): string | null {
  if (!basis) return null;
  if (/internal point/i.test(basis)) return "centred on Census's internal point for the county";
  if (/representative point/i.test(basis)) return "centred on the state's representative point";
  if (basis === "as given") return null;
  return basis.replace(/\/api\/\S+/g, "this atlas").replace(/\beye's\b/g, "this atlas's");
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
