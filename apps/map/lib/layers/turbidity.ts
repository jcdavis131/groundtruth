// Layer 10: satellite turbidity estimates.
//
// The only layer that computes rather than relays. For the area under the
// camera it finds the latest low-cloud Sentinel-2 L2A scene on or before the
// mission clock, reads the bands it needs straight from the public COG
// bucket in a Web Worker, masks water and runs the Dogliotti (2015)
// semi-analytical turbidity algorithm on every water pixel, then reports
// 640 m chips as median / p10 / p90 FNU.
//
// What this is: the physics teacher that TurbidityVision is distilled from,
// run live. What it is not: TurbidityVision's fitted LightGBM heads (those
// are a separate artefact), an in-situ measurement, or a regulatory value.
// Where a USGS turbidity gauge sits inside a chip, its latest reading and its
// reading at the overpass are shown next to the estimate so the gap is visible.

import type { Point } from "geojson";
import type { GaugeReading } from "@/app/api/water/route";
import { lowConfidence, turbidityClass, type ChipStats } from "@/lib/water/dogliotti";
import { turbidityWorker } from "@/lib/water/turbidityWorker";
import type { Chip, SceneInfo } from "@/lib/water/turbidity.worker";
import type { UtmZone } from "@/lib/water/utm";
import { bboxAround, haversine } from "@/lib/globe/geo";
import type { BaseProps, FetchContext, FetchResult, LayerDefinition, LayerFeature, ViewState } from "./types";
import { proxy } from "./aircraft";

export const TURBIDITY_MAX_HEIGHT_M = 300_000;
const LOOKBACK_DAYS = 90;
const MAX_CLOUD = 40;
const MATCH_RADIUS_M = 1000;

export interface InSitu {
  site: string;
  name?: string;
  /** Metres from the gauge to the matched chip's centre (chips are 640 m wide). */
  distanceM: number;
  latest: { value: number; unit: string; time: string };
  /** Mean of USGS instantaneous values within ±2 h of the overpass, when available. */
  atOverpass?: { value: number; n: number; from: string; to: string };
}

export interface ChipExtra {
  stats: ChipStats;
  totalPixels: number;
  lowConfidence: boolean;
  scene: {
    id: string;
    datetime: string;
    cloud: number;
    localCloud: number;
    platform: string;
    convention: SceneInfo["convention"];
    check: SceneInfo["check"];
    overview: number;
    pixelM: number;
    stacUrl: string;
  };
  grid: { zone: UtmZone; originE: number; originN: number; chipM: number; i: number; j: number };
  bounds: { west: number; south: number; east: number; north: number };
  insitu?: InSitu;
}

function resolutionFor(height: number): number {
  if (height <= 40_000) return 10;
  if (height <= 100_000) return 20;
  if (height <= 200_000) return 40;
  return 80;
}

/**
 * Compute window: a square around the camera *target* (the reticle), never the
 * visible extent, which leans far ahead of the target whenever the camera is
 * tilted and would put the lakes under the reticle outside the read.
 */
function windowAround(view: ViewState, resolution: number): [number, number, number, number] {
  return bboxAround(view.lat, view.lon, (MAX_READ_PX * resolution) / 2);
}
const MAX_READ_PX = 1400;

