// Toxics Release Inventory release quantities for one facility and year, from
// EPA Envirofacts' data service: the Form R join (tri_reporting_form +
// tri_release_qty + tri_chem_info) and, separately, the Form A certifications
// (a Form A reports no quantities, so it has no release rows and the join
// drops it). Pure: the URLs, the allowlist projection, the code tables and the
// per-medium totals. The fetch and route live in app/api/permits (op=tri).
//
// Envirofacts sends every column of every table on every row, including the
// certifying official's name, signature and title, and the public and
// technical contacts' names, phones, extensions and emails. Fields are KEPT
// by allowlist (TRI_KEEP), never removed by a deny list: nothing else leaves
// projectTri(), and only the projected rows are cached or returned.
//
// Code meanings are EPA's own (Envirofacts TRI metadata pages, read
// 2026-10-13): FORM_TYPE_IND L = Form R, S = Form A; RELEASE_RANGE_CODE
// 1 = A (1-10 lb), 3 = B (11-499 lb), 4 = C (500-999 lb), 2 = 1-499 lb
// (historical); RELEASE_NA 1 = "NA" entered; the basis and medium codes below.

export const ENVIROFACTS = "https://data.epa.gov/dmapservice";

/** A TRI facility id (TRIFID): 15 letters and digits, e.g. 77012HLLPT9701M. */
export const TRIFID_RE = /^[0-9A-Z]{15}$/;
/** TRI began with reporting year 1987. */
export const TRI_FIRST_YEAR = 1987;

export function triReleaseUrl(trifid: string, year: number): string {
  return `${ENVIROFACTS}/tri.tri_reporting_form/tri_facility_id/equals/${trifid}/and/reporting_year/equals/${year}/join/tri.tri_release_qty/doc_ctrl_num/equals/doc_ctrl_num/join/tri.tri_chem_info/tri_chem_id/equals/tri_chem_id/JSON`;
}

export function triFormAUrl(trifid: string, year: number): string {
  return `${ENVIROFACTS}/tri.tri_reporting_form/tri_facility_id/equals/${trifid}/and/reporting_year/equals/${year}/and/form_type_ind/equals/S/join/tri.tri_chem_info/tri_chem_id/equals/tri_chem_id/JSON`;
}

/** The only fields that leave the parser. */
export const TRI_KEEP = [
  "reporting_year",
  "cas_chem_name",
  "cas_registry_number",
  "environmental_medium",
  "total_release",
  "unit_of_measure",
  "release_basis_est_code",
  "release_range_code",
  "release_na",
  "form_type_ind",
  "doc_ctrl_num",
] as const;

export type TriRaw = Partial<Record<(typeof TRI_KEEP)[number], string | number | null>>;

/** Envirofacts rows -> the allowlisted fields only. Anything that is not an array is no rows. */
export function projectTri(j: unknown): TriRaw[] {
  if (!Array.isArray(j)) return [];
  return j.map((r) => {
    const o: TriRaw = {};
    if (r && typeof r === "object") {
      for (const k of TRI_KEEP) {
        const v = (r as Record<string, unknown>)[k];
        if (v == null || typeof v === "string" || typeof v === "number") o[k] = v ?? null;
      }
    }
    return o;
  });
}

/** Form R section 5 media, as EPA names them (ENVIRONMENTAL_MEDIUM). */
export const TRI_MEDIUM: Record<string, string> = {
  "AIR FUG": "fugitive air",
  "AIR STACK": "stack air",
  WATER: "surface water",
  UNINJ8795: "underground injection (1987-1995)",
  "UNINJ I": "underground injection, Class I wells",
  "UNINJ IIV": "underground injection, Class II-V wells",
  LANDF8795: "on-site landfill (1987-1995)",
  "RCRA C": "on-site RCRA Subtitle C landfill",
  "OTH LANDF": "other on-site landfill",
  "LAND TREA": "on-site land treatment",
  "SURF IMP": "on-site surface impoundment",
  "SI 5.5.3A": "on-site RCRA Subtitle C surface impoundment",
  "SI 5.5.3B": "other on-site surface impoundment",
  "OTH DISP": "other on-site land disposal",
};

