// Typed absence: why a value is missing from an MCP reply, and what the agent may do next.
//
// Before this file a missing entry was { what, reason } in free text. Now each also carries
//   code    one of ABSENCE_CODES (closed: a new one is a deliberate edit here)
//   action  what the agent may do about it: abstain, retry, narrow, redirect, or none
// and the free-text reason stays, so nothing that parsed it breaks. coverageStatus.basis
// lines carry the same codes ({ code, text }).
//
// The one rule: a code that lies is worse than prose. `not_published` and `withheld` are set
// only from a route's own missing entry (a reason code in ROUTE_REASON_CODE) or from the
// publisher's own suppression flag (BLS QCEW's jobs.suppressed). Anything eye cannot tell
// apart defaults to `failed` (a call that did not give the answer) or `not_asked` (a topic
// the caller's input did not ask for), never to a claim about what a publisher holds.
//
// The outside vocabulary is HL7 FHIR's data-absent-reason value set, shown for each code in
// `fhir` (null where FHIR has no such notion). SDMX's OBS_STATUS types the same idea for
// observations. The word list, the codes and the actions are written here; no text or code
// was copied from either.
//
// Relative imports only (see ./tools.ts for why); this file imports nothing.

export const ABSENCE_ACTIONS = ["abstain", "retry", "narrow", "redirect", "none"] as const;
export type AbsenceAction = (typeof ABSENCE_ACTIONS)[number];

export interface AbsenceSpec {
  /**
   * abstain   say the value is absent; do not look for it elsewhere in this tool
   * retry     the same call can succeed later unchanged
   * narrow    change the request (a county FIPS or a point, a smaller box, fewer topics, another max_records)
   * redirect  the value is filed somewhere else; `to` names where when the route says
   * none      nothing is asked of you and no absence is claimed; the entry says why nothing is shown
   */
  action: AbsenceAction;
  /** True only when the same call can succeed later unchanged; agrees with ERROR_CODES for failed and timeout. */
  retryable: boolean;
  /** The nearest FHIR data-absent-reason code, or null when FHIR has none. */
  fhir: string | null;
  /** One line on what the code asserts, and what it does not. */
  means: string;
}

export const ABSENCE_CODES = {
  not_published: { action: "abstain", retryable: false, fhir: "unsupported", means: "The publisher does not publish this for this place, said by a route's own missing entry (today only source:not_published_for_puerto_rico) or a publisher's suppression flag. Never from eye's guess and never from a row value such as a FEMA rating word." },
  not_in_release: { action: "abstain", retryable: false, fhir: "unknown", means: "The source answered and its current release has no row or value for this place." },
  withheld: { action: "abstain", retryable: false, fhir: "masked", means: "The publisher suppressed the value (its own suppression flag), so it is null, not 0." },
  join_gap: { action: "narrow", retryable: false, fhir: null, means: "eye could not attach the source's rows to this place (a boundary or vintage mismatch); the source may hold the value." },
  filed_under_other_code: { action: "redirect", retryable: false, fhir: null, means: "The source files rows for this place under another place's code; they are not attached here." },
  not_asked: { action: "narrow", retryable: false, fhir: "not-asked", means: "This part was not requested or cannot be answered for this kind of place; ask with a county FIPS or a point." },
  not_loaded: { action: "narrow", retryable: false, fhir: null, means: "Part of the place or source was not loaded on this call (a smaller box, a bundle that is not a full pull)." },
  cut_by_route_limit: { action: "narrow", retryable: false, fhir: null, means: "The route hit its own record limit, so the list is a floor, not the whole." },
  cut_by_max_records: { action: "narrow", retryable: false, fhir: null, means: "The list was cut to max_records; there are more." },
  cut_by_byte_cap: { action: "narrow", retryable: false, fhir: null, means: "The reply was cut to its byte cap; ask for fewer topics or a smaller place." },
  failed: { action: "retry", retryable: true, fhir: "error", means: "A route or its upstream failed on this call; nothing is known about the value." },
  timeout: { action: "retry", retryable: true, fhir: "temp-unknown", means: "A route or its upstream did not answer in time; nothing is known about the value." },
  no_citation: { action: "none", retryable: false, fhir: null, means: "The route sent no provenance for this source, so nothing from it is shown; this does not say the value is absent." },
  about_eye: { action: "none", retryable: false, fhir: "not-applicable", means: "A claim about eye's own catalogue has no upstream to cite; it is not a claim about the world." },
} as const satisfies Record<string, AbsenceSpec>;

export type AbsenceCode = keyof typeof ABSENCE_CODES;

