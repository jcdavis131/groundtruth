"use client";
// Take the data with you: what the water layers currently hold, as files.

import type { Point } from "geojson";
import { getRenderer } from "@/lib/globe/registry";
import type { LayerFeature } from "@/lib/layers/types";
import type { ChipExtra } from "@/lib/layers/turbidity";
import type { GaugeExtra, ReservoirExtra } from "@/lib/water/features";
import type { AreaExtra, CrossingExtra, PortExtra } from "@/lib/economy/features";
import { useGlobe } from "@/lib/store/globe";

export function downloadText(filename: string, text: string, mime = "text/plain") {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  useGlobe.getState().pushLog({ level: "info", text: `Saved ${filename}` });
}

function stamp(): string {
  return new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
}

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Turbidity chips as GeoJSON, scene provenance on every feature. */
export function chipsGeoJson(): { count: number; text: string } {
  const r = getRenderer("turbidity");
  const features = r ? [...r.features()] : [];
  const out = {
    type: "FeatureCollection",
    generated: new Date().toISOString(),
    method: "Dogliotti et al. 2015 single-band turbidity on Sentinel-2 L2A water pixels; 640 m chips; estimates, not measurements",
    features: features.map((f) => {
      const x = f.properties.extra as ChipExtra;
      return {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [x.bounds.west, x.bounds.south],
              [x.bounds.east, x.bounds.south],
              [x.bounds.east, x.bounds.north],
              [x.bounds.west, x.bounds.north],
              [x.bounds.west, x.bounds.south],
            ],
          ],
        },
        properties: {
          id: f.properties.id,
          median_fnu: x.stats.median,
          p10_fnu: x.stats.p10,
          p90_fnu: x.stats.p90,
          mean_fnu: x.stats.mean,
          water_pixels: x.stats.n,
          total_pixels: x.totalPixels,
          low_confidence: x.lowConfidence,
          scene_id: x.scene.id,
          scene_datetime: x.scene.datetime,
          scene_cloud_pct: x.scene.cloud,
          window_cloud_pct: x.scene.localCloud * 100,
          ground_pixel_m: x.scene.pixelM,
          dn_convention: x.scene.convention,
          dn_check_pass: x.scene.check.pass,
          stac_item: x.scene.stacUrl,
          gauge_site: x.insitu?.site,
          gauge_distance_m: x.insitu?.distanceM,
          gauge_latest_fnu: x.insitu?.latest.value,
          gauge_at_overpass_fnu: x.insitu?.atOverpass?.value,
        },
      };
    }),
  };
  return { count: features.length, text: JSON.stringify(out) };
}

/** Every gauge / reservoir reading in the surface-water layer as CSV. */
export function gaugesCsv(): { count: number; text: string } {
  const r = getRenderer("water");
  const rows: string[] = ["feature_id,site,name,kind,lon,lat,parameter,value,unit,observed,flood_category,quality_index,source"];
  let n = 0;
  if (r) {
    for (const f of r.features() as IterableIterator<LayerFeature<Point>>) {
      const k = f.properties.kind;
      if (k !== "gauge" && k !== "reservoir" && k !== "flood-gauge") continue;
      n++;
      const [lon, lat] = f.geometry.coordinates;
      const x = f.properties.extra as GaugeExtra | ReservoirExtra;
      if ("readings" in x) {
        const entries = Object.entries(x.readings);
        if (entries.length === 0) {
          rows.push(
            [f.properties.id, x.site, f.properties.name, k, lon, lat, "", "", "", "", x.flood?.category ?? "", "", f.properties.source]
              .map(csvCell)
              .join(","),
          );
        }
        for (const [param, rd] of entries) {
          if (!rd) continue;
          rows.push(
            [f.properties.id, x.site, f.properties.name, k, lon, lat, param, rd.value, rd.unit, rd.time, x.flood?.category ?? "", x.index?.score ?? "", f.properties.source]
              .map(csvCell)
              .join(","),
          );
        }
      } else {
        rows.push(
          [f.properties.id, f.properties.id.replace("twdb:", ""), f.properties.name, k, lon, lat, "percent_full", x.percentFull ?? "", "%", "", "", "", f.properties.source]
            .map(csvCell)
            .join(","),
        );
      }
    }
  }
  return { count: n, text: rows.join("\n") };
}

