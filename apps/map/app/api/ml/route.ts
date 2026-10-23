// ML serving API: the Phase 1 models behind honest envelopes.
//
//   /api/ml?op=forecast&fips=48453
//       momentum-v1 12-month ZHVI change forecast for a county: point, lo, hi
//       (empirical band), model version, data vintage, formula, model card.
//       422 when the county has < 25 months of history — the route refuses to
//       guess instead of inventing a number.
//   /api/ml?op=similar&fips=48453[&k=10]
//       county-sim-v1 k nearest counties by housing-trajectory embedding.
//       404 when the county is not in the embedding.
//
// Model weights/vectors are bundled (lib/ml/data/*.json, built by
// scripts/ml-train-momentum.mjs and scripts/ml-build-county-sim.mjs from the
// live Zillow files — the same files the economy history API reads); the route
// only fetches the county's latest ZHVI for the forecast features. CORS open,
// edge-cached, like the other practitioner routes. Every prediction links its
// model card. Estimate entries name their inputs (record rule).

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { cached } from "@/lib/server/cache";
import { jsonError, num } from "@/lib/server/upstream";
import type { Enveloped, Provenance } from "@/lib/provenance/types";
import { provenance } from "@/lib/provenance/types";
import { source } from "@/lib/provenance/sources";
import { zhviSeries } from "@/lib/economy/history/zillowHistory";
import {
  FORMULA,
  forecast12m,
  HORIZON_MONTHS,
  latestFeatures,
  MODEL_VERSION,
  type MomentumBundle,
  type RidgeModel,
} from "@/lib/ml/momentum_forecast";
import { nearest, SIM_VERSION } from "@/lib/ml/county_sim";
import momentumJson from "@/lib/ml/data/momentum_v1.json";
import simJson from "@/lib/ml/data/county_sim_v1.json";

export const maxDuration = 60;

const H = 3600_000;
const TTL_S = 6 * 3600;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
};

const MODEL_CARDS = {
  [MODEL_VERSION]:
    "https://github.com/jcdavis131/groundtruth/blob/master/apps/map/docs/model-cards/momentum-v1.md",
  [SIM_VERSION]:
    "https://github.com/jcdavis131/groundtruth/blob/master/apps/map/docs/model-cards/county-sim-v1.md",
} as const;

const ZILLOW_DATA_URL = "https://www.zillow.com/research/data/";

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status, headers: CORS });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

const momentum = momentumJson as unknown as MomentumBundle;
const ridge: RidgeModel = {
  version: momentum.version,
  lambda: momentum.lambda,
  mean: momentum.mean,
  sd: momentum.sd,
  yMean: momentum.yMean,
  weights: momentum.weights,
  residualP10: momentum.residualP10,
  residualP90: momentum.residualP90,
  vintage: momentum.vintage,
  nTrain: momentum.nTrain,
};

interface SimEntry {
  name: string;
  state: string;
  z: number[];
}
const simZ = new Map<string, SimEntry>(Object.entries((simJson as unknown as { counties: Record<string, SimEntry> }).counties));

interface BundleSource {
  publisher?: string;
  dataset?: string;
  release?: string;
  retrievedAt?: string;
}
const momentumSource = (momentumJson as unknown as { source?: BundleSource }).source;
const simSource = (simJson as unknown as { source?: BundleSource }).source;

function prov(method: string, at: string, src?: BundleSource): Provenance[] {
  const inputRetrievedAt = src?.retrievedAt ?? at;
  return [
    provenance(source("zillow-zhvi"), { kind: "published", retrievedAt: at }),
    provenance(source("zillow-zhvi"), {
      kind: "estimate",
      retrievedAt: at,
      method,
      inputs: [
        {
          sourceId: "zillow-zhvi",
          upstreamRecordUrl: ZILLOW_DATA_URL,
          retrievedAt: inputRetrievedAt,
          rowIdsAt: "data.fips",
        },
      ],
      notes: [
        `Trained on the Zillow ZHVI county file at vintage ${momentum.vintage} (see model card); features use the county's latest published months only.`,
      ],
    }),
  ];
}

