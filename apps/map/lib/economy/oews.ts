// BLS Occupational Employment and Wage Statistics for metropolitan areas,
// bundled as JSON rather than fetched. This lives apart from sources.ts on
// purpose: the index and the occupation mix are the only economy data a
// metro page can render with no egress at all, and importing them through
// sources.ts would also evaluate that module's ~4.4 MB of static imports
// (the World Port Index, the country polygons, the BTS port placements).
// So the dependency runs one way only — sources.ts re-exports from here.

import type { MsaIndexEntry, MsaJobs } from "./features";
import msaIndexJson from "./data/msa_index.json";
import msaJobsJson from "./data/msa_jobs.json";

export const OEWS_AS_OF = "May 2025";
const OEWS_SOURCE = "BLS Occupational Employment and Wage Statistics, May 2025 (MSA) + Census TIGERweb CBSA centroids";

const MSA_INDEX = msaIndexJson as unknown as MsaIndexEntry[];
const MSA_JOBS = msaJobsJson as unknown as Record<string, { top: MsaJobs["top"]; major: MsaJobs["major"] }>;
const MSA_BY_ID = new Map(MSA_INDEX.map((m) => [m.id, m]));

/** Every MSA: id, name, state, centroid, employment, distinctive major group. Static for the year. */
export function oewsMsaIndex(): { asOf: string; source: string; msas: MsaIndexEntry[] } {
  return { asOf: OEWS_AS_OF, source: OEWS_SOURCE, msas: MSA_INDEX };
}

/** Occupation mix for one MSA (5-digit CBSA code): top 30 detailed occupations + major-group rollup. */
export function oewsMsaJobs(msa: string): { asOf: string; source: string; data: MsaJobs } | null {
  const meta = MSA_BY_ID.get(msa);
  const j = MSA_JOBS[msa];
  if (!meta || !j) return null;
  return { asOf: OEWS_AS_OF, source: OEWS_SOURCE, data: { msa, name: meta.name, top: j.top, major: j.major } };
}
