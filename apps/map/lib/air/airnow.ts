// AirNow's hourly observations file (HourlyAQObs_YYYYMMDDHH.dat, one row per
// monitoring site), US, Canada, Mexico and US embassy monitors. The reporting
// agencies send AirNow raw hourly concentrations; AirNow's file carries those
// concentrations and the AQI AirNow computes from them. Its fact sheet (Hourly
// AQ Obs File, "Last Updated August 2025") defines OZONE_AQI, PM10_AQI and
// PM25_AQI as the "NowCast Air Quality Index" (NowCast weighs the last 12
// hours) and NO2_AQI as the hourly "Air Quality Index for NO2"; the labels
// here say which is which.
//
// AirNow's Data Exchange Guidelines ("Last Updated August 2025", read
// 2026-09-26) govern how it is shown:
//   - "AirNow observational data are not fully verified or validated; these
//     data are subject to change and should be considered preliminary", and
//     displays "must indicate that these data are preliminary": the layer, each
//     feature and the dossier say PRELIMINARY;
//   - credit goes "first ... to the appropriate source federal, state, local,
//     and tribal air quality agencies and the EPA AirNow program": each site
//     names its reporting agency (the file's DataSource) before AirNow;
//   - values "should not be altered in any way and should be disseminated as
//     received": the AQI numbers and concentrations are shown as AirNow
//     published them;
//   - colours follow the AQI's own categories and RGB colours (EPA's Technical
//     Assistance Document for the Reporting of Daily Air Quality);
//   - reliance on the data "must be made known to the relevant federal, state,
//     local, and tribal air quality agencies and the EPA AirNow program", and
//     "Data users' contact information must be kept current": the guidelines
//     end with a form (name, title, email, phone, organization) to return to
//     dmc@airnowtech.org. See AIRNOW_ENABLED below.
// A site's colour is its highest published pollutant AQI, which is how the AQI
// names a place's air quality; the value and the pollutant are both shown. A
// site with no AQI this hour is drawn "not rated", never green.
//
// Pure: parsing and classing, tested on a captured file.

import { parseCsv } from "@/lib/economy/csv";
import type { LayerFeature } from "@/lib/layers/types";

/**
 * Whether the air quality layer is registered, listed in Explore and answered by
 * /api/air. OFF (2026-09-26), pending the operator's decision: AirNow's
 * guidelines ask each data user to make its reliance known and keep contact
 * details current by returning a form (name, title, email, phone, organization)
 * to dmc@airnowtech.org. That is a registration, and this project signs up for
 * nothing without the operator's explicit decision. Turn this on only after the
 * operator has sent that form (or has decided otherwise), and record the date and
 * the decision here and in the README's Air quality row.
 */
export const AIRNOW_ENABLED = false;

export const AIRNOW_OFF_MESSAGE =
  "The AirNow air quality layer is not enabled on this deployment: AirNow's Data Exchange Guidelines ask each data user to return a contact form to dmc@airnowtech.org, and the operator has not decided to yet.";

export const AIRNOW_FILES = "https://files.airnowtech.org/airnow";

