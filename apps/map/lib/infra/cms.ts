// CMS hospital star ratings on the HIFLD hospital click (round 8). CMS's
// Hospital General Information (Care Compare, Provider Data Catalog dataset
// xubh-q36u) has no coordinates, no CORS and no-store caching, and HIFLD's
// hospital layer carries no CMS certification number (ID is HIFLD's own,
// STATE_ID a state licence number; 0 of Texas's 467 CCNs match either), so the
// two are joined once, in a bake, by the only key they share: the street
// address and ZIP code, exactly, after a fixed normalisation, and only where
// exactly one CMS row and exactly one HIFLD row (any status) share the key.
// A key two hospitals share (a long-term-care unit inside a general hospital)
// is never attached. A tenant HIFLD lists alone at its host's address (the
// host is keyed elsewhere) is refused too, by tenantConflict, when its name or
// type marks it as one: on the 2026-10-18 audit it refused 7 of 4,050
// one-to-one matches, six that paired a long-term acute care hospital, or a
// closed or moved hospital HIFLD still lists at a building another facility now
// occupies, with another facility's CMS record, and one rename (a known cost).
// A distinct part (D/P) is kept: it is a unit under its host's own CCN. Rows
// still unattached get a second pass on mailFreeKey, which refuses the same way.
//
// Pure and import-free with only erasable TypeScript (node runs it by type
// stripping for scripts/bake-cms-hospitals.mjs; vitest and the infra route
// import it). The click lines are here too.

export const CMS_DATASET = "xubh-q36u";
export const CMS_QUERY = `https://data.cms.gov/provider-data/api/1/datastore/query/${CMS_DATASET}/0`;
export const CMS_METASTORE = `https://data.cms.gov/provider-data/api/1/metastore/schemas/dataset/items/${CMS_DATASET}?show-reference-ids=false`;
export const CMS_PAGE = 1500;
/**
 * The only CMS columns asked for: never telephone_number (a contact) or countyparish. facility_name
 * is read in the bake only, to refuse a tenant match (tenantConflict); it is never stored in a row or
 * shown (HIFLD labels the hospital).
 */
export const CMS_PROPERTIES = ["facility_id", "facility_name", "address", "zip_code", "state", "hospital_type", "hospital_ownership", "emergency_services", "meets_criteria_for_birthing_friendly_designation", "hospital_overall_rating", "hospital_overall_rating_footnote"] as const;
export const CMS_DENY = /telephone|countyparish/;

export const HIFLD_JOIN_URL = "https://services.arcgis.com/XG15cJAlne2vxtgt/arcgis/rest/services/Hospitals_RAPT/FeatureServer/6";
/**
 * NAME and TYPE are read for tenantConflict only. Neither is stored in a row; a refused pair's reason in
 * meta.refusedTenant names the tenant marker word (LTAC, KINDRED, ...) or both publishers' types.
 */
export const HIFLD_JOIN_FIELDS = ["ID", "ADDRESS", "ZIP", "STATUS", "NAME", "TYPE"] as const;

/** One page of the CMS datastore query, the named columns only. */
export function cmsPageUrl(offset: number): string {
  return `${CMS_QUERY}?limit=${CMS_PAGE}&offset=${offset}&${CMS_PROPERTIES.map((p) => `properties[]=${p}`).join("&")}`;
}

/** The street-word abbreviations of the join (the same table the design's measurement used). */
export const ADDRESS_WORDS: Readonly<Record<string, string>> = {
  STREET: "ST",
  AVENUE: "AVE",
  ROAD: "RD",
  DRIVE: "DR",
  BOULEVARD: "BLVD",
  HIGHWAY: "HWY",
  PARKWAY: "PKWY",
  LANE: "LN",
  NORTH: "N",
  SOUTH: "S",
  EAST: "E",
  WEST: "W",
  FREEWAY: "FWY",
  SUITE: "STE",
  CIRCLE: "CIR",
  COURT: "CT",
  PLACE: "PL",
  EXPRESSWAY: "EXPY",
  TRAIL: "TRL",
  NORTHEAST: "NE",
  NORTHWEST: "NW",
  SOUTHEAST: "SE",
  SOUTHWEST: "SW",
};

