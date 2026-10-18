// Flatten economy features and tables to one row each for `format=csv`.
// Pure: GeoJSON in, plain objects out, stable snake_case columns so a
// notebook can rely on the header. Column lists are exported so the route
// can pin the order and a reader can see what to expect without a request.
//
// Nothing is invented: a value the upstream withheld is null (an empty
// cell), never zero. Geometry is reduced to the anchor point (Census internal
// point, Natural Earth label point) or the feature's own coordinates.

import type { Point } from "geojson";
import type { LayerFeature } from "@/lib/layers/types";
import type { CsvRow } from "@/lib/server/csv";
import type { AreaExtra, CountryExtra, CrossingExtra, PortExtra, SectorRow } from "./features";
import type { PulseItem } from "./sources";

const r2 = (v: number | null | undefined): number | null => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);

export const AREA_COLUMNS = [
  "geoid",
  "name",
  "level",
  "state",
  "state_name",
  "metro",
  "lon",
  "lat",
  "home_value",
  "home_as_of",
  "home_yoy_pct",
  "home_y5_pct",
  "rent",
  "rent_as_of",
  "rent_yoy_pct",
  "price_to_rent",
  "qcew_period",
  "emp",
  "emp_yoy_pct",
  "estabs",
  "estabs_yoy_pct",
  "wages_qtr",
  "wages_yoy_pct",
  "avg_weekly_wage",
  "avg_weekly_wage_yoy_pct",
  "qcew_suppressed",
] as const;

/** Counties or states from `op=areas` (or the two browser layers), one row per area. */
export function flattenAreas(features: LayerFeature[]): CsvRow[] {
  return features.map((f) => {
    const x = f.properties.extra as AreaExtra;
    const h = x.home;
    const rt = x.rent;
    const j = x.jobs;
    return {
      geoid: x.geoid,
      name: x.name,
      level: x.level,
      state: x.stusab ?? null,
      state_name: x.stateName ?? null,
      metro: x.metro ?? null,
      lon: f.properties.anchor?.[0] ?? null,
      lat: f.properties.anchor?.[1] ?? null,
      home_value: h?.latest ?? null,
      home_as_of: h?.asOf ?? null,
      home_yoy_pct: r2(h?.yoyPct),
      home_y5_pct: r2(h?.y5Pct),
      rent: rt?.latest ?? null,
      rent_as_of: rt?.asOf ?? null,
      rent_yoy_pct: r2(rt?.yoyPct),
      price_to_rent: h && rt && rt.latest > 0 ? r2(h.latest / (rt.latest * 12)) : null,
      qcew_period: j?.period ?? null,
      emp: j?.emp ?? null,
      emp_yoy_pct: r2(j?.yoy.emp),
      estabs: j?.estabs ?? null,
      estabs_yoy_pct: r2(j?.yoy.estabs),
      wages_qtr: j?.wages ?? null,
      wages_yoy_pct: r2(j?.yoy.wages),
      avg_weekly_wage: j?.avgWeeklyWage ?? null,
      avg_weekly_wage_yoy_pct: r2(j?.yoy.avgWeeklyWage),
      qcew_suppressed: j ? j.suppressed : null,
    };
  });
}

export const PORT_COLUMNS = [
  "id",
  "wpi_id",
  "name",
  "country",
  "region",
  "lon",
  "lat",
  "size",
  "type",
  "use",
  "locode",
  "water_body",
  "channel_m",
  "anchorage_m",
  "cargo_pier_m",
  "max_draft_m",
  "max_length_m",
  "first_port_of_entry",
  "bts_port_id",
  "bts_authority",
  "bts_year",
  "container_teu",
  "container_rank",
  "container_pct_change",
  "tonnage_tons",
  "tonnage_rank",
  "tonnage_pct_change",
  "dry_bulk_tons",
  "position_basis",
  "source",
] as const;

/** Harbours from `op=ports`, one row per port; BTS columns stay empty where BTS publishes nothing. */
export function flattenPorts(features: LayerFeature[]): CsvRow[] {
  return features
    .filter((f) => f.properties.kind === "port" && f.geometry.type === "Point")
    .map((f) => {
      const x = f.properties.extra as PortExtra;
      const w = x.wpi;
      const s = x.stats;
      const [lon, lat] = (f as LayerFeature<Point>).geometry.coordinates;
      return {
        id: f.properties.id,
        wpi_id: w.id,
        name: w.name,
        country: w.country,
        region: w.region,
        lon,
        lat,
        size: w.size,
        type: w.type ?? null,
        use: w.use ?? null,
        locode: w.locode ?? null,
        water_body: w.water ?? null,
        channel_m: w.channelM,
        anchorage_m: w.anchorageM,
        cargo_pier_m: w.cargoPierM,
        max_draft_m: w.maxDraftM,
        max_length_m: w.maxLengthM,
        first_port_of_entry: w.firstPortOfEntry ?? null,
        bts_port_id: s?.portId ?? null,
        bts_authority: s?.name ?? null,
        bts_year: s?.year ?? null,
        container_teu: s?.container?.total ?? null,
        container_rank: s?.container?.ranking ?? null,
        container_pct_change: r2(s?.container?.pctChange),
        tonnage_tons: s?.tonnage?.total ?? null,
        tonnage_rank: s?.tonnage?.ranking ?? null,
        tonnage_pct_change: r2(s?.tonnage?.pctChange),
        dry_bulk_tons: s?.dryBulk?.total ?? null,
        position_basis: s?.position ?? "World Port Index",
        source: f.properties.source,
      };
    });
}