/** RELEASE_BASIS_EST_CODE. */
export const TRI_BASIS: Record<string, string> = {
  M1: "continuous monitoring",
  M2: "periodic or random monitoring",
  M: "monitoring",
  C: "mass balance",
  E1: "published emission factors",
  E2: "site-specific emission factors",
  E: "published emission factors",
  O: "other approaches (engineering calculation or judgment)",
  X: "invalid entry",
  N: "not applicable",
};

/** RELEASE_RANGE_CODE (stored numbers; Form R letters in brackets). */
export const TRI_RANGE: Record<string, string> = {
  "1": "range A: 1-10 pounds",
  "2": "1-499 pounds (historical range)",
  "3": "range B: 11-499 pounds",
  "4": "range C: 500-999 pounds",
};

export interface TriRelease {
  chemical: string | null;
  cas: string | null;
  medium: string | null;
  mediumLabel: string | null;
  /** The reported amount; null when none was reported (not applicable, or a range report). */
  amount: number | null;
  unit: string | null;
  basis: string | null;
  /** A range report: the range, not a number. */
  range: string | null;
  /** "NA" was entered on Form R for this medium. */
  notApplicable: boolean;
}

export interface TriFormA {
  chemical: string | null;
  cas: string | null;
}

export interface TriTotal {
  medium: string;
  mediumLabel: string;
  unit: string;
  amount: number;
  /** Rows summed; range reports and not-applicable rows are never in a total. */
  rows: number;
}

function s(v: unknown): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t ? t : null;
}

/** Form R rows (form_type_ind L) as releases. A total_release that is not a finite number is null, never 0. */
export function triReleases(raw: TriRaw[]): TriRelease[] {
  return raw
    .filter((r) => s(r.form_type_ind) === "L")
    .map((r) => {
      const medium = s(r.environmental_medium);
      const range = s(r.release_range_code);
      const na = s(r.release_na) === "1";
      const n = typeof r.total_release === "number" ? r.total_release : s(r.total_release) != null ? Number(r.total_release) : NaN;
      const basis = s(r.release_basis_est_code);
      return {
        chemical: s(r.cas_chem_name),
        cas: s(r.cas_registry_number),
        medium,
        mediumLabel: medium ? (TRI_MEDIUM[medium] ?? medium) : null,
        amount: range || na || !Number.isFinite(n) ? null : n,
        unit: s(r.unit_of_measure),
        basis: basis ? (TRI_BASIS[basis] ?? basis) : null,
        range: range ? (TRI_RANGE[range] ?? `range code ${range}`) : null,
        notApplicable: na,
      };
    });
}

/** Form A certifications: the chemicals, never a quantity. */
export function triFormA(raw: TriRaw[]): TriFormA[] {
  const seen = new Set<string>();
  const out: TriFormA[] = [];
  for (const r of raw) {
    if (s(r.form_type_ind) !== "S") continue;
    const k = `${s(r.cas_registry_number)}|${s(r.cas_chem_name)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ chemical: s(r.cas_chem_name), cas: s(r.cas_registry_number) });
  }
  return out;
}

/** Totals per medium AND unit: pounds and grams (dioxins) are never added together. */
export function triTotals(rows: TriRelease[]): TriTotal[] {
  const by = new Map<string, TriTotal>();
  for (const r of rows) {
    if (r.amount == null || !r.medium || !r.unit) continue;
    const k = `${r.medium}|${r.unit}`;
    const t = by.get(k) ?? { medium: r.medium, mediumLabel: r.mediumLabel ?? r.medium, unit: r.unit, amount: 0, rows: 0 };
    t.amount += r.amount;
    t.rows += 1;
    by.set(k, t);
  }
  return [...by.values()].map((t) => ({ ...t, amount: Math.round(t.amount * 1e6) / 1e6 })).sort((a, b) => a.unit.localeCompare(b.unit) || b.amount - a.amount);
}

export const TRI_CAVEAT =
  "What the facility reported to TRI for that year, in its reported units and estimation basis. Reported releases are not exposure or concentration. 'Not applicable' and range reports are shown as such and never counted in a total; totals are per medium and unit, so pounds and grams are never added. A Form A certifies a chemical without reporting quantities. Small facilities and some chemicals are not required to report.";

/** The years to try when none is asked for: the newest complete reporting year (two behind the calendar), then the one before. */
export function triDefaultYears(now = new Date()): number[] {
  const y = now.getUTCFullYear() - 2;
  return [y, y - 1];
}