/** An address for the join: upper case, punctuation to spaces, the street words abbreviated. */
export function normAddress(a: unknown): string {
  const s = (typeof a === "string" ? a : "").toUpperCase().replace(/[^A-Z0-9 ]/g, " ");
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => ADDRESS_WORDS[w] ?? w)
    .join(" ");
}

/** The join key: the normalised address and the 5-digit ZIP. Null when either is empty. */
export function joinKey(address: unknown, zip: unknown): string | null {
  const a = normAddress(address);
  const z = String(zip ?? "")
    .trim()
    .slice(0, 5);
  return a && /^\d{5}$/.test(z) ? `${a}|${z}` : null;
}

const ORDINAL_WORDS: Readonly<Record<string, string>> = {
  FIRST: "1ST", SECOND: "2ND", THIRD: "3RD", FOURTH: "4TH", FIFTH: "5TH", SIXTH: "6TH", SEVENTH: "7TH", EIGHTH: "8TH", NINTH: "9TH", TENTH: "10TH",
  ELEVENTH: "11TH", TWELFTH: "12TH", THIRTEENTH: "13TH", FOURTEENTH: "14TH", FIFTEENTH: "15TH", SIXTEENTH: "16TH", SEVENTEENTH: "17TH", EIGHTEENTH: "18TH", NINETEENTH: "19TH", TWENTIETH: "20TH",
};

/**
 * The second-pass key: the join key without a PO box or drawer (PO, P O or POB before it: mail, not the building), with "U S" as
 * "US" and ordinal street words as numbers (NINETEENTH to 19TH). Suites, floors and buildings are kept:
 * they tell co-located facilities apart. Null when the address or ZIP is empty.
 */
/** A rural route or delivery marker, after normAddress (which turns "R.R. #2" into "R R 2"). */
const ROUTE = "(?:R R|RR|HCR|HC|RFD|RD|RT|RTE|ROUTE|RURAL ROUTE|STAR ROUTE|STAR RT)";

export function mailFreeKey(address: unknown, zip: unknown): string | null {
  // A box or drawer marked as mail (PO, P O, POB) goes; so does a bare BOX or DRAWER n after a street
  // ("1653 TEMPLE AVE N BOX 710": 13 same-hospital matches on 2026-10-18 need it). A rural-route box
  // (RR 2 BOX 100, R R 2, RR2, HC 1, HCR 1, RFD 1, RD 3, ROUTE 3 BOX 9, or BOX 158 ROUTE 17M with the
  // box first) is the address itself, so it is kept and two route boxes never share a key.
  const a = normAddress(address)
    .replace(/\b(P O|PO) (BOX|DRAWER|DRWR) \S+/g, " ")
    .replace(/\bPOB \d+\S*/g, " ")
    // The box token is taken whole ((?=\s|$)), so a backtrack to "BOX 15" can never slip past the route check.
    .replace(new RegExp(`(?<!\\b${ROUTE} ?\\d+\\S* )\\b(BOX|DRAWER) \\d\\S*(?=\\s|$)(?! ${ROUTE} ?\\d)`, "g"), " ")
    .replace(/\bU S\b/g, "US")
    .split(" ")
    .map((w) => ORDINAL_WORDS[w] ?? w)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return joinKey(a, zip);
}

export type CmsRow = { [K in (typeof CMS_PROPERTIES)[number]]?: unknown };
export type HifldJoinRow = { ID?: unknown; ADDRESS?: unknown; ZIP?: unknown; STATUS?: unknown; NAME?: unknown; TYPE?: unknown };

/** [ccn, rating 1-5 or null, rating footnote or null, CMS hospital type, ownership, emergency services, birthing-friendly] */
export type CmsEntry = [string, number | null, string | null, string | null, string | null, string | null, string | null];
export const CMS_COLUMNS = ["ccn", "rating", "ratingFootnote", "cmsType", "ownership", "emergency", "birthingFriendly"] as const;

