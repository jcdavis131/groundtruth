"use client";
// Fisherman mode: the cast, and the haul.
//
// A cast resolves the county under the click through /api/play (countyAt on
// the server). The haul comes from /api/ml?op=similar — county-sim-v1,
// k-nearest counties by Euclidean distance on standardized [12-month,
// 5-year, 10-year ZHVI change, 12-month rent change]. v1 uses home values +
// rents only: similar housing trajectories, not similar places in full.
// The panel says exactly that, with the model version, vintage and card.

import type { Haul, HaulItem } from "./store";

interface SimilarNeighbour {
  fips: string;
  name: string;
  state: string;
  distance: number;
  similarity: number;
}

interface SimilarData {
  fips: string;
  modelVersion: string;
  vintage: string;
  k: number;
  neighbours: SimilarNeighbour[];
  distance: string;
  modelCard: string;
}

interface SimilarEnvelope {
  data: SimilarData;
  caveats?: string[];
}

export class FishError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FishError";
  }
}

/** No county under the click: open water, not a failure. */
export function openWater(): FishError {
  return new FishError("Nothing biting here — that is open water. Cast on land.");
}

/** Map an /api/ml?op=similar envelope onto the haul the panel renders. */
export function toHaul(json: SimilarEnvelope): Haul {
  const d = json.data;
  const items: HaulItem[] = (d.neighbours ?? []).map((n) => ({
    fips: n.fips,
    name: n.name,
    state: n.state,
    distance: n.distance,
    similarity: n.similarity,
  }));
  const caveat =
    json.caveats?.[0] ??
    "v1 uses home values + rents only: similar housing trajectories, not similar places in full.";
  return {
    fips: d.fips,
    modelVersion: d.modelVersion,
    vintage: d.vintage,
    modelCard: d.modelCard,
    caveat,
    items,
  };
}

/**
 * Reel in the k nearest housing-trajectory twins of a county.
 * Throws FishError with panel-ready copy on every failure the route can
 * produce: the county is not in the embedding (404), or the service did
 * not answer. Never invents neighbours.
 */
export async function reelIn(fips: string, k = 8): Promise<Haul> {
  let res: Response;
  try {
    res = await fetch(`/api/ml?op=similar&fips=${encodeURIComponent(fips)}&k=${k}`);
  } catch {
    throw new FishError("The line snapped — the similarity service did not answer. Try the cast again.");
  }
  if (res.status === 404) {
    throw new FishError(
      "This county is not in the similarity embedding yet — it needs ten years of ZHVI. The hook came back empty.",
    );
  }
  if (!res.ok) {
    throw new FishError("The line snapped — the similarity service did not answer. Try the cast again.");
  }
  const json = (await res.json()) as SimilarEnvelope;
  if (!json.data || !Array.isArray(json.data.neighbours)) {
    throw new FishError("The catch slipped the net — the reply was not a neighbour list. Try the cast again.");
  }
  return toHaul(json);
}