async function fetchTurbidity(ctx: FetchContext): Promise<FetchResult> {
  const height = ctx.view.height;
  if (height > TURBIDITY_MAX_HEIGHT_M) {
    return {
      collection: { type: "FeatureCollection", features: [] },
      source: "Sentinel-2 L2A (Earth Search)",
      fetchedAt: ctx.now,
      note: `descend below ${TURBIDITY_MAX_HEIGHT_M / 1000} km over a lake or river to compute`,
      meta: { count: 0 },
    };
  }
  const resolution = resolutionFor(height);
  const bbox = windowAround(ctx.view, resolution);
  const before = ctx.missionTime ?? ctx.now;
  const res = await turbidityWorker.run({ bbox, before, lookbackDays: LOOKBACK_DAYS, maxCloud: MAX_CLOUD, resolution }, ctx.signal);
  if (res.type === "error") throw new Error(res.error);
  if (res.type === "empty") {
    return {
      collection: { type: "FeatureCollection", features: [] },
      source: "Sentinel-2 L2A (Earth Search)",
      fetchedAt: ctx.now,
      note: res.reason,
      meta: { count: 0 },
    };
  }
  const { scene, chips } = res;

  // In-situ turbidity gauges inside the computed window (USGS 63680).
  const [w, s, e, n] = res.window;
  let gauges: GaugeReading[] = [];
  try {
    const env = await proxy<GaugeReading[]>(
      `/api/water?op=gauges&param=63680&bbox=${[w, s, e, n].map((x) => x.toFixed(2)).join(",")}`,
      ctx,
    );
    gauges = env.data.filter((g) => g.lon >= w && g.lon <= e && g.lat >= s && g.lat <= n);
  } catch {
    gauges = [];
  }
  const overpass = Date.parse(scene.datetime);
  const from = new Date(overpass - 2 * 3600_000).toISOString().slice(0, 19) + "Z";
  const to = new Date(overpass + 2 * 3600_000).toISOString().slice(0, 19) + "Z";
  // A gauge on a 20 m river rarely sits inside a water chip (the explainer
  // found 8-9 water pixels per window on the San Antonio River), so match the
  // nearest chip within MATCH_RADIUS_M and print the distance.
  const insituByChip = new Map<string, InSitu>();
  await Promise.all(
    gauges.map(async (g) => {
      let chip: Chip | undefined;
      let best = MATCH_RADIUS_M;
      for (const c of chips) {
        const d = haversine(g.lat, g.lon, c.lat, c.lon);
        if (d < best) {
          best = d;
          chip = c;
        }
      }
      if (!chip) return;
      const prev = insituByChip.get(`${chip.i},${chip.j}`);
      if (prev && prev.distanceM <= best) return;
      const rec: InSitu = { site: g.site, name: g.name, distanceM: best, latest: { value: g.value, unit: g.unit.replace(/^_/, ""), time: g.time } };
      try {
        const m = await proxy<Array<[string, number, string]>>(
          `/api/water?op=matchup&site=${g.site}&param=63680&from=${from}&to=${to}`,
          ctx,
        );
        if (m.data.length) {
          rec.atOverpass = { value: m.data.reduce((a, x) => a + x[1], 0) / m.data.length, n: m.data.length, from, to };
        }
      } catch {
        /* the latest reading still shows */
      }
      insituByChip.set(`${chip.i},${chip.j}`, rec);
    }),
  );

  const features: LayerFeature<Point>[] = chips.map((c: Chip) => {
    const st = c.stats;
    const low = lowConfidence(st);
    const insitu = insituByChip.get(`${c.i},${c.j}`);
    const details: BaseProps["details"] = {
      "turbidity (est.)": `${st.median.toFixed(1)} FNU median · ${turbidityClass(st.median).replace("-", " ")}`,
      "spread p10–p90": `${st.p10.toFixed(1)} – ${st.p90.toFixed(1)} FNU (spatial spread inside the chip, not model uncertainty)`,
      confidence: low ? "LOW · spread wider than the median (explainer rule)" : "spread within the median",
      "water pixels": `${st.n} in the largest water body of ${c.waterPixels} masked (${((c.waterPixels / c.totalPixels) * 100).toFixed(1)} % of the chip${c.components > 1 ? `, ${c.components} bodies` : ""})`,
      method: "Dogliotti et al. 2015 single-band red/NIR, blended 0.05–0.07 ρ_red; water mask SCL 6 ∪ (NDWI > 0.05 ∧ ρB08 < 0.10)",
      scene: scene.id,
      acquired: scene.datetime.replace("T", " ").slice(0, 16) + "Z",
      "scene cloud": `${scene.cloud.toFixed(1)} % tile · ${(scene.localCloud * 100).toFixed(1)} % over this window${scene.candidates.length > 1 ? ` · ${scene.candidates.length} scenes inspected` : ""}`,
      "ground pixel": `${scene.pixelM} m (overview ${scene.overview})`,
      "dn to reflectance": `${scene.convention} · dark-water B8A ${scene.check.darkWaterB8A.toFixed(3)}, land NDVI ${scene.check.landNdvi.toFixed(2)}, negative ${(scene.check.negativeFraction * 100).toFixed(1)} % → ${scene.check.pass ? "pass" : "FAILED both, values suspect"}`,
      "stac item": scene.stacUrl,
    };
    if (insitu) {
      details["USGS gauge"] = `${insitu.name ?? insitu.site} · ${Math.round(insitu.distanceM)} m from the chip centre`;
      details["gauge latest"] = `${insitu.latest.value} ${insitu.latest.unit} at ${insitu.latest.time.replace("T", " ").slice(0, 16)}Z`;
      if (insitu.atOverpass) {
        const d = st.median - insitu.atOverpass.value;
        details["gauge at overpass ±2 h"] = `${insitu.atOverpass.value.toFixed(1)} FNU (n=${insitu.atOverpass.n}) · Δ estimate−gauge ${d >= 0 ? "+" : ""}${d.toFixed(1)} FNU`;
      } else {
        details["gauge at overpass ±2 h"] = "no instantaneous values retained for that window";
      }
    }
    return {
      type: "Feature",
      geometry: { type: "Point", coordinates: [c.lon, c.lat, 0] },
      properties: {
        id: `chip:${scene.id}:${c.i}:${c.j}`,
        layer: "turbidity",
        name: `${st.median.toFixed(1)} FNU est. · ${turbidityClass(st.median).replace("-", " ")}`,
        kind: turbidityClass(st.median),
        altitude: 0,
        observedAt: overpass,
        source: `Sentinel-2 ${scene.platform.replace("sentinel-", "").toUpperCase()} · Dogliotti physics`,
        details,
        extra: {
          stats: st,
          totalPixels: c.totalPixels,
          lowConfidence: low,
          scene: {
            id: scene.id,
            datetime: scene.datetime,
            cloud: scene.cloud,
            localCloud: scene.localCloud,
            platform: scene.platform,
            convention: scene.convention,
            check: scene.check,
            overview: scene.overview,
            pixelM: scene.pixelM,
            stacUrl: scene.stacUrl,
          },
          grid: { zone: scene.zone, originE: scene.originE, originN: scene.originN, chipM: scene.chipM, i: c.i, j: c.j },
          bounds: { west: c.west, south: c.south, east: c.east, north: c.north },
          insitu,
        } satisfies ChipExtra,
      },
    };
  });

  const medians = features.map((f) => (f.properties.extra as ChipExtra).stats.median).sort((a, b) => a - b);
  const mid = medians.length ? medians[Math.floor(medians.length / 2)] : NaN;
  const ageDays = Math.round((ctx.now - overpass) / 86_400_000);
  return {
    collection: { type: "FeatureCollection", features },
    source: "Sentinel-2 L2A via Earth Search + Dogliotti 2015",
    fetchedAt: ctx.now,
    note:
      `${features.length} chips · scene ${scene.datetime.slice(0, 10)} (${ageDays} d old, ${(scene.localCloud * 100).toFixed(0)} % cloud here)` +
      (medians.length ? ` · median ${mid.toFixed(1)} FNU` : "") +
      ` · ${insituByChip.size} gauge matchups · ${(scene.bytesRead / 1e6).toFixed(1)} MB read in ${(res.elapsedMs / 1000).toFixed(1)} s`,
    meta: { count: features.length, scene, window: res.window },
  };
}

export const turbidityLayer: LayerDefinition = {
  id: "turbidity",
  label: "Turbidity (Sentinel-2)",
  description:
    "Water turbidity estimated from the latest Sentinel-2 scene with the Dogliotti (2015) physics algorithm, in 640 m chips, next to in-situ USGS turbidity gauges.",
  color: "#E8A653",
  updateIntervalMs: 60 * 60_000,
  defaultEnabled: false,
  viewDependent: true,
  timeDependent: true,
  viewKey: (view) => {
    const r = resolutionFor(view.height);
    const q = r >= 40 ? 0.2 : 0.1;
    return `${Math.round(view.lon / q) * q},${Math.round(view.lat / q) * q},${r}`;
  },
  estimate: "estimate · physics teacher · not in-situ",
  attribution: "Copernicus Sentinel-2 via Element 84 Earth Search · Dogliotti et al. 2015 · USGS",
  fetch: fetchTurbidity,
};