export interface CmsBake {
  meta: {
    what: string;
    source: string;
    credit: string;
    licence: string;
    url: string;
    metastore: string;
    cmsModified: string | null;
    hifldUrl: string;
    hifldDataLastEdit: string | null;
    joinRule: string;
    cmsRows: number;
    cmsDistinctCcn: number;
    hifldRows: number;
    attached: number;
    attachedOpen: number;
    attachedOpenRated: number;
    attachedClosed: number;
    sharedKeys: number;
    /** Of attached, how many the second pass (mailFreeKey) matched. */
    attachedByMailFreeKey: number;
    /** One-to-one matches refused by tenantConflict: [HIFLD ID, CCN, why]; never attached. */
    refusedTenant: Array<[string, string, string]>;
    /** Keys shared by more than one row on either side: [key, CMS CCNs, HIFLD IDs]; never attached. */
    sharedAddress: Array<[string, string[], string[]]>;
    unattachedByCmsType: Record<string, number>;
    ratings: Record<string, number>;
    sha256: { cms: string | null; hifld: string | null };
    generatedBy: string;
  };
  columns: typeof CMS_COLUMNS;
  rows: Record<string, CmsEntry>;
}

const s = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * A HIFLD name that marks a separately certified hospital living in another hospital's building (CMS's
 * Provider of Services file gives each its own CCN, e.g. Infirmary LTAC 012006 at Mobile Infirmary's
 * address). Matched after nameUpper, so LONG-TERM ACUTE reads LONG TERM ACUTE. Not D/P or "distinct
 * part": see DISTINCT_PART.
 */
export const TENANT_MARKER = /\b(LTAC|LTACH|LONG TERM ACUTE|SELECT SPECIALTY|KINDRED|VIBRA)\b/;
/**
 * A HIFLD name marking a distinct part: a unit under its host's own CCN (CMS's Provider of Services file
 * lists no separate one), so the host's rating covers it and the types-differ test never refuses it.
 */
export const DISTINCT_PART = /\bD\/P\b|\bDISTINCT PART\b/;
const NAME_STOP = new Set("THE OF AND AT FOR INC LLC CORP HOSPITAL HOSPITALS MEDICAL CENTER CENTRE CTR HEALTH HEALTHCARE SYSTEM SYSTEMS REGIONAL COMMUNITY MEMORIAL CAMPUS CARE SERVICES".split(" "));
const nameUpper = (v: unknown): string =>
  (s(v) ?? "")
    .toUpperCase()
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\bHOSP\b/g, "HOSPITAL")
    .replace(/\bCTR\b/g, "CENTER");
const nameTokens = (v: unknown): string[] => nameUpper(v).replace(/[^A-Z0-9/ ]/g, " ").split(/\s+/).filter((t) => t.length > 1 && !NAME_STOP.has(t));
function oneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) return [...a].filter((c, i) => c !== b[i]).length <= 1;
  const [x, y] = a.length < b.length ? [a, b] : [b, a];
  for (let i = 0; i < y.length; i++) if (y.slice(0, i) + y.slice(i + 1) === x) return true;
  return false;
}
/**
 * Share of the shorter name's words found in the other (a word of 5+ letters may differ by one edit).
 * A name with no word left once the stop words go (HOSPITAL, MEDICAL CENTER) agrees with nothing: 0.
 */
