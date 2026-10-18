// Layer 10: ports & trade. Where goods enter and leave, and who trades with whom.
//
//   NGA World Port Index   3,807 harbours worldwide with size, depths and
//                          facilities (Pub 150, bundled snapshot)
//   BTS Port Performance   container TEU, tonnage, rankings and top commodities
//                          for the largest US ports, latest reporting year
//   BTS Border Crossings   monthly trucks, trains, vehicles and pedestrians at
//                          every US land port of entry, with 25-month traces
//   World Bank WDI         GDP, exports, imports, trade share and container
//                          throughput per country, most recent year each
//   WITS TradeStats        a country's top trading partners, drawn as arcs
//                          when it is selected
//
// Countries are always drawn; harbours appear by size as the camera
// descends (large from orbit, everything below 250 km); land crossings
// appear below 6,000 km.

import type { Point, FeatureCollection, MultiPolygon, Polygon } from "geojson";
import type { BaseProps, FetchContext, FetchResult, LayerDefinition, LayerFeature } from "./types";
import { proxy } from "./aircraft";
import { viewBbox } from "./water";
import type { CrossingExtra, PortExtra } from "@/lib/economy/features";

export type { CountryExtra, CrossingExtra, Partners, PortExtra, PortStats, WpiPort } from "@/lib/economy/features";

export const PORT_MAX_HEIGHT_M = 8_000_000;
export const CROSSING_MAX_HEIGHT_M = 6_000_000;

type Fc<G extends GeoJSON.Geometry> = FeatureCollection<G, BaseProps>;
interface Env<T> {
  data: T;
  source?: string;
  asOf?: string;
  btsYear?: number;
  withStats?: number;
  countriesWithData?: number;
  indicatorsFailed?: string[];
}

let countries: Promise<Env<Fc<Polygon | MultiPolygon>>> | null = null;
let countriesAt = 0;
let border: Promise<Env<Fc<Point>>> | null = null;
let borderAt = 0;

function memo<T>(slot: { p: Promise<T> | null; at: number }, ttl: number, ctx: FetchContext, make: () => Promise<T>): Promise<T> {
  if (!slot.p || ctx.now - slot.at > ttl) {
    slot.at = ctx.now;
    slot.p = make().catch((err) => {
      slot.p = null;
      throw err;
    });
  }
  return slot.p;
}

export function minPortSize(height: number): "large" | "medium" | "small" | "all" {
  if (height > 3_000_000) return "large";
  if (height > 900_000) return "medium";
  if (height > 250_000) return "small";
  return "all";
}

async function fetchTrade(ctx: FetchContext): Promise<FetchResult> {
  const notes: string[] = [];
  const sources: string[] = [];
  const features: LayerFeature[] = [];
  const h = ctx.view.height;

  const c = { p: countries, at: countriesAt };
  const cEnv = await memo(c, 12 * 3600_000, ctx, () => proxy<Fc<Polygon | MultiPolygon>>("/api/economy?op=countries", { ...ctx, signal: undefined })).catch((e: Error) => {
    notes.push(`World Bank: ${e.message.slice(0, 50)}`);
    return null;
  });
  countries = c.p;
  countriesAt = c.at;
  if (cEnv) {
    features.push(...(cEnv.data.features as LayerFeature[]));
    sources.push("World Bank");
    notes.push(`${cEnv.countriesWithData ?? cEnv.data.features.length} countries with trade data`);
  }

  if (h <= PORT_MAX_HEIGHT_M) {
    const min = minPortSize(h);
    // With the horizon in view there is no visible extent; cover the ground under the camera instead.
    const bbox = viewBbox(ctx, ctx.view.bbox ? 400_000 : Math.min(h, 4_000_000)).map((x) => x.toFixed(2)).join(",");
    const env: Env<Fc<Point>> | null = await proxy<Fc<Point>>(`/api/economy?op=ports&bbox=${bbox}&min=${min}`, ctx).catch((e: Error) => {
      notes.push(`ports: ${e.message.slice(0, 50)}`);
      return null;
    });
    if (env) {
      const ports = env.data.features as LayerFeature<Point>[];
      for (const f of ports) if ((f.properties.extra as PortExtra).stats) (f.properties.extra as PortExtra).labelled = true;
      features.push(...ports);
      sources.push("WPI");
      if (env.withStats) sources.push("BTS");
      notes.push(`${ports.length} harbours (${min === "all" ? "all sizes" : min + "+"})${env.withStats ? `, ${env.withStats} with BTS ${env.btsYear} volumes` : ""}`);
    }
  } else notes.push("descend below 8,000 km for harbours");

  if (h <= CROSSING_MAX_HEIGHT_M) {
    const b = { p: border, at: borderAt };
    const bEnv = await memo(b, 6 * 3600_000, ctx, () => proxy<Fc<Point>>("/api/economy?op=border", { ...ctx, signal: undefined })).catch((e: Error) => {
      notes.push(`crossings: ${e.message.slice(0, 50)}`);
      return null;
    });
    border = b.p;
    borderAt = b.at;
    if (bEnv) {
      const [w, s, e, n] = viewBbox(ctx, 600_000);
      const inView = (bEnv.data.features as LayerFeature<Point>[]).filter((f) => {
        const [lon, lat] = f.geometry.coordinates;
        return lon >= w - 2 && lon <= e + 2 && lat >= s - 2 && lat <= n + 2;
      });
      [...inView]
        .sort((p, q) => ((q.properties.extra as CrossingExtra).measures.Trucks?.latest ?? 0) - ((p.properties.extra as CrossingExtra).measures.Trucks?.latest ?? 0))
        .slice(0, 10)
        .forEach((f) => ((f.properties.extra as CrossingExtra).labelled = true));
      features.push(...inView);
      if (inView.length) {
        sources.push("BTS");
        notes.push(`${inView.length} land crossings (${bEnv.asOf ?? "latest month"})`);
      }
    }
  }

  return {
    collection: { type: "FeatureCollection", features },
    source: [...new Set(sources)].join(" + ") || "none",
    fetchedAt: ctx.now,
    note: notes.join(" · "),
    meta: { count: features.filter((f) => f.properties.kind !== "country").length },
  };
}

export const tradeLayer: LayerDefinition = {
  id: "trade",
  label: "Ports & trade",
  description:
    "Every harbour in the World Port Index with BTS volumes for the big US ports, every US land border crossing with monthly truck and traveller counts, and countries shaded by trade with their partners drawn on selection.",
  color: "#FFB454",
  updateIntervalMs: 60 * 60_000,
  defaultEnabled: false,
  viewDependent: true,
  attribution: "NGA World Port Index · BTS · World Bank WDI / WITS · Natural Earth",
  fetch: fetchTrade,
};