/** Every county or state the two area layers hold, one row each, with every join. */
export function areasCsv(): { count: number; text: string } {
  const seen = new Map<string, { x: AreaExtra; anchor?: [number, number] }>();
  for (const layer of ["realestate", "commerce"] as const) {
    const r = getRenderer(layer);
    if (!r) continue;
    for (const f of r.features()) {
      const x = f.properties.extra as AreaExtra;
      const prev = seen.get(x.geoid);
      if (!prev) seen.set(x.geoid, { x, anchor: f.properties.anchor });
      else prev.x = { ...prev.x, jobs: prev.x.jobs ?? x.jobs, home: prev.x.home ?? x.home, rent: prev.x.rent ?? x.rent };
    }
  }
  const rows: string[] = [
    "geoid,level,name,state,metro,lon,lat,zhvi_usd,zhvi_as_of,zhvi_1y_pct,zhvi_5y_pct,zori_usd_month,zori_as_of,zori_1y_pct,price_to_rent,qcew_period,jobs,employers,avg_weekly_wage_usd,jobs_1y_pct,wage_1y_pct,qcew_suppressed",
  ];
  for (const { x, anchor } of seen.values()) {
    const h = x.home;
    const rt = x.rent;
    const j = x.jobs;
    rows.push(
      [
        x.geoid, x.level, x.name, x.stusab ?? x.stateName ?? "", x.metro ?? "", anchor?.[0] ?? "", anchor?.[1] ?? "",
        h?.latest != null ? Math.round(h.latest) : "", h?.asOf ?? "", h?.yoyPct?.toFixed(2) ?? "", h?.y5Pct?.toFixed(2) ?? "",
        rt?.latest != null ? Math.round(rt.latest) : "", rt?.asOf ?? "", rt?.yoyPct?.toFixed(2) ?? "",
        h && rt ? (h.latest / (rt.latest * 12)).toFixed(2) : "",
        j?.period ?? "", j?.emp ?? "", j?.estabs ?? "", j?.avgWeeklyWage ?? "", j?.yoy.emp ?? "", j?.yoy.avgWeeklyWage ?? "", j ? String(j.suppressed) : "",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return { count: seen.size, text: rows.join("\n") };
}

/** Harbours and land crossings the trade layer holds. */
export function tradeCsv(): { count: number; text: string } {
  const r = getRenderer("trade");
  const rows: string[] = [
    "feature_id,kind,name,country_or_state,lon,lat,harbour_size,harbour_type,channel_depth_m,locode,bts_year,container_teu,teu_rank,total_tons,tonnage_rank,trucks_month,trucks_latest,trucks_1y_pct,personal_vehicles_latest,pedestrians_latest,position_basis,source",
  ];
  let n = 0;
  if (r) {
    for (const f of r.features() as IterableIterator<LayerFeature<Point>>) {
      const k = f.properties.kind;
      if (k !== "port" && k !== "crossing") continue;
      n++;
      const [lon, lat] = f.geometry.coordinates;
      if (k === "port") {
        const x = f.properties.extra as PortExtra;
        const s = x.stats;
        rows.push(
          [
            f.properties.id, k, f.properties.name, x.wpi.country, lon, lat, x.wpi.size ?? "", x.wpi.type ?? "", x.wpi.channelM ?? "", x.wpi.locode ?? "",
            s?.year ?? "", s?.container?.total ?? "", s?.container?.ranking ?? "", s?.tonnage?.total ?? "", s?.tonnage?.ranking ?? "",
            "", "", "", "", "", s?.position ?? "World Port Index", f.properties.source,
          ]
            .map(csvCell)
            .join(","),
        );
      } else {
        const x = f.properties.extra as CrossingExtra;
        const t = x.measures.Trucks;
        rows.push(
          [
            f.properties.id, k, f.properties.name, x.state, lon, lat, "", x.border, "", "", "", "", "", "", "",
            t?.latestDate ?? x.asOf, t?.latest ?? "", t?.yoyPct?.toFixed(2) ?? "", x.measures["Personal Vehicles"]?.latest ?? "", x.measures.Pedestrians?.latest ?? "",
            "BTS port coordinates", f.properties.source,
          ]
            .map(csvCell)
            .join(","),
        );
      }
    }
  }
  return { count: n, text: rows.join("\n") };
}

export function exportAreas() {
  const { count, text } = areasCsv();
  if (!count) {
    useGlobe.getState().pushLog({ level: "warn", text: "No counties or states loaded to export (turn on Home values or Jobs & wages)." });
    return;
  }
  downloadText(`gev-areas-${stamp()}.csv`, text, "text/csv");
}

export function exportTrade() {
  const { count, text } = tradeCsv();
  if (!count) {
    useGlobe.getState().pushLog({ level: "warn", text: "No harbours or crossings loaded to export (turn on Ports & trade)." });
    return;
  }
  downloadText(`gev-ports-crossings-${stamp()}.csv`, text, "text/csv");
}

export function exportChips() {
  const { count, text } = chipsGeoJson();
  if (!count) {
    useGlobe.getState().pushLog({ level: "warn", text: "No turbidity chips loaded to export." });
    return;
  }
  downloadText(`turbidity-chips-${stamp()}.geojson`, text, "application/geo+json");
}

export function exportGauges() {
  const { count, text } = gaugesCsv();
  if (!count) {
    useGlobe.getState().pushLog({ level: "warn", text: "No gauges loaded to export; descend below 1,500 km first." });
    return;
  }
  downloadText(`water-gauges-${stamp()}.csv`, text, "text/csv");
}
