// Layer: bank branches. Every FDIC-insured office in view with the deposits
// booked there.
//
//   FDIC BankFind /locations   every office of every insured institution:
//                              name, office name, business address, county,
//                              coordinates, service type, date established
//   FDIC Summary of Deposits   deposits per office as of June 30 each year,
//                              joined by certificate + office number
//
// Loads below BANKS_MAX_HEIGHT_M and asks the route for the counties under
// the camera (at most 25 per call; the route says "zoom in" otherwise).
// Institutions are legal entities and the addresses are business
// addresses; nothing here describes a person.

import type { FeatureCollection, Point } from "geojson";
import { bboxAround } from "@/lib/globe/geo";
import type { BranchExtra } from "@/lib/finance/features";
import type { BaseProps, FetchContext, FetchResult, LayerDefinition, ViewState } from "./types";
import { emptyCollection } from "./types";
import { proxy, type ProxyEnvelope } from "./aircraft";

export type { BranchExtra } from "@/lib/finance/features";

export const BANKS_MAX_HEIGHT_M = 300_000;
/** Half-width of the box asked for; a 120 km radius at 300 km height stays under 25 counties almost everywhere. */
export const BANKS_RADIUS_M = 120_000;

type BranchFc = FeatureCollection<Point, BaseProps>;
interface BanksMeta {
  caveats?: string[];
  sodYear?: number | null;
  counties?: number;
}

/** Box around the camera target, never the (possibly horizon-wide) view extent. Pure. */
export function banksBbox(view: Pick<ViewState, "lon" | "lat" | "height">): [number, number, number, number] {
  return bboxAround(view.lat, view.lon, Math.max(10_000, Math.min(view.height, BANKS_RADIUS_M)));
}

async function fetchBanks(ctx: FetchContext): Promise<FetchResult> {
  if (ctx.view.height > BANKS_MAX_HEIGHT_M) {
    return {
      collection: emptyCollection(),
      source: "FDIC BankFind Suite",
      fetchedAt: ctx.now,
      note: `descend below ${Math.round(BANKS_MAX_HEIGHT_M / 1000)} km for bank offices`,
      meta: { count: 0, level: "none" },
    };
  }
  const bbox = banksBbox(ctx.view).map((x) => x.toFixed(2)).join(",");
  let env: ProxyEnvelope<BranchFc> & BanksMeta;
  try {
    env = (await proxy<BranchFc>(`/api/finance?op=banks&bbox=${bbox}`, ctx)) as ProxyEnvelope<BranchFc> & BanksMeta;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // The route refuses boxes with more than 25 counties rather than paging FDIC; say so instead of failing the layer.
    if (/zoom in/i.test(msg)) return { collection: emptyCollection(), source: "FDIC BankFind Suite", fetchedAt: ctx.now, note: msg, meta: { count: 0 } };
    throw err;
  }
  const features = env.data.features;
  const withDeposits = features.filter((f) => (f.properties.extra as BranchExtra).deposits != null).length;
  const note = env.sodYear
    ? `${features.length} offices in ${env.counties ?? "?"} counties · ${withDeposits} with SOD ${env.sodYear} deposits`
    : `${features.length} offices in ${env.counties ?? "?"} counties · no Summary of Deposits year matched`;
  return {
    collection: { type: "FeatureCollection", features },
    source: env.source ?? "FDIC BankFind Suite",
    fetchedAt: ctx.now,
    note,
    meta: { count: features.length, counties: env.counties, sodYear: env.sodYear, withDeposits, caveats: env.caveats },
  };
}

export const banksLayer: LayerDefinition = {
  id: "banks",
  label: "Bank branches",
  description:
    "Every FDIC-insured office in view, sized by the deposits booked there in the annual Summary of Deposits, with the institution's quarterly ROA and noncurrent-loan trace and the county's deposit concentration (HHI, an estimate with its formula) on selection. Institutions only.",
  color: "#5EEAD4",
  updateIntervalMs: 6 * 60 * 60_000,
  defaultEnabled: false,
  viewDependent: true,
  estimate: "Deposit shares and the HHI are computed here from the FDIC Summary of Deposits; the formula is printed on selection",
  attribution: "FDIC BankFind Suite (institutions, locations, Summary of Deposits, financials) · US Census Bureau TIGERweb",
  fetch: fetchBanks,
};
