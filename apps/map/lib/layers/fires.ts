// Layer: active fires. Every thermal hotspot NASA's satellites detected
// worldwide in the last 24 hours.
//
//   NASA FIRMS   VIIRS 375 m (Suomi NPP, NOAA-20) and MODIS 1 km (Terra,
//                Aqua) near-real-time 24 h files, parsed on the server and
//                cut to the view; when a view holds more than 5,000, they are
//                binned and each cell shows its brightest detection (highest
//                fire radiative power) with the count it stands for; the
//                field, the strata rail and a construct's inside counts add
//                that count, not one per cell (lib/fabric/join.ts standsFor)
//
// Confidence stays on each instrument's scale: VIIRS publishes low / nominal
// / high, MODIS a 0–100 %. A hotspot is a hot pixel, not a confirmed
// wildfire: flares, volcanoes and hot industrial roofs show up too.

import type { Point } from "geojson";
import type { FireRow, Instrument } from "@/lib/hazards/features";
import { isoMinute } from "@/lib/hazards/features";
import { viewKey, type FetchContext, type FetchResult, type LayerDefinition, type LayerFeature, type ViewState } from "./types";
import { proxy } from "./aircraft";
import { viewBbox } from "./water";

export interface HotspotExtra {
  instrument: Instrument;
  satellite: string;
  /** VIIRS "low" | "nominal" | "high"; MODIS 0–100; undefined when blank. */
  confidence?: string | number;
  frp?: number;
  acquiredAt?: number;
  dayNight?: "D" | "N";
  /** Detections this point stands for when the view was binned. */
  count: number;
}

/** Above this camera height the whole planet is requested (and binned). */
export const FIRES_GLOBAL_HEIGHT_M = 3_000_000;

const SATELLITE: Record<string, string> = { N: "Suomi NPP", N20: "NOAA-20", N21: "NOAA-21", T: "Terra", A: "Aqua" };

interface FiresEnvelope {
  total?: number;
  returned?: number;
  cellDeg?: number | null;
  failed?: string[];
}

function buildHotspots(rows: FireRow[]): LayerFeature<Point>[] {
  return rows.map(([lon, lat, frp, t, sat, instrument, conf, dn, count]) => {
    const x: HotspotExtra = {
      instrument,
      satellite: SATELLITE[sat] ?? sat,
      confidence: conf ?? undefined,
      frp: frp ?? undefined,
      acquiredAt: t ?? undefined,
      dayNight: dn ?? undefined,
      count,
    };
    const confText =
      conf == null
        ? "not reported"
        : instrument === "VIIRS"
          ? `${conf} (VIIRS scale: low / nominal / high)`
          : `${conf} % (MODIS scale: 0–100 %)`;
    return {
      type: "Feature",
      geometry: { type: "Point", coordinates: [lon, lat, 0] },
      properties: {
        id: `firms:${sat}:${t ?? 0}:${lon.toFixed(4)},${lat.toFixed(4)}`,
        layer: "fires",
        name: `${instrument} hotspot${frp != null ? ` · ${frp.toFixed(1)} MW` : ""}`,
        kind: instrument.toLowerCase(),
        altitude: 0,
        observedAt: t ?? undefined,
        source: "NASA FIRMS",
        details: {
          satellite: x.satellite,
          instrument: instrument === "VIIRS" ? "VIIRS, 375 m pixels" : "MODIS, 1 km pixels",
          confidence: confText,
          "fire radiative power": frp != null ? `${frp} MW` : "not reported",
          acquired: isoMinute(t ?? undefined),
          overpass: dn === "D" ? "day" : dn === "N" ? "night" : undefined,
          "binned here": count > 1 ? `${count} detections in this cell; the brightest (max FRP) is shown` : undefined,
          "what this is": "a satellite thermal hotspot, not a confirmed fire; flares, volcanoes and hot roofs appear too",
        },
        extra: x,
      },
    };
  });
}

async function fetchFires(ctx: FetchContext): Promise<FetchResult> {
  const global = ctx.view.height > FIRES_GLOBAL_HEIGHT_M;
  const bbox = global ? [-180, -90, 180, 90] : viewBbox(ctx, Math.min(ctx.view.height * 1.5, 2_500_000));
  const env = await proxy<FireRow[]>(`/api/hazards?op=fires&bbox=${bbox.map((x) => x.toFixed(2)).join(",")}`, ctx);
  const meta = env as unknown as FiresEnvelope;
  const features = buildHotspots(env.data ?? []);
  const total = meta.total ?? features.length;
  const binned = meta.cellDeg != null;
  const notes = [
    `${total.toLocaleString()} detections in ${global ? "the last 24 h worldwide" : "view, last 24 h"}` +
      (binned ? ` · ${features.length.toLocaleString()} cells of ~${Math.round((meta.cellDeg ?? 0) * 111)} km, brightest shown` : ""),
  ];
  if (meta.failed?.length) notes.push(`missing: ${meta.failed.join(", ")}`);
  return {
    collection: { type: "FeatureCollection", features },
    source: "NASA FIRMS",
    fetchedAt: ctx.now,
    note: notes.join(" · "),
    meta: { count: total },
  };
}

export const firesLayer: LayerDefinition = {
  id: "fires",
  label: "Active fires",
  description:
    "Satellite thermal hotspots of the last 24 hours worldwide from NASA FIRMS (VIIRS 375 m and MODIS 1 km), with fire radiative power and each instrument's own confidence scale. Binned by the brightest detection when a view holds more than 5,000.",
  color: "#FF7A1A",
  updateIntervalMs: 15 * 60_000,
  defaultEnabled: false,
  viewDependent: true,
  // From orbit the request is the whole planet; panning there must not refetch it.
  viewKey: (v: ViewState) => (v.height > FIRES_GLOBAL_HEIGHT_M ? "global" : viewKey(v)),
  attribution: "NASA LANCE FIRMS (VIIRS, MODIS NRT), part of NASA ESDIS",
  fetch: fetchFires,
};
