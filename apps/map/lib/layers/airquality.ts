// Layer: air quality. AirNow's hourly monitor observations, PRELIMINARY as
// AirNow requires on every display, each site credited to the agency that
// reported it and coloured by its highest published pollutant AQI (AirNow's
// NowCast AQI for ozone and particles, its 1-hour AQI for NO2) in EPA's AQI
// colours (lib/air/airnow.ts). A site that reported no AQI this hour is drawn
// "not rated", never green. Registered only when AIRNOW_ENABLED is on.
//
//   EPA AirNow   HourlyAQObs file (US, Canada, Mexico, US embassy monitors),
//                through /api/air, the newest published hour

import type { FetchContext, FetchResult, LayerDefinition, ViewState } from "./types";
import { proxy } from "./aircraft";
import { bboxAround } from "@/lib/globe/geo";
import { airFeature, rowSite, type AirExtra, type SiteRow } from "@/lib/air/airnow";

/** Above this camera height every site is asked for; below, a box around the target. */
export const AIR_WORLD_HEIGHT_M = 1_500_000;
const AIR_BOX_RADIUS_M = 800_000;

function airViewKey(v: ViewState): string {
  return v.height > AIR_WORLD_HEIGHT_M ? "world" : `${Math.round(v.lon / 3)},${Math.round(v.lat / 3)}`;
}

async function fetchAir(ctx: FetchContext): Promise<FetchResult> {
  const world = ctx.view.height > AIR_WORLD_HEIGHT_M;
  const bbox: [number, number, number, number] = world ? [-180, -90, 180, 90] : bboxAround(Math.round(ctx.view.lat / 3) * 3, Math.round(ctx.view.lon / 3) * 3, AIR_BOX_RADIUS_M);
  const env = await proxy<SiteRow[]>(`/api/air?op=sites&bbox=${bbox.map((x) => x.toFixed(2)).join(",")}`, ctx);
  const meta = env as unknown as { hourUtc?: string; sitesInFile?: number };
  const features = env.data.map((r) => airFeature(rowSite(r)));
  let rated = 0;
  let unhealthy = 0;
  for (const f of features) {
    const x = f.properties.extra as AirExtra;
    if (x.aqi != null) rated++;
    if ((x.aqi ?? 0) > 100) unhealthy++;
  }
  const hour = meta.hourUtc ? `${meta.hourUtc.slice(11, 16)} UTC` : "the newest hour";
  return {
    collection: { type: "FeatureCollection", features },
    source: "EPA AirNow (preliminary)",
    fetchedAt: ctx.now,
    note: `PRELIMINARY · ${features.length} monitoring sites${world ? "" : " near the view"}, hour of ${hour} · ${rated} with an AQI, ${unhealthy} above 100 · each credited to its reporting agency`,
    meta: { count: features.length },
  };
}

export const airqualityLayer: LayerDefinition = {
  id: "airquality",
  label: "Air quality (AirNow)",
  description:
    "Hourly air quality monitors from EPA AirNow (US, Canada, Mexico and US embassies), PRELIMINARY: AirNow's NowCast AQI for ozone, PM2.5 and PM10 and its 1-hour AQI for NO₂, computed from the concentrations each agency sent, with those concentrations, coloured by the highest AQI in EPA's colours. Sites with no AQI this hour are not rated.",
  color: "#00E400",
  updateIntervalMs: 20 * 60_000,
  defaultEnabled: false,
  viewDependent: true,
  viewKey: airViewKey,
  attribution: "U.S. EPA AirNow and its reporting agencies (preliminary data)",
  fetch: fetchAir,
};
