// Layer 14: occupations. What people do for a living in every US metro.
//
//   BLS OEWS (May 2025, keyless bulk)   employment, mean wages and location
//                                       quotients for 800+ SOC occupations in
//                                       each of the 393 metropolitan areas.
//   Census TIGERweb CBSA                metro centroids.
//
// The SOC code is the universal taxonomy key shared with O*NET, so a role
// means the same thing in every city. Each metro is coloured by its most
// distinctive major group (highest location quotient): the thing that city
// does more than anywhere else. Selecting a metro loads its full occupation
// mix into the dossier.

import type { Point } from "geojson";
import type { MsaExtra, MsaIndexEntry } from "@/lib/economy/features";
import { fmtNum } from "@/lib/economy/features";
import type { FetchContext, FetchResult, LayerDefinition, LayerFeature } from "./types";
import { proxy } from "./aircraft";

interface MsasEnvelope {
  data: { asOf: string; source: string; msas: MsaIndexEntry[] };
  asOf?: string;
  source?: string;
}

let cached: Promise<MsasEnvelope> | null = null;
let cachedAt = 0;

function loadMsas(ctx: FetchContext): Promise<MsasEnvelope> {
  // The table is static for the vintage; refresh daily at most.
  if (!cached || ctx.now - cachedAt > 24 * 3600_000) {
    cachedAt = ctx.now;
    cached = proxy<MsasEnvelope["data"]>("/api/economy?op=msas", { ...ctx, signal: undefined }).catch((err) => {
      cached = null;
      throw err;
    });
  }
  return cached;
}

async function fetchOccupations(ctx: FetchContext): Promise<FetchResult> {
  const env = await loadMsas(ctx);
  const msas = env.data.msas;
  const features: LayerFeature<Point>[] = [];
  for (const m of msas) {
    if (!Number.isFinite(m.lat) || !Number.isFinite(m.lon)) continue;
    const extra: MsaExtra = { msa: m.id, name: m.name, state: m.state, emp: m.emp, domT: m.domT, domLq: m.domLq };
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [m.lon, m.lat, 0] },
      properties: {
        id: m.id,
        layer: "occupations",
        name: m.name,
        kind: m.dom,
        source: "BLS OEWS",
        details: {
          Employment: m.emp != null ? fmtNum(m.emp) : "n/a",
          "Distinctive sector": m.domT,
          "Concentration": m.domLq != null ? `${m.domLq.toFixed(2)}× national share` : "n/a",
        },
        extra,
      },
    });
  }
  return {
    collection: { type: "FeatureCollection", features },
    source: env.data.source,
    fetchedAt: ctx.now,
    note: `${features.length} metros · OEWS ${env.data.asOf} · colour = most distinctive occupation group`,
    meta: { count: features.length, asOf: env.data.asOf },
  };
}

export const occupationsLayer: LayerDefinition = {
  id: "occupations",
  label: "Occupations",
  description:
    "What people do for a living in every US metro: BLS occupation employment, wages and location quotients for 393 metropolitan areas, coloured by each city's most distinctive occupation group. Select a city for its full job mix.",
  color: "#7DD3A8",
  updateIntervalMs: 24 * 3600_000,
  defaultEnabled: false,
  viewDependent: false,
  attribution: "BLS OEWS May 2025 · US Census Bureau TIGERweb",
  fetch: fetchOccupations,
};
