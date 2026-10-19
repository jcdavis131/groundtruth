// Community water report: everything the water layers currently hold,
// aggregated around one point, with the arithmetic printed.
//
// Pure: takes feature lists, returns a report. The browser feeds it what the
// renderers hold (lib/water/reportClient.ts); /api/water?op=report feeds it
// features built server-side from the same upstreams (no turbidity there,
// that needs a browser).
//
// The report never invents a number. Each section names its inputs and the
// radius it searched; when a source is not loaded or empty the section says
// so and the stress estimate leaves that term out (and says which terms it
// kept). "Supply stress" is a weighted mean of normalised terms, formula
// shown in the panel, not a validated index.

import type { MultiPolygon, Point, Polygon } from "geojson";
import { haversine } from "@/lib/globe/geo";
import type { LayerFeature } from "@/lib/layers/types";
import type { ChipExtra } from "@/lib/layers/turbidity";
import type { Provenance } from "@/lib/provenance/types";
import { citationsOf, dedupeProvenance, iso } from "@/lib/provenance/collect";
import { DROUGHT_LABEL, floodLabel, type DroughtExtra, type GaugeExtra, type ReservoirExtra, type WellExtra } from "./features";
import { nwpsProvenance, sentinelProvenance, twdbProvenance, usdmProvenance, usgsProvenance, waterEstimateProvenance } from "./provenance";
import { fmtReading, PARAM_INFO } from "./quality";

export interface ReportItem {
  id: string;
  layer: "water" | "groundwater" | "turbidity";
  name: string;
  distanceKm: number;
  value: string;
  flag?: "ok" | "watch" | "poor";
}

export interface ReportSection<T = Record<string, unknown>> {
  title: string;
  loaded: boolean;
  radiusKm: number;
  n: number;
  summary: string;
  /** Prose: what the numbers are and are not. */
  basis: string;
  /** Machine-readable: which release each number came from; estimates carry their formula. */
  provenance: Provenance[];
  items: ReportItem[];
  data: T;
}

export interface StressTerm {
  name: string;
  weight: number;
  value: number;
  input: string;
}

export interface WaterReport {
  lon: number;
  lat: number;
  generatedAt: number;
  drought: ReportSection<{ dm: number | null }>;
  reservoirs: ReportSection<{ weightedPercentFull: number | null }>;
  gauges: ReportSection<{ flooding: number; meanQuality: number | null; stale: number; worst: "ok" | "watch" | "poor" | null }>;
  wells: ReportSection<{ aquifers: string[] }>;
  turbidity: ReportSection<{ medianFnu: number | null; scene: string | null }>;
  stress: { score: number | null; label: string; terms: StressTerm[]; formula: string; provenance: Provenance[] };
  caveats: string[];
  /** Every source the report used, de-duplicated across sections (estimates included). */
  provenance: Provenance[];
  /** One citation line per source, ready to paste. */
  citations: string[];
}

/** What the report reads. `loaded` says whether that source was fetched at all. */
export interface ReportSources {
  water: LayerFeature[];
  groundwater: LayerFeature[];
  turbidity: LayerFeature[];
  loaded: { water: boolean; groundwater: boolean; turbidity: boolean };
  /** Extra caveats from the caller (e.g. "server report: no turbidity"). */
  caveats?: string[];
}

export const REPORT_RADII_KM = { reservoirs: 150, gauges: 75, wells: 75, chips: 30 } as const;