export function nameOverlap(a: unknown, b: unknown): number {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (!ta.length || !tb.length) return 0;
  const [x, y] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return x.filter((t) => y.some((u) => t === u || (t.length >= 5 && oneEdit(t, u)))).length / x.length;
}
function typeConflict(hType: string | null, cType: string | null): boolean {
  const h = (hType ?? "").toUpperCase();
  if ((h === "LONG TERM CARE" || h === "REHABILITATION" || h === "CHRONIC DISEASE") && cType !== "Long-term") return true;
  if ((h === "PSYCHIATRIC") !== (cType === "Psychiatric")) return true;
  if (cType === "Childrens" && h !== "CHILDREN" && h !== "GENERAL ACUTE CARE") return true;
  return false;
}
/**
 * Why a one-to-one address match pairs two different facilities, or null. Either the HIFLD name marks
 * a tenant (LTAC, Kindred, ...) the CMS name does not, and CMS does not type its own row Long-term (a
 * standalone LTACH matched to its own record); or the two publishers' types conflict, the HIFLD name
 * does not mark a distinct part, and fewer than half the shorter name's words agree (a name that is
 * all stop words agrees with nothing). Missing names never refuse; missing types skip the type test.
 * Refusing costs a rating line ("no unambiguous CMS match"); attaching wrongly shows another
 * facility's stars, so the rule leans to refusing.
 */
export function tenantConflict(hName: unknown, hType: unknown, cName: unknown, cType: unknown): string | null {
  if (!s(hName) || !s(cName)) return null;
  const hu = nameUpper(hName);
  const hm = hu.match(TENANT_MARKER);
  if (hm && s(cType) !== "Long-term" && !TENANT_MARKER.test(nameUpper(cName))) return `HIFLD names a tenant (${hm[1]}) the CMS name does not`;
  if (DISTINCT_PART.test(hu)) return null;
  if (s(hType) && s(cType) && typeConflict(s(hType), s(cType)) && nameOverlap(hName, cName) < 0.5) return `types differ (HIFLD ${s(hType)}, CMS ${s(cType)}) and the names do not agree`;
  return null;
}
const sortKeys = <V>(o: Record<string, V>): Record<string, V> => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));

/** CMS's overall rating: 1-5, or null for "Not Available" (CMS's own word) and anything else. */
export function cmsRating(v: unknown): number | null {
  const t = s(v);
  return t && /^[1-5]$/.test(t) ? Number(t) : null;
}

/**
 * The join. A CMS row attaches to a HIFLD hospital when their keys are equal and each side has
 * exactly one row with that key; any key with two or more rows on either side goes to
 * meta.sharedAddress with both sides' ids and is never attached. Output keyed by HIFLD ID, sorted.
 */