async function opForecast(fips: string) {
  const at = new Date().toISOString();
  const s = await cached(`ml:forecast:${fips}`, 6 * H, async () => zhviSeries({ kind: "county", fips })).then((c) => c.value);
  if (!s) return bad(`no Zillow ZHVI row for county ${fips}`, 404);
  const pts = [...s.points].sort((a, b) => a.t - b.t).map((p) => p.v);
  if (pts.filter((v) => v != null).length < 25) {
    return NextResponse.json(
      { error: `insufficient history for ${fips}: need 25 months of ZHVI, have ${pts.filter((v) => v != null).length}. Refusing to guess.` },
      { status: 422, headers: CORS },
    );
  }
  const features = latestFeatures(pts);
  if (!features) {
    return NextResponse.json({ error: `unusable history for ${fips} (non-finite or extreme values). Refusing to guess.` }, { status: 422, headers: CORS });
  }
  const { point, lo, hi } = forecast12m(ridge, features);
  const data = {
    fips,
    modelVersion: MODEL_VERSION,
    vintage: momentum.vintage,
    horizonMonths: HORIZON_MONTHS,
    point,
    lo,
    hi,
    unit: "fraction (12-month ZHVI change)",
    band: "empirical p10/p90 residuals on the spatial holdout — a band, not a calibrated interval",
    formula: FORMULA,
    modelCard: MODEL_CARDS[MODEL_VERSION],
  };
  const body: Enveloped<typeof data> = {
    data,
    provenance: prov(FORMULA, at, momentumSource),
    generatedAt: at,
    caveats: [
      "Descriptive, not advice: a county is not a tradable asset.",
      "Zillow revises recent months, so live months are noisier than backtest months.",
      ...((momentumJson as unknown as { caveats?: string[] }).caveats ?? []),
    ],
  };
  return NextResponse.json(body, { headers: { ...CORS, "cache-control": `public, max-age=0, s-maxage=${TTL_S}, stale-while-revalidate=${TTL_S}` } });
}

function opSimilar(fips: string, k: number) {
  const at = new Date().toISOString();
  const res = nearest(simZ, fips, k);
  if (!res.length && !simZ.has(fips)) return bad(`county ${fips} is not in the similarity embedding (needs 10 years of ZHVI)`, 404);
  const data = {
    fips,
    modelVersion: SIM_VERSION,
    vintage: (simJson as unknown as { vintage: string }).vintage,
    k,
    neighbours: res.map((r) => ({ ...r, similarity: 1 / (1 + r.distance) })),
    distance: "Euclidean on standardized [12m, 5y, 10y ZHVI change, 12m rent change]",
    modelCard: MODEL_CARDS[SIM_VERSION],
  };
  const body: Enveloped<typeof data> = {
    data,
    provenance: prov("k-nearest neighbours by Euclidean distance on standardized [12m, 5y, 10y ZHVI change, 12m rent change]", at, simSource),
    generatedAt: at,
    caveats: [
      "v1 uses home values + rents only: similar housing trajectories, not similar places in full.",
      ...(((simJson as unknown as { caveats?: string[] }).caveats ?? [])),
    ],
  };
  return NextResponse.json(body, { headers: { ...CORS, "cache-control": `public, max-age=0, s-maxage=${TTL_S}, stale-while-revalidate=${TTL_S}` } });
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const op = q.get("op") ?? "";
  try {
    if (op === "forecast") {
      const fips = q.get("fips") ?? "";
      if (!/^\d{5}$/.test(fips)) return bad("fips=SSCCC (five-digit county FIPS) required");
      return await opForecast(fips);
    }
    if (op === "similar") {
      const fips = q.get("fips") ?? "";
      if (!/^\d{5}$/.test(fips)) return bad("fips=SSCCC (five-digit county FIPS) required");
      const k = Math.round(num(q.get("k"), 10, 1, 50));
      return opSimilar(fips, k);
    }
    return bad("unknown op: forecast | similar");
  } catch (err) {
    const res = jsonError(err);
    for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
    return res;
  }
}