/** One entry of a topic's missing[]. */
export interface AbsenceEntry {
  what: string;
  code: AbsenceCode;
  /** Free text, as before. */
  reason: string;
  action: AbsenceAction;
  /** Where the value is filed, for filed_under_other_code, when the route says (a FIPS). */
  to?: string;
}

/** One line of a coverageStatus basis. */
export interface BasisLine {
  code: AbsenceCode;
  text: string;
}

export function absence(what: string, code: AbsenceCode, reason: string, to?: string): AbsenceEntry {
  return { what, code, reason, action: ABSENCE_CODES[code].action, ...(to ? { to } : {}) };
}

const CODE_NAMES = Object.keys(ABSENCE_CODES) as AbsenceCode[];

/**
 * JSON Schema (draft-07 keywords, like ERROR_ENVELOPE_SCHEMA) for one missing[] entry. The action
 * must be the code's own, so a reply cannot say not_published and also "retry".
 */
export const ABSENCE_SCHEMA = {
  title: "Embedding Atlas MCP absence entry",
  type: "object",
  required: ["what", "code", "reason", "action"],
  properties: {
    what: { type: "string", minLength: 1 },
    code: { type: "string", enum: CODE_NAMES },
    reason: { type: "string", minLength: 1 },
    action: { type: "string", enum: [...ABSENCE_ACTIONS] },
    to: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
  allOf: CODE_NAMES.map((c) => ({
    if: { properties: { code: { const: c } }, required: ["code"] },
    then: { properties: { action: { const: ABSENCE_CODES[c].action } } },
  })),
} as const;

/** JSON Schema for one coverageStatus.basis line. */
export const ABSENCE_BASIS_SCHEMA = {
  title: "Embedding Atlas MCP coverage basis line",
  type: "object",
  required: ["code", "text"],
  properties: {
    code: { type: "string", enum: CODE_NAMES },
    text: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
} as const;

/**
 * The reason codes the routes write in their own missing / null lists (lib/hazards/history.ts,
 * lib/catalog/placeExport.ts), and the absence code each is. The only route code that maps to
 * not_published is the one that says so; none maps to withheld.
 */
export const ROUTE_REASON_CODE: Record<string, AbsenceCode> = {
  "join:legacy_ct_counties": "join_gap",
  "join:boundary_changed_since_2010": "join_gap",
  "join:ncei_areas_not_counties": "join_gap",
  "join:area_not_placed": "join_gap",
  "join:multi_county": "join_gap",
  "join:no_source_row": "join_gap",
  "join:unplaced_property_in_state": "join_gap",
  "join:filed_under_other_code": "filed_under_other_code",
  "source:not_published_for_puerto_rico": "not_published",
  "source:not_in_release": "not_in_release",
  "source:null_in_county_layer": "not_in_release",
  "source:failed": "failed",
};

const TIMED_OUT = /\babort|timed? ?out\b/i;

/**
 * The code for a route's own missing / failed entry: its reason code when the table knows it,
 * else `failed`. A failure whose error text says it timed out is `timeout`.
 */
export function codeForRouteEntry(m: { source?: unknown; reason?: unknown; detail?: unknown; error?: unknown }): AbsenceCode {
  const reason = typeof m.reason === "string" ? m.reason : "";
  const mapped = Object.prototype.hasOwnProperty.call(ROUTE_REASON_CODE, reason) ? ROUTE_REASON_CODE[reason] : "failed";
  if (mapped !== "failed") return mapped;
  const text = [m.detail, m.error].filter((x): x is string => typeof x === "string").join(" ");
  return TIMED_OUT.test(text) ? "timeout" : "failed";
}

/**
 * The code for one of the globe's construct-field coverage reasons (lib/fabric/emergence.ts,
 * coverageOf), so the map and the MCP say the same thing about the same gap. Matches the
 * reason text with its layer name and numbers removed; undefined for a string it has not seen.
 */
const COVERAGE_REASON_CODES: Array<[RegExp, AbsenceCode]> = [
  [/doesn't report what it loaded/, "not_loaded"],
  [/incomplete here: the source's record limit was hit/, "cut_by_route_limit"],
  [/incomplete here: only those of .* MW or more were loaded/, "not_loaded"],
  [/incomplete here: .* did not load/, "failed"],
  [/not loaded here: part of the unit lies outside the loaded box/, "not_loaded"],
  [/not loaded here: outside the loaded box/, "not_loaded"],
  [/no area known for this unit/, "not_in_release"],
];

export function coverageReasonCode(reason: string): AbsenceCode | undefined {
  return COVERAGE_REASON_CODES.find(([re]) => re.test(reason))?.[1];
}