export function bakeCms(
  cms: readonly CmsRow[],
  hifld: readonly HifldJoinRow[],
  info: { cmsModified: string | null; hifldDataLastEdit: string | null; sha256?: { cms: string | null; hifld: string | null } },
): CmsBake {
  const ci = new Map<string, CmsRow[]>();
  const hi = new Map<string, HifldJoinRow[]>();
  for (const r of cms) {
    const k = joinKey(r.address, r.zip_code);
    if (!k) continue;
    const l = ci.get(k);
    if (l) l.push(r);
    else ci.set(k, [r]);
  }
  for (const r of hifld) {
    const k = joinKey(r.ADDRESS, r.ZIP);
    if (!k || !s(r.ID)) continue;
    const l = hi.get(k);
    if (l) l.push(r);
    else hi.set(k, [r]);
  }
  const rows: Record<string, CmsEntry> = {};
  const shared: Array<[string, string[], string[]]> = [];
  const attachedCcn = new Set<string>();
  const refused: Array<[string, string, string]> = [];
  const refusedHid = new Set<string>();
  let open = 0;
  let openRated = 0;
  let closed = 0;
  /** Attach one CMS row to one HIFLD row unless tenantConflict refuses the pair; true when attached. */
  const attach = (c: CmsRow, h: HifldJoinRow): boolean => {
    const ccn = s(c.facility_id);
    if (!ccn) return false;
    const hid = String(h.ID).trim();
    const why = tenantConflict(h.NAME, h.TYPE, c.facility_name, c.hospital_type);
    if (why) {
      refused.push([hid, ccn, why]);
      refusedHid.add(hid);
      return false;
    }
    const rating = cmsRating(c.hospital_overall_rating);
    rows[hid] = [ccn, rating, rating == null ? s(c.hospital_overall_rating_footnote) : null, s(c.hospital_type), s(c.hospital_ownership), s(c.emergency_services), s(c.meets_criteria_for_birthing_friendly_designation)];
    attachedCcn.add(ccn);
    if (s(h.STATUS) === "OPEN") {
      open++;
      if (rating != null) openRated++;
    } else closed++;
    return true;
  };
  for (const [k, cs] of ci) {
    const hs = hi.get(k);
    if (!hs) continue;
    if (cs.length !== 1 || hs.length !== 1) {
      shared.push([k, cs.map((c) => String(c.facility_id ?? "")).sort(), hs.map((h) => String(h.ID ?? "")).sort()]);
      continue;
    }
    attach(cs[0], hs[0]);
  }
  // Pass 2: rows the exact key left unattached get one more chance on mailFreeKey, only where that key
  // is unique across ALL rows on both sides and neither row is attached or refused. Pass 1 is never undone.
  const ci2 = new Map<string, CmsRow[]>();
  const hi2 = new Map<string, HifldJoinRow[]>();
  for (const r of cms) {
    const k = mailFreeKey(r.address, r.zip_code);
    if (k) ci2.set(k, [...(ci2.get(k) ?? []), r]);
  }
  for (const r of hifld) {
    const k = mailFreeKey(r.ADDRESS, r.ZIP);
    if (k && s(r.ID)) hi2.set(k, [...(hi2.get(k) ?? []), r]);
  }
  let viaMailFree = 0;
  for (const [k, cs] of ci2) {
    const hs = hi2.get(k);
    if (!hs || cs.length !== 1 || hs.length !== 1) continue;
    const ccn = s(cs[0].facility_id);
    const hid = String(hs[0].ID).trim();
    if (!ccn || attachedCcn.has(ccn) || hid in rows || refusedHid.has(hid)) continue;
    if (attach(cs[0], hs[0])) viaMailFree++;
  }
  const unattached: Record<string, number> = {};
  const ratings: Record<string, number> = {};
  for (const c of cms) {
    const r = cmsRating(c.hospital_overall_rating);
    const rk = r == null ? "not available" : String(r);
    ratings[rk] = (ratings[rk] ?? 0) + 1;
    if (!attachedCcn.has(String(c.facility_id ?? ""))) {
      const t = s(c.hospital_type) ?? "(none)";
      unattached[t] = (unattached[t] ?? 0) + 1;
    }
  }
  shared.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return {
    meta: {
      what: "A derivation, not an upstream file: CMS Hospital General Information joined to HIFLD's hospitals (FEMA RAPT copy) by exact normalised street address + 5-digit ZIP, attached only where exactly one row on each side shares the key and the two are not a tenant and another facility (refusedTenant). Keyed by HIFLD ID.",
      source: "Centers for Medicare & Medicaid Services, Hospital General Information (Provider Data Catalog xubh-q36u); HIFLD hospitals via FEMA RAPT",
      credit: "Centers for Medicare & Medicaid Services, Care Compare (Hospital General Information)",
      licence: "no licence stated (metastore license: null); US federal work",
      url: CMS_QUERY,
      metastore: CMS_METASTORE,
      cmsModified: info.cmsModified,
      hifldUrl: HIFLD_JOIN_URL,
      hifldDataLastEdit: info.hifldDataLastEdit,
      joinRule: "key = address upper-cased, every non-alphanumeric to a space, words abbreviated by ADDRESS_WORDS (STREET to ST, NORTH to N, ...), then '|' and the first five digits of the ZIP; attached only where exactly one CMS row and exactly one HIFLD row (any status) share the key; a house-number-only key is not used; rows still unattached then get a second pass on mailFreeKey (a box or drawer after PO, P O or POB removed, and a bare BOX or DRAWER n after a street removed, but kept on either side of a rural-route marker (RR, R R, HC, HCR, RFD, RD, RT, RTE, ROUTE, RURAL ROUTE, STAR ROUTE/RT n); U S as US; ordinal street words as numbers), attached only where that key is unique across all rows and neither row is already attached or refused; a one-to-one match is refused when tenantConflict finds a tenant marker in the HIFLD name only (and CMS does not type its own row Long-term), or conflicting types with names that do not agree (a distinct part, D/P, is never refused on types); facility names and types are read for that test only: no row stores either, and meta.refusedTenant stores, per refused pair, the HIFLD ID, the CCN and a reason naming the tenant marker word or the HIFLD TYPE and CMS hospital_type, never a facility name",
      cmsRows: cms.length,
      cmsDistinctCcn: new Set(cms.map((c) => String(c.facility_id ?? ""))).size,
      hifldRows: hifld.length,
      attached: Object.keys(rows).length,
      attachedOpen: open,
      attachedOpenRated: openRated,
      attachedClosed: closed,
      sharedKeys: shared.length,
      attachedByMailFreeKey: viaMailFree,
      sharedAddress: shared,
      refusedTenant: refused.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
      unattachedByCmsType: sortKeys(unattached),
      ratings: sortKeys(ratings),
      sha256: info.sha256 ?? { cms: null, hifld: null },
      generatedBy: "scripts/bake-cms-hospitals.mjs",
    },
    columns: CMS_COLUMNS,
    rows: sortKeys(rows),
  };
}