/** BTS measure names -> column stems. */
const MEASURE_COLS: Array<[string, string]> = [
  ["Trucks", "trucks"],
  ["Trains", "trains"],
  ["Buses", "buses"],
  ["Personal Vehicles", "personal_vehicles"],
  ["Pedestrians", "pedestrians"],
  ["Personal Vehicle Passengers", "personal_vehicle_passengers"],
  ["Train Passengers", "train_passengers"],
  ["Bus Passengers", "bus_passengers"],
];

export const CROSSING_COLUMNS = [
  "id",
  "code",
  "name",
  "state",
  "border",
  "lon",
  "lat",
  "as_of",
  ...MEASURE_COLS.flatMap(([, c]) => [c, `${c}_month`, `${c}_yoy_pct`]),
  "source",
] as const;

/** Land ports of entry from `op=border`, one row per port with the latest month of each measure. */
export function flattenCrossings(features: LayerFeature[]): CsvRow[] {
  return features
    .filter((f) => f.properties.kind === "crossing" && f.geometry.type === "Point")
    .map((f) => {
      const x = f.properties.extra as CrossingExtra;
      const [lon, lat] = (f as LayerFeature<Point>).geometry.coordinates;
      const row: CsvRow = { id: f.properties.id, code: x.code, name: f.properties.name, state: x.state, border: x.border, lon, lat, as_of: x.asOf };
      for (const [measure, col] of MEASURE_COLS) {
        const m = x.measures[measure];
        row[col] = m?.latest ?? null;
        row[`${col}_month`] = m?.latestDate ?? null;
        row[`${col}_yoy_pct`] = r2(m?.yoyPct);
      }
      row.source = f.properties.source;
      return row;
    });
}

export const COUNTRY_COLUMNS = [
  "iso3",
  "iso2",
  "name",
  "continent",
  "lon",
  "lat",
  "population",
  "population_year",
  "gdp_usd",
  "gdp_year",
  "exports_usd",
  "exports_year",
  "imports_usd",
  "imports_year",
  "trade_pct_gdp",
  "trade_pct_gdp_year",
  "container_teu",
  "container_teu_year",
  "trade_rank",
  "source",
] as const;

/** Countries from `op=countries`, one row each; every World Bank value carries its own year. */
export function flattenCountries(features: LayerFeature[]): CsvRow[] {
  return features
    .filter((f) => f.properties.kind === "country")
    .map((f) => {
      const x = f.properties.extra as CountryExtra;
      const w = x.wb;
      return {
        iso3: x.iso3,
        iso2: x.iso2 ?? null,
        name: f.properties.name,
        continent: x.continent ?? null,
        lon: x.lx,
        lat: x.ly,
        population: x.pop ?? null,
        population_year: x.popYear ?? null,
        gdp_usd: w?.gdp?.value ?? null,
        gdp_year: w?.gdp?.year ?? null,
        exports_usd: w?.exports?.value ?? null,
        exports_year: w?.exports?.year ?? null,
        imports_usd: w?.imports?.value ?? null,
        imports_year: w?.imports?.year ?? null,
        trade_pct_gdp: r2(w?.tradePct?.value),
        trade_pct_gdp_year: w?.tradePct?.year ?? null,
        container_teu: w?.teu?.value ?? null,
        container_teu_year: w?.teu?.year ?? null,
        trade_rank: x.rank ?? null,
        source: f.properties.source,
      };
    });
}

export const SECTOR_COLUMNS = ["fips", "period", "naics", "sector", "estabs", "emp", "avg_weekly_wage", "lq", "emp_yoy_pct", "suppressed"] as const;

/** NAICS sector rows from `op=sectors`, one row per sector. */
export function flattenSectors(fips: string, period: string | null | undefined, sectors: SectorRow[]): CsvRow[] {
  return sectors.map((s) => ({
    fips,
    period: period ?? null,
    naics: s.code,
    sector: s.title,
    estabs: s.estabs,
    emp: s.emp,
    avg_weekly_wage: s.avgWeeklyWage,
    lq: r2(s.lq),
    emp_yoy_pct: r2(s.yoyEmp),
    suppressed: s.suppressed,
  }));
}

export const PULSE_COLUMNS = ["id", "label", "value", "unit", "date", "prev", "prev_date", "change_pct", "source"] as const;

/** National series from `op=pulse`, one row per series (latest observation). */
export function flattenPulse(items: PulseItem[]): CsvRow[] {
  return items.map((p) => ({
    id: p.id,
    label: p.label,
    value: p.value,
    unit: p.unit,
    date: p.date,
    prev: p.prev,
    prev_date: p.prevDate,
    change_pct: r2(p.changePct),
    source: p.source,
  }));
}

export const PULSE_SERIES_COLUMNS = ["id", "label", "date", "value", "unit", "source"] as const;

/** Long format: every observation the pulse carries, one row per (series, date); `series=1` on the route. */
export function flattenPulseSeries(items: PulseItem[]): CsvRow[] {
  const out: CsvRow[] = [];
  for (const p of items) for (const [date, value] of p.series) out.push({ id: p.id, label: p.label, date, value, unit: p.unit, source: p.source });
  return out;
}
