// NRCS SSURGO through Soil Data Access (SDA), in two small steps. The one-shot
// query that joins a point to its components' interpretations timed out in
// probing; split in two, each answers in a few hundred milliseconds:
//
//   1. point  -> map unit: SDA_Get_Mukey_from_intersection_with_WktWgs84 gives
//              the mukey under a WGS84 point; the mapunit row carries its name,
//              symbol and NRCS farmland classification, the legend its survey
//              area, sacatalog the date that survey area was last saved
//   2. mukey  -> components with their percentage of the map unit and the
//              "NCCPI - National Commodity Crop Productivity Index (Ver 3.0)"
//              interpretation (0 to 1, with NRCS's class words); the dominant
//              component is the one with the largest share
//
// A component NRCS did not rate has interphr null and "Not rated"; that stays
// "not rated", never 0. An empty answer is `{}` (no Table): no map unit here.
// Pure: SQL text and parsers only; app/api/soil/route.ts does the network.

export const NCCPI_RULE = "NCCPI - National Commodity Crop Productivity Index (Ver 3.0)";

/** A WGS84 point as SDA's WKT, 6 decimals; throws on anything that is not a finite coordinate (the value goes into SQL). */
export function wktPoint(lon: number, lat: number): string {
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) throw new Error("lon/lat out of range");
  return `POINT(${lon.toFixed(6)} ${lat.toFixed(6)})`;
}

/** SSURGO map unit keys are integers; anything else never reaches SQL. */
export function isMukey(v: unknown): v is string {
  return typeof v === "string" && /^\d{1,12}$/.test(v);
}

export function pointSql(lon: number, lat: number): string {
  return [
    "SELECT mu.mukey, mu.musym, mu.muname, mu.farmlndcl, l.areasymbol, l.areaname, sa.saverest",
    "FROM mapunit mu",
    "INNER JOIN legend l ON l.lkey = mu.lkey",
    "LEFT JOIN sacatalog sa ON sa.areasymbol = l.areasymbol",
    `WHERE mu.mukey IN (SELECT * FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('${wktPoint(lon, lat)}'))`,
  ].join("\n");
}

export function mapunitSql(mukey: string): string {
  if (!isMukey(mukey)) throw new Error("mukey must be digits");
  return [
    "SELECT c.cokey, c.compname, c.comppct_r, c.majcompflag, ci.mrulename, ci.interphr, ci.interphrc",
    "FROM component c",
    `LEFT JOIN cointerp ci ON ci.cokey = c.cokey AND ci.ruledepth = 0 AND ci.mrulename = '${NCCPI_RULE}'`,
    `WHERE c.mukey = '${mukey}'`,
    "ORDER BY c.comppct_r DESC, c.cokey",
  ].join("\n");
}

/** SDA's JSON+COLUMNNAME answer: Table[0] is the header row. `{}` means no rows. */
export interface SdaJson {
  Table?: unknown[][];
}

export type SdaRow = Record<string, string | null>;

export function sdaRows(j: SdaJson | null | undefined): SdaRow[] {
  const t = j?.Table;
  if (!Array.isArray(t) || t.length < 1 || !Array.isArray(t[0])) return [];
  const head = t[0].map((h) => String(h));
  return t.slice(1).map((r) => {
    const row: SdaRow = {};
    head.forEach((h, i) => {
      const v = Array.isArray(r) ? r[i] : null;
      row[h] = v == null ? null : String(v);
    });
    return row;
  });
}

/** A string that is empty or whitespace is missing, not a value. */
function text(v: string | null | undefined): string | undefined {
  if (v == null) return undefined;
  const t = v.trim();
  return t === "" ? undefined : t;
}

/** A decimal as SDA sent it, or null: a blank or null field is never 0 (Number("") and Number(null) are both 0). */
export function decimal(v: string | null | undefined): number | null {
  const t = text(v);
  if (t == null || !/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

export interface SoilMapUnit {
  mukey: string;
  symbol?: string;
  name?: string;
  /** NRCS farmland classification, as published ("All areas are prime farmland", "Not prime farmland", …). */
  farmlandClass?: string;
  areaSymbol?: string;
  areaName?: string;
  /** When the survey area's data was last saved in SSURGO, as SDA sent it (e.g. "9/4/2025 2:58:52 PM"). */
  surveySaved?: string;
}

/** Step 1's rows -> the map unit, or null when SDA found none at the point. */
export function parseSoilPoint(j: SdaJson | null | undefined): SoilMapUnit | null {
  const r = sdaRows(j)[0];
  if (!r || !isMukey(r.mukey ?? undefined)) return null;
  return {
    mukey: r.mukey!,
    symbol: text(r.musym),
    name: text(r.muname),
    farmlandClass: text(r.farmlndcl),
    areaSymbol: text(r.areasymbol),
    areaName: text(r.areaname),
    surveySaved: text(r.saverest),
  };
}

export interface SoilComponent {
  cokey?: string;
  name?: string;
  /** Representative share of the map unit, percent. */
  percent: number | null;
  major: boolean;
  /** NCCPI 0..1, or null when NRCS did not rate this component. */
  nccpi: number | null;
  /** NRCS's class words for the rating ("Moderate inherent productivity", "Not rated"). */
  nccpiClass?: string;
}

/** Step 2's rows -> components, largest share first (SDA already orders them; this keeps it so). */
export function parseComponents(j: SdaJson | null | undefined): SoilComponent[] {
  const out = sdaRows(j).map((r) => ({
    cokey: text(r.cokey),
    name: text(r.compname),
    percent: decimal(r.comppct_r),
    major: text(r.majcompflag) === "Yes",
    nccpi: decimal(r.interphr),
    nccpiClass: text(r.interphrc),
  }));
  return out.sort((a, b) => (b.percent ?? -1) - (a.percent ?? -1));
}

export interface SoilAnswer {
  mapUnit: SoilMapUnit;
  components: SoilComponent[];
  /** The component with the largest share of the map unit (its NCCPI is the one shown). */
  dominant: SoilComponent | null;
}

export function soilAnswer(mapUnit: SoilMapUnit, components: SoilComponent[]): SoilAnswer {
  return { mapUnit, components, dominant: components[0] ?? null };
}

/** "0.455 (Moderate inherent productivity)", "not rated (NRCS: Not rated)", or "no component rows". */
export function nccpiText(c: SoilComponent | null): string {
  if (!c) return "no component rows";
  if (c.nccpi == null) return `not rated${c.nccpiClass ? ` (NRCS: ${c.nccpiClass})` : ""}`;
  return `${c.nccpi.toFixed(3)}${c.nccpiClass ? ` (${c.nccpiClass})` : ""}`;
}