export const CMS_RATINGS_CAVEAT =
  "CMS's overall hospital star rating as Care Compare published it (dataset modified 2026-07-22), joined to HIFLD's hospital by street address and ZIP code (exactly, or once a PO box or drawer is set aside, ordinal street words are read as numbers and U S as US) because HIFLD carries no CMS certification number; about one CMS hospital in five could not be matched that way, hospitals sharing an address are never matched, and a match whose HIFLD name or type marks a tenant of another hospital is refused. CMS rates acute-care and critical-access hospitals that report enough measures; many are not rated. A rating summarizes reported measures; it is not a measure of a hospital's emergency capacity.";

export interface CmsExtra {
  ccn: string;
  rating: number | null;
  ratingFootnote: string | null;
  cmsType: string | null;
  ownership: string | null;
  emergency: string | null;
  birthingFriendly: string | null;
}

export function cmsExtra(e: CmsEntry): CmsExtra {
  return { ccn: e[0], rating: e[1], ratingFootnote: e[2], cmsType: e[3], ownership: e[4], emergency: e[5], birthingFriendly: e[6] };
}

/**
 * The click lines: one of three states, always naming the match rule. `modified` is the CMS
 * dataset's own modified date from the bake. A HIFLD CLOSED hospital with a match says both.
 */
export function cmsDetails(x: CmsExtra | null, hifldStatus: string | null, modified: string | null): Record<string, string> {
  const when = modified ? `Care Compare, dataset modified ${modified}` : "Care Compare";
  if (!x) return { "CMS star rating": "no unambiguous CMS match at this address (the CMS list is joined by street address and ZIP; HIFLD carries no CMS number)" };
  const d: Record<string, string> = {
    "CMS star rating":
      x.rating != null
        ? `${x.rating} of 5 (${when}; matched to this HIFLD record by street address and ZIP)`
        : `CMS lists this hospital but has not rated it${x.ratingFootnote ? ` (footnote ${x.ratingFootnote})` : ""} (${when}; matched by street address and ZIP)`,
    "CMS certification number": x.ccn,
  };
  if (x.cmsType) d["CMS hospital type"] = x.cmsType;
  if (x.ownership) d["CMS ownership"] = x.ownership;
  if (x.emergency) d["CMS emergency services"] = x.emergency;
  if (x.birthingFriendly) d["CMS birthing-friendly"] = x.birthingFriendly;
  if (hifldStatus && hifldStatus.toUpperCase() !== "OPEN") d["CMS and HIFLD"] = "HIFLD lists it closed; CMS still lists it";
  return d;
}