/** The dated path AirNow publishes each hour's file under (UTC). */
export function hourlyAqObsUrl(hourUtcMs: number): string {
  const d = new Date(hourUtcMs);
  const y = d.getUTCFullYear();
  const ymd = `${y}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  const h = String(d.getUTCHours()).padStart(2, "0");
  return `${AIRNOW_FILES}/${y}/${ymd}/HourlyAQObs_${ymd}${h}.dat`;
}

export type Pollutant = "OZONE" | "PM25" | "PM10" | "NO2";
/** Which AQI the file carries for each pollutant (HourlyAQObs fact sheet): NowCast for ozone and particles, 1-hour for NO₂. */
export const AQI_LABEL: Record<Pollutant, string> = { OZONE: "ozone NowCast AQI", PM25: "PM2.5 NowCast AQI", PM10: "PM10 NowCast AQI", NO2: "NO₂ 1-hour AQI" };

/** One site's row, as the columns the route sends (see SITE_COLUMNS). */
export interface AirSite {
  aqsid: string;
  name?: string;
  lat: number;
  lon: number;
  /** The reporting agency (the file's DataSource). */
  agency?: string;
  /** Observation hour, ISO (UTC). */
  validAt?: string;
  aqi: Partial<Record<Pollutant, number>>;
  /** Raw hourly concentrations with the unit AirNow published. */
  conc: Array<{ param: string; value: number; unit?: string }>;
  reportingArea?: string;
  country?: string;
  state?: string;
}

const text = (v: string | undefined) => (v == null || v.trim() === "" ? undefined : v.trim());
function number(v: string | undefined): number | undefined {
  const s = text(v);
  if (s == null) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/** "09/26/2026" + "19:00" (UTC) -> ISO. */
function validIso(date: string | undefined, time: string | undefined): string | undefined {
  const m = (date ?? "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const t = (time ?? "").match(/^(\d{1,2}):(\d{2})$/);
  if (!m || !t) return undefined;
  return new Date(Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2]), Number(t[1]), Number(t[2]))).toISOString();
}

export interface ParsedAqObs {
  sites: AirSite[];
  inactive: number;
  noPosition: number;
}

/** Active sites with a position; inactive rows and rows at 0,0 are counted and left out. */
export function parseHourlyAqObs(csvText: string): ParsedAqObs {
  const rows = parseCsv(csvText.replace(/^﻿/, ""));
  const header = rows[0] ?? [];
  const at = (n: string) => header.indexOf(n);
  const need = ["AQSID", "Status", "Latitude", "Longitude"];
  for (const n of need) if (at(n) < 0) throw new Error(`AirNow HourlyAQObs: no ${n} column`);
  const col = Object.fromEntries(header.map((h, i) => [h, i])) as Record<string, number>;
  const get = (r: string[], n: string) => (col[n] != null ? r[col[n]] : undefined);
  const sites: AirSite[] = [];
  let inactive = 0;
  let noPosition = 0;
  for (const r of rows.slice(1)) {
    const aqsid = text(get(r, "AQSID"));
    if (!aqsid) continue;
    if (text(get(r, "Status")) !== "Active") {
      inactive++;
      continue;
    }
    const lat = number(get(r, "Latitude"));
    const lon = number(get(r, "Longitude"));
    if (lat == null || lon == null || (lat === 0 && lon === 0) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      noPosition++;
      continue;
    }
    const aqi: AirSite["aqi"] = {};
    for (const p of ["OZONE", "PM25", "PM10", "NO2"] as Pollutant[]) {
      const v = number(get(r, `${p}_AQI`));
      if (v != null) aqi[p] = v;
    }
    const conc: AirSite["conc"] = [];
    for (const p of ["PM25", "OZONE", "NO2", "CO", "SO2", "PM10"]) {
      const v = number(get(r, p));
      if (v != null) conc.push({ param: p, value: v, unit: text(get(r, `${p}_Unit`)) });
    }
    sites.push({
      aqsid,
      name: text(get(r, "SiteName")),
      lat,
      lon,
      agency: text(get(r, "DataSource")),
      validAt: validIso(get(r, "ValidDate"), get(r, "ValidTime")),
      aqi,
      conc,
      reportingArea: text(get(r, "ReportingArea_PipeDelimited"))?.split("|").join(", "),
      country: text(get(r, "CountryCode")),
      state: text(get(r, "StateName")),
    });
  }
  return { sites, inactive, noPosition };
}

// ---------------------------------------------------------------- AQI categories (EPA)

export interface AqiCategory {
  name: string;
  /** The EPA Technical Assistance Document's RGB, as hex. */
  color: string;
  min: number;
  max: number;
}

/** EPA AQI categories and their RGB colours (Technical Assistance Document, 2018/2024). */
export const AQI_CATEGORIES: AqiCategory[] = [
  { name: "Good", color: "#00E400", min: 0, max: 50 },
  { name: "Moderate", color: "#FFFF00", min: 51, max: 100 },
  { name: "Unhealthy for Sensitive Groups", color: "#FF7E00", min: 101, max: 150 },
  { name: "Unhealthy", color: "#FF0000", min: 151, max: 200 },
  { name: "Very Unhealthy", color: "#8F3F97", min: 201, max: 300 },
  { name: "Hazardous", color: "#7E0023", min: 301, max: Number.POSITIVE_INFINITY },
];

export function aqiCategory(aqi: number | undefined): AqiCategory | null {
  if (aqi == null || !Number.isFinite(aqi) || aqi < 0) return null;
  const v = Math.round(aqi);
  return AQI_CATEGORIES.find((c) => v >= c.min && v <= c.max) ?? null;
}

/** The highest published pollutant AQI at a site, with its pollutant; null when none was published. */
export function siteAqi(s: Pick<AirSite, "aqi">): { value: number; pollutant: Pollutant } | null {
  let best: { value: number; pollutant: Pollutant } | null = null;
  for (const [p, v] of Object.entries(s.aqi) as Array<[Pollutant, number]>) {
    if (v == null) continue;
    if (!best || v > best.value) best = { value: v, pollutant: p };
  }
  return best;
}

// ---------------------------------------------------------------- the rows the route sends

export const SITE_COLUMNS = [
  "aqsid",
  "name",
  "lat",
  "lon",
  "agency",
  "validAt",
  "ozoneAqi",
  "pm25Aqi",
  "pm10Aqi",
  "no2Aqi",
  "concentrations",
  "reportingArea",
  "country",
  "state",
] as const;

export type SiteRow = [string, string | null, number, number, string | null, string | null, number | null, number | null, number | null, number | null, string | null, string | null, string | null, string | null];

export function siteRow(s: AirSite): SiteRow {
  const conc = s.conc.map((c) => `${c.param} ${c.value}${c.unit ? ` ${c.unit}` : ""}`).join("; ");
  return [
    s.aqsid,
    s.name ?? null,
    s.lat,
    s.lon,
    s.agency ?? null,
    s.validAt ?? null,
    s.aqi.OZONE ?? null,
    s.aqi.PM25 ?? null,
    s.aqi.PM10 ?? null,
    s.aqi.NO2 ?? null,
    conc || null,
    s.reportingArea ?? null,
    s.country ?? null,
    s.state ?? null,
  ];
}

export function rowSite(r: SiteRow): AirSite {
  const aqi: AirSite["aqi"] = {};
  if (r[6] != null) aqi.OZONE = r[6];
  if (r[7] != null) aqi.PM25 = r[7];
  if (r[8] != null) aqi.PM10 = r[8];
  if (r[9] != null) aqi.NO2 = r[9];
  const conc = (r[10] ?? "")
    .split("; ")
    .filter(Boolean)
    .map((s) => {
      const [param, value, ...unit] = s.split(" ");
      return { param, value: Number(value), unit: unit.join(" ") || undefined };
    });
  return {
    aqsid: r[0],
    name: r[1] ?? undefined,
    lat: r[2],
    lon: r[3],
    agency: r[4] ?? undefined,
    validAt: r[5] ?? undefined,
    aqi,
    conc,
    reportingArea: r[11] ?? undefined,
    country: r[12] ?? undefined,
    state: r[13] ?? undefined,
  };
}

// ---------------------------------------------------------------- the feature the layer draws

export interface AirExtra {
  aqi?: number;
  pollutant?: Pollutant;
  category?: string;
  color?: string;
}

export const AIR_PRELIMINARY = "PRELIMINARY: AirNow data are not fully verified or validated and are subject to change";

export function airFeature(s: AirSite): LayerFeature {
  const top = siteAqi(s);
  const cat = aqiCategory(top?.value);
  const details: Record<string, string | number | undefined> = {
    status: AIR_PRELIMINARY,
    AQI: top ? `${top.value} (${AQI_LABEL[top.pollutant]}) · ${cat?.name ?? "outside the AQI scale"}` : "no AQI reported by this site this hour",
  };
  for (const p of ["OZONE", "PM25", "PM10", "NO2"] as Pollutant[]) {
    if (s.aqi[p] != null) details[AQI_LABEL[p]] = s.aqi[p];
  }
  for (const c of s.conc) details[`${c.param === "PM25" ? "PM2.5" : c.param} hourly concentration`] = `${c.value}${c.unit ? ` ${c.unit.toLowerCase().replace("ug/m3", "µg/m³")}` : ""}`;
  details["what the AQI is"] =
    "AirNow's NowCast AQI (weighted over the last 12 hours) for ozone and particles and its 1-hour AQI for NO₂, computed by AirNow from the concentrations the agency sent; the colour is the highest of them";
  details["observation hour (UTC)"] = s.validAt?.slice(0, 16).replace("T", " ");
  details["reporting agency"] = s.agency;
  details["reporting area"] = s.reportingArea;
  details["AQS site id"] = s.aqsid;
  details.state = s.state && s.state !== "CC" && s.state !== "MX" ? s.state : undefined;
  details.country = s.country;
  details.credit = `${s.agency ? `${s.agency}, via ` : ""}the U.S. EPA AirNow program`;
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [s.lon, s.lat, 0] },
    properties: {
      id: `airnow:${s.aqsid}`,
      layer: "airquality",
      name: s.name ? `${s.name}${top ? ` · AQI ${top.value}` : ""}` : `AirNow site ${s.aqsid}`,
      kind: cat ? cat.name : "not rated",
      observedAt: s.validAt ? Date.parse(s.validAt) : undefined,
      source: "EPA AirNow (preliminary)",
      details,
      extra: { aqi: top?.value, pollutant: top?.pollutant, category: cat?.name, color: cat?.color } satisfies AirExtra,
    },
  };
}
