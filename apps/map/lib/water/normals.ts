// Daily-mean discharge percentiles for a calendar day, from the USGS Water
// Data Statistics API (observationNormals, day of year). Keyless; one request
// answers many sites. The table for a site and a day changes only when USGS
// approves another year of record, so each site-day is cached for a month and
// a panning browser costs nothing.

import { cached } from "@/lib/server/cache";
import { polite, upstreamJson } from "@/lib/server/upstream";
import { parseNormals, type FlowNormals, type NormalsResponse } from "@/lib/fabric/condition";

export const STAT_URL = "https://api.waterdata.usgs.gov/statistics/v0/observationNormals";
/** Sites per upstream request (each site returns three short series). */
const CHUNK = 50;
const TTL_MS = 30 * 24 * 3600_000;
export const MAX_SITES = 200;

export function statUrl(sites: string[], month: number, day: number, next?: string): string {
  const q = new URLSearchParams();
  for (const s of sites) q.append("monitoring_location_id", `USGS-${s}`);
  const md = `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  q.set("parameter_code", "00060");
  q.set("computation_type", "percentile");
  q.set("normal_type", "DOY");
  q.set("start_date", md);
  q.set("end_date", md);
  q.set("page_size", "1000");
  if (next) q.set("next_token", next);
  return `${STAT_URL}?${q.toString()}`;
}

/** "USGS-08158000" or "08158000" to the bare site number. */
export function bareSite(s: string): string | null {
  const m = /^(?:USGS-)?(\d{8,15})$/.exec(s.trim());
  return m ? m[1] : null;
}

/** Percentiles for each site on one calendar day; a site with no table maps to null. */
export async function flowNormals(sites: string[], month: number, day: number): Promise<Record<string, FlowNormals | null>> {
  const clean = [...new Set(sites.map(bareSite).filter((s): s is string => !!s))].sort().slice(0, MAX_SITES);
  const out: Record<string, FlowNormals | null> = {};
  const chunks: string[][] = [];
  for (let i = 0; i < clean.length; i += CHUNK) chunks.push(clean.slice(i, i + CHUNK));
  await Promise.all(
    chunks.map(async (chunk) => {
      const r = await cached(`usgs-normals:${month}-${day}:${chunk.join(",")}`, TTL_MS, async () => {
        const found: Record<string, FlowNormals> = {};
        let next: string | undefined;
        for (let page = 0; page < 5; page++) {
          const res = await polite("usgs-stat", 150, 30_000, () => upstreamJson<NormalsResponse>("usgs-stat", statUrl(chunk, month, day, next), { timeoutMs: 30_000 }));
          Object.assign(found, parseNormals(res, month, day));
          next = res.next ?? undefined;
          if (!next) break;
        }
        return found;
      });
      for (const s of chunk) out[s] = r.value[s] ?? null;
    }),
  );
  return out;
}