function pointInRing(lon: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function pointInPolygon(lon: number, lat: number, poly: number[][][]): boolean {
  if (!poly[0] || !pointInRing(lon, lat, poly[0])) return false;
  for (let k = 1; k < poly.length; k++) if (pointInRing(lon, lat, poly[k])) return false;
  return true;
}

export function pointInGeometry(lon: number, lat: number, g: Polygon | MultiPolygon): boolean {
  if (g.type === "Polygon") return pointInPolygon(lon, lat, g.coordinates);
  return g.coordinates.some((p) => pointInPolygon(lon, lat, p));
}

function km(lon: number, lat: number, f: LayerFeature<Point>): number {
  return haversine(lat, lon, f.geometry.coordinates[1], f.geometry.coordinates[0]) / 1000;
}

function stressLabel(score: number): string {
  if (score < 0.25) return "low";
  if (score < 0.5) return "moderate";
  if (score < 0.75) return "high";
  return "severe";
}

export function buildWaterReport(lon: number, lat: number, src: ReportSources, now = Date.now()): WaterReport {
  const caveats: string[] = [...(src.caveats ?? [])];
  const R = REPORT_RADII_KM;
  const at = iso(now);
  const latestIso = (t: number) => (t > 0 ? new Date(t).toISOString() : undefined);

  // Drought: max class over every USDM polygon containing the point.
  let dm: number | null = null;
  const droughtFeatures = src.groundwater.filter((f) => f.properties.kind === "drought");
  for (const f of droughtFeatures) {
    const x = f.properties.extra as DroughtExtra;
    if (pointInGeometry(lon, lat, f.geometry as Polygon | MultiPolygon)) dm = Math.max(dm ?? -1, x.dm);
  }
  const drought: WaterReport["drought"] = {
    title: "Drought",
    loaded: droughtFeatures.length > 0,
    radiusKm: 0,
    n: droughtFeatures.length,
    summary:
      droughtFeatures.length === 0
        ? "Drought Monitor not loaded (turn on Aquifers & drought)"
        : dm == null
          ? "No drought class at this point (USDM covers the United States only)"
          : DROUGHT_LABEL[dm],
    basis: "US Drought Monitor current week; the highest class of any polygon containing the point.",
    provenance: droughtFeatures.length ? [usdmProvenance(at)] : [],
    items: [],
    data: { dm },
  };

  // Reservoirs: capacity-weighted percent full within 150 km (TWDB only; USGS reservoirs carry elevation but no capacity).
  const resItems: ReportItem[] = [];
  let capSum = 0;
  let storSum = 0;
  let twdbLatest = 0;
  let usgsResLatest = 0;
  for (const f of src.water as LayerFeature<Point>[]) {
    if (f.properties.kind !== "reservoir" || f.geometry.type !== "Point") continue;
    const d = km(lon, lat, f);
    if (d > R.reservoirs) continue;
    const x = f.properties.extra as ReservoirExtra | GaugeExtra;
    if ("percentFull" in x && x.percentFull != null && x.capacityAcFt) {
      twdbLatest = Math.max(twdbLatest, f.properties.observedAt ?? 0);
      capSum += x.capacityAcFt;
      storSum += (x.capacityAcFt * x.percentFull) / 100;
      resItems.push({
        id: f.properties.id,
        layer: "water",
        name: f.properties.name,
        distanceKm: d,
        value: `${x.percentFull.toFixed(0)} % full · ${Math.round(x.capacityAcFt / 1000).toLocaleString()}k ac-ft`,
        flag: x.percentFull < 30 ? "poor" : x.percentFull < 60 ? "watch" : "ok",
      });
    } else if ("readings" in x) {
      const r = x.readings["00062"] ?? x.readings["00054"];
      if (r) {
        usgsResLatest = Math.max(usgsResLatest, f.properties.observedAt ?? 0);
        resItems.push({
          id: f.properties.id,
          layer: "water",
          name: f.properties.name,
          distanceKm: d,
          value: `${fmtReading(x.readings["00062"] ? "00062" : "00054", r)} (USGS, no capacity on file)`,
        });
      }
    }
  }
  resItems.sort((a, b) => a.distanceKm - b.distanceKm);
  const weighted = capSum > 0 ? (storSum / capSum) * 100 : null;
  const reservoirProvenance: Provenance[] = [];
  if (capSum > 0) reservoirProvenance.push(twdbProvenance(latestIso(twdbLatest), at));
  if (usgsResLatest > 0) reservoirProvenance.push(usgsProvenance({ collection: "latest-continuous", params: ["00062", "00054"], period: latestIso(usgsResLatest), retrievedAt: at }));
  if (weighted != null)
    reservoirProvenance.push(waterEstimateProvenance("twdb", `weighted percent full = Σ(capacity × percent full) / Σ capacity = ${Math.round(storSum).toLocaleString()} / ${Math.round(capSum).toLocaleString()} ac-ft = ${weighted.toFixed(1)} %`, at));
  const reservoirs: WaterReport["reservoirs"] = {
    title: "Reservoirs",
    loaded: src.loaded.water,
    radiusKm: R.reservoirs,
    n: resItems.length,
    summary: !src.loaded.water
      ? "Surface water layer not loaded"
      : resItems.length === 0
        ? "No reservoir gauges within 150 km (or the camera is above the gauge altitude)"
        : weighted != null
          ? `${weighted.toFixed(0)} % of conservation capacity, weighted over ${resItems.filter((i) => i.flag).length} TWDB reservoirs`
          : `${resItems.length} USGS reservoir gauges, no capacity figures to weight`,
    basis:
      "Σ(capacity × percent full) / Σ capacity over TWDB reservoirs within 150 km. Texas only; elsewhere USGS reservoir elevation/storage is listed without a capacity to normalise by.",
    provenance: reservoirProvenance,
    items: resItems.slice(0, 8),
    data: { weightedPercentFull: weighted },
  };

  // Gauges: flood status and quality screening within 75 km.
  const gItems: ReportItem[] = [];
  let flooding = 0;
  let stale = 0;
  const scores: number[] = [];
  let worst: "ok" | "watch" | "poor" | null = null;
  const rank = { ok: 0, watch: 1, poor: 2 };
  const gaugeParams = new Set<string>();
  let gaugeLatest = 0;
  let floodLatest: string | null = null;
  let usgsGauges = 0;
  let nwpsGauges = 0;
  for (const f of src.water as LayerFeature<Point>[]) {
    const k = f.properties.kind;
    if ((k !== "gauge" && k !== "flood-gauge") || f.geometry.type !== "Point") continue;
    const d = km(lon, lat, f);
    if (d > R.gauges) continue;
    const x = f.properties.extra as GaugeExtra;
    if (k === "gauge") {
      usgsGauges++;
      for (const c of Object.keys(x.readings)) gaugeParams.add(c);
      gaugeLatest = Math.max(gaugeLatest, f.properties.observedAt ?? 0);
    }
    if (x.flood) {
      nwpsGauges++;
      if (x.flood.validTime && (!floodLatest || x.flood.validTime > floodLatest)) floodLatest = x.flood.validTime;
    }
    const cat = x.flood?.category;
    const isFlooding = cat === "minor" || cat === "moderate" || cat === "major";
    if (isFlooding) flooding++;
    if (x.stale) stale++;
    if (x.index) {
      scores.push(x.index.score);
      if (!worst || rank[x.index.worst] > rank[worst]) worst = x.index.worst;
    }
    const primary = x.primary ? x.readings[x.primary] : undefined;
    const parts: string[] = [];
    if (primary && x.primary) parts.push(`${PARAM_INFO[x.primary]?.short ?? x.primary} ${fmtReading(x.primary, primary)}`);
    if (x.index) parts.push(`quality ${(x.index.score * 100).toFixed(0)} % (${x.index.n})`);
    if (cat && cat !== "not_defined") parts.push(floodLabel(cat));
    if (x.stale) parts.push("STALE");
    gItems.push({
      id: f.properties.id,
      layer: "water",
      name: f.properties.name,
      distanceKm: d,
      value: parts.join(" · ") || "no readings",
      flag: isFlooding ? "poor" : x.index?.worst,
    });
  }
  gItems.sort((a, b) => (a.flag === "poor" ? -1 : b.flag === "poor" ? 1 : a.distanceKm - b.distanceKm));
  const meanQuality = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  const gaugeProvenance: Provenance[] = [];
  if (usgsGauges) gaugeProvenance.push(usgsProvenance({ collection: "latest-continuous", params: [...gaugeParams].sort(), period: latestIso(gaugeLatest), retrievedAt: at, notes: [`${usgsGauges} sites within ${R.gauges} km`] }));
  if (nwpsGauges) gaugeProvenance.push(nwpsProvenance(at, floodLatest));
  if (meanQuality != null)
    gaugeProvenance.push(waterEstimateProvenance("usgs-water", `quality screen per site = 1 − points / (2 × n), ok 0, watch 1, poor 2 points over the n parameters it reports; mean over ${scores.length} sites = ${(meanQuality * 100).toFixed(0)} %`, at, ["thresholds: EPA freshwater criteria (DO ≥ 5 mg/L, pH 6.5–9, conductance, turbidity, temperature)"]));
  const gauges: WaterReport["gauges"] = {
    title: "Stream gauges",
    loaded: src.loaded.water,
    radiusKm: R.gauges,
    n: gItems.length,
    summary: !src.loaded.water
      ? "Surface water layer not loaded"
      : gItems.length === 0
        ? "No gauges within 75 km (descend below 1,500 km to load them)"
        : `${gItems.length} gauges · ${flooding} flooding · ${scores.length} with quality panels` +
          (meanQuality != null ? ` averaging ${(meanQuality * 100).toFixed(0)} %` : "") +
          (stale ? ` · ${stale} stale` : ""),
    basis:
      "USGS latest readings screened against EPA freshwater criteria (DO ≥ 5 mg/L, pH 6.5–9, conductance, turbidity, temperature); NWS flood categories where a NWPS gauge is co-located.",
    provenance: gaugeProvenance,
    items: gItems.slice(0, 10),
    data: { flooding, meanQuality, stale, worst },
  };

  // Wells: aquifers and latest levels within 75 km.
  const wItems: ReportItem[] = [];
  const aquifers = new Set<string>();
  const wellParams = new Set<string>();
  let wellLatest = 0;
  for (const f of src.groundwater as LayerFeature<Point>[]) {
    if (f.properties.kind !== "well" || f.geometry.type !== "Point") continue;
    const d = km(lon, lat, f);
    if (d > R.wells) continue;
    const x = f.properties.extra as WellExtra;
    if (x.aquifer) aquifers.add(x.aquifer);
    for (const c of Object.keys(x.readings)) wellParams.add(c);
    wellLatest = Math.max(wellLatest, f.properties.observedAt ?? 0);
    const r = x.readings[x.primary];
    wItems.push({
      id: f.properties.id,
      layer: "groundwater",
      name: x.aquifer ?? f.properties.name,
      distanceKm: d,
      value: r ? `${PARAM_INFO[x.primary]?.short ?? x.primary} ${fmtReading(x.primary, r)} · ${r.time.slice(0, 10)}` : "no reading",
      flag: x.stale ? "watch" : undefined,
    });
  }
  wItems.sort((a, b) => a.distanceKm - b.distanceKm);
  const wells: WaterReport["wells"] = {
    title: "Groundwater",
    loaded: src.loaded.groundwater,
    radiusKm: R.wells,
    n: wItems.length,
    summary: !src.loaded.groundwater
      ? "Aquifers & drought layer not loaded"
      : wItems.length === 0
        ? "No USGS monitoring wells within 75 km (or above 1,500 km)"
        : `${wItems.length} wells in ${aquifers.size} named aquifer${aquifers.size === 1 ? "" : "s"}: ${[...aquifers].slice(0, 3).join(", ")}${aquifers.size > 3 ? "…" : ""}`,
    basis:
      "USGS latest daily water levels. A single latest reading says where the table is, not which way it is moving; select a well for its 365-day trace.",
    provenance: wItems.length ? [usgsProvenance({ collection: "latest-daily", params: [...wellParams].sort(), period: latestIso(wellLatest), retrievedAt: at, notes: [`${wItems.length} wells within ${R.wells} km; aquifer names from USGS national-aquifer-codes`] })] : [],
    items: wItems.slice(0, 8),
    data: { aquifers: [...aquifers] },
  };

  // Turbidity: median of chip medians within 30 km.
  const tItems: ReportItem[] = [];
  const meds: number[] = [];
  let scene: string | null = null;
  let sceneRef: { id: string; datetime: string } | null = null;
  for (const f of src.turbidity as LayerFeature<Point>[]) {
    if (f.geometry.type !== "Point") continue;
    const d = km(lon, lat, f);
    if (d > R.chips) continue;
    const x = f.properties.extra as ChipExtra;
    meds.push(x.stats.median);
    scene = scene ?? `${x.scene.id} (${x.scene.datetime.slice(0, 10)})`;
    sceneRef = sceneRef ?? { id: x.scene.id, datetime: x.scene.datetime };
    if (x.insitu) {
      tItems.push({
        id: f.properties.id,
        layer: "turbidity",
        name: `gauge ${x.insitu.name ?? x.insitu.site} (${Math.round(x.insitu.distanceM)} m)`,
        distanceKm: d,
        value: `est. ${x.stats.median.toFixed(1)} vs gauge ${x.insitu.atOverpass ? x.insitu.atOverpass.value.toFixed(1) + " FNU at overpass" : x.insitu.latest.value + " FNU latest"}`,
      });
    }
  }
  meds.sort((a, b) => a - b);
  const medianFnu = meds.length ? meds[Math.floor(meds.length / 2)] : null;
  const turbidity: WaterReport["turbidity"] = {
    title: "Satellite turbidity",
    loaded: src.loaded.turbidity,
    radiusKm: R.chips,
    n: meds.length,
    summary: !src.loaded.turbidity
      ? "Turbidity layer not computed (turn it on below 300 km over water)"
      : meds.length === 0
        ? "No water chips within 30 km"
        : `${meds.length} chips · median ${medianFnu!.toFixed(1)} FNU · scene ${scene}`,
    basis:
      "Dogliotti (2015) physics estimate on Sentinel-2 L2A water pixels, 640 m chips; median of chip medians. An estimate, not an in-situ measurement.",
    provenance: sceneRef
      ? [
          sentinelProvenance(sceneRef.id, sceneRef.datetime, at),
          waterEstimateProvenance("sentinel-2", `Dogliotti et al. (2015) single-band turbidity on L2A water pixels, 640 m chips; median of ${meds.length} chip medians = ${medianFnu!.toFixed(1)} FNU`, at),
        ]
      : [],
    items: tItems.slice(0, 6),
    data: { medianFnu, scene },
  };

  // Supply stress: weighted mean of the normalised terms that exist.
  const terms: StressTerm[] = [];
  if (dm != null) terms.push({ name: "drought", weight: 0.35, value: dm / 4, input: `D${dm} / 4` });
  else if (drought.loaded) terms.push({ name: "drought", weight: 0.35, value: 0, input: "no drought class here" });
  if (weighted != null)
    terms.push({ name: "reservoirs", weight: 0.3, value: Math.max(0, Math.min(1, 1 - weighted / 100)), input: `1 − ${weighted.toFixed(0)} % / 100` });
  if (meanQuality != null) terms.push({ name: "quality", weight: 0.2, value: 1 - meanQuality, input: `1 − ${(meanQuality * 100).toFixed(0)} % / 100` });
  if (medianFnu != null)
    terms.push({
      name: "turbidity",
      weight: 0.15,
      value: Math.max(0, Math.min(1, Math.log10(Math.max(1, medianFnu)) / Math.log10(250))),
      input: `log10(${medianFnu.toFixed(1)}) / log10(250)`,
    });
  const wsum = terms.reduce((a, t) => a + t.weight, 0);
  const score = wsum > 0 ? terms.reduce((a, t) => a + t.weight * t.value, 0) / wsum : null;
  if (terms.length && terms.length < 4)
    caveats.push(`Stress uses ${terms.length} of 4 terms (${terms.map((t) => t.name).join(", ")}); missing terms are left out, not assumed.`);
  if (src.loaded.water && gItems.length === 0 && resItems.length === 0)
    caveats.push("Gauges load only when the camera is below 1,500 km; fly closer for the instrumented picture.");
  if (!drought.loaded) caveats.push("Turn on Aquifers & drought to add the Drought Monitor and wells.");
  caveats.push("Groundwater has no trend term: one latest level cannot say whether an aquifer is being drawn down.");

  const formula = terms.length ? `Σ wᵢ·termᵢ / Σ wᵢ = ${terms.map((t) => `${t.weight}×${t.value.toFixed(2)}`).join(" + ")} / ${wsum.toFixed(2)}` : "no terms available";
  const stressFrom = terms[0]?.name === "drought" ? "usdm" : terms[0]?.name === "reservoirs" ? "twdb" : terms[0]?.name === "turbidity" ? "sentinel-2" : "usgs-water";
  const stressProvenance: Provenance[] =
    score != null
      ? [waterEstimateProvenance(stressFrom, `supply stress = ${formula} = ${score.toFixed(2)}; terms ${terms.map((t) => `${t.name} (${t.input})`).join(", ")}`, at, ["a weighted mean of normalised terms, not a validated index"])]
      : [];
  const all = dedupeProvenance([drought.provenance, reservoirs.provenance, gauges.provenance, wells.provenance, turbidity.provenance, stressProvenance]);

  return {
    lon,
    lat,
    generatedAt: now,
    drought,
    reservoirs,
    gauges,
    wells,
    turbidity,
    stress: {
      score,
      label: score == null ? "insufficient data" : stressLabel(score),
      terms,
      formula,
      provenance: stressProvenance,
    },
    caveats,
    provenance: all,
    citations: citationsOf(all),
  };
}

/** Provenance of one report section by key, for callers that want to attach it next to a number. */
export function waterSectionProvenance(r: WaterReport): Record<"drought" | "reservoirs" | "gauges" | "wells" | "turbidity" | "stress", Provenance[]> {
  return { drought: r.drought.provenance, reservoirs: r.reservoirs.provenance, gauges: r.gauges.provenance, wells: r.wells.provenance, turbidity: r.turbidity.provenance, stress: r.stress.provenance };
}

/** Citation block for a report: one line per source, plus the estimate lines. */
export function waterCitations(r: WaterReport): string[] {
  return r.citations.length ? r.citations : citationsOf(r.provenance);
}

/** One-paragraph spoken/plain-text version for the voice agent and the log. */
export function speakReport(r: WaterReport): string {
  const parts: string[] = [];
  parts.push(r.drought.summary + ".");
  if (r.reservoirs.n) parts.push(r.reservoirs.summary + ".");
  if (r.gauges.n) parts.push(r.gauges.summary + ".");
  if (r.wells.n) parts.push(r.wells.summary + ".");
  if (r.turbidity.n) parts.push(r.turbidity.summary + ".");
  parts.push(
    r.stress.score == null
      ? "Not enough loaded data for a stress estimate."
      : `Estimated supply stress ${r.stress.label}, ${(r.stress.score * 100).toFixed(0)} percent, from ${r.stress.terms.map((t) => t.name).join(", ")}.`,
  );
  return parts.join(" ");
}

/** Multi-line plain text for clipboard / files: every section with its items and basis. */
export function reportAsText(r: WaterReport): string {
  const lines: string[] = [];
  lines.push(`Community water report · ${r.lat.toFixed(4)}, ${r.lon.toFixed(4)} · ${new Date(r.generatedAt).toISOString()}`);
  lines.push(
    `Supply stress (estimate): ${r.stress.score == null ? "insufficient data" : `${Math.round(r.stress.score * 100)} % · ${r.stress.label}`}`,
  );
  lines.push(`  ${r.stress.formula}`);
  for (const t of r.stress.terms) lines.push(`  ${t.name} w ${t.weight} = ${t.value.toFixed(2)} (${t.input})`);
  for (const s of [r.drought, r.reservoirs, r.gauges, r.wells, r.turbidity]) {
    lines.push("");
    lines.push(`${s.title}${s.radiusKm ? ` (≤ ${s.radiusKm} km)` : ""}: ${s.summary}`);
    for (const it of s.items) lines.push(`  - ${it.name} · ${it.value} · ${it.distanceKm.toFixed(0)} km${it.flag ? ` · ${it.flag}` : ""}`);
    lines.push(`  basis: ${s.basis}`);
  }
  lines.push("");
  for (const c of r.caveats) lines.push(`caveat: ${c}`);
  lines.push("Sources: USGS Water Data, NOAA NWPS, TWDB, US Drought Monitor, Copernicus Sentinel-2 via Earth Search. Estimates, not advice.");
  for (const c of waterCitations(r)) lines.push(`  - ${c}`);
  return lines.join("\n");
}
