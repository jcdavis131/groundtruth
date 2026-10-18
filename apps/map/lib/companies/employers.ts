// Employer layer: ranked US employers by headcount, placed at HQ city.
// Built offline by scripts/employers-build.py from Forbes, DBpedia, and
// Wikidata. Headcounts are organization-wide as reported by each source.
//
// The bundle is imported at build time; queries are pure and synchronous.

import bundleJson from "./data/employers_ranked.json";

/** One ranked employer. */
export interface EmployerRecord {
  rank: number;
  name: string;
  employees: number;
  city?: string | null;
  state?: string | null;
  hq_state?: string | null;
  zip?: string | null;
  lat?: number | null;
  lon?: number | null;
  metro?: string | null;
  ticker?: string | null;
  cik?: number | null;
  source: string;
}

interface EmployerBundle {
  meta: {
    built: string;
    method: string;
    sources: Record<string, string>;
    coverage_note: string;
    zip_coverage?: string;
  };
  employers: EmployerRecord[];
}

export const EMPLOYER_BUNDLE: EmployerBundle =
  bundleJson as unknown as EmployerBundle;

/** All employers, already ranked. */
export function allEmployers(): EmployerRecord[] {
  return EMPLOYER_BUNDLE.employers;
}

/** Top N employers by headcount. */
export function topEmployers(limit = 100): EmployerRecord[] {
  return EMPLOYER_BUNDLE.employers.slice(0, Math.max(1, Math.min(limit, 2000)));
}

/** Employers with HQ in a ZIP code. */
export function employersInZip(zip: string): EmployerRecord[] {
  const z = zip.trim().slice(0, 5);
  return EMPLOYER_BUNDLE.employers.filter((e) => e.zip === z);
}

/** Employers with HQ in a metro (substring match on metro name). */
export function employersInMetro(q: string): EmployerRecord[] {
  const needle = q.trim().toLowerCase();
  return EMPLOYER_BUNDLE.employers.filter((e) =>
    (e.metro || "").toLowerCase().includes(needle)
  );
}

/** Search by name (case-insensitive substring). */
export function searchEmployers(q: string, limit = 50): EmployerRecord[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  return EMPLOYER_BUNDLE.employers
    .filter((e) => e.name.toLowerCase().includes(needle))
    .slice(0, Math.max(1, Math.min(limit, 200)));
}

/** Employers with map coordinates. */
export function placedEmployers(): EmployerRecord[] {
  return EMPLOYER_BUNDLE.employers.filter(
    (e) => e.lat != null && e.lon != null && Number.isFinite(e.lat) && Number.isFinite(e.lon)
  );
}

/** Bundle provenance for API responses. */
export function employerProvenance() {
  const m = EMPLOYER_BUNDLE.meta;
  return {
    built: m.built,
    method: m.method,
    sources: m.sources,
    coverage_note: m.coverage_note,
    zip_coverage: m.zip_coverage,
    count: EMPLOYER_BUNDLE.employers.length,
  };
}
