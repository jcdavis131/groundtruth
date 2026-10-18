// Water-quality screening against published freshwater thresholds.
//
// Nothing here is a model. Each parameter a gauge actually reports is
// compared with a cited threshold and labelled; the "screening index" is an
// explicit points tally over the parameters present, printed with its n so
// nobody mistakes a one-parameter site for a full panel.

export interface Reading {
  value: number;
  unit: string;
  time: string;
}

export type ParamCode =
  | "00060" // discharge
  | "00065" // gage height
  | "00010" // water temperature
  | "00300" // dissolved oxygen
  | "00095" // specific conductance
  | "00400" // pH
  | "63680" // turbidity (FNU)
  | "00062" // reservoir water-surface elevation
  | "00054" // reservoir storage
  | "72019" // depth to water level below land surface
  | "62610" // groundwater level above NGVD29
  | "62611"; // groundwater level above NAVD88

export const PARAM_INFO: Record<string, { label: string; short: string; group: "flow" | "quality" | "reservoir" | "groundwater" }> = {
  "00060": { label: "Discharge", short: "flow", group: "flow" },
  "00065": { label: "Gage height", short: "stage", group: "flow" },
  "00010": { label: "Water temperature", short: "temp", group: "quality" },
  "00300": { label: "Dissolved oxygen", short: "DO", group: "quality" },
  "00095": { label: "Specific conductance", short: "cond.", group: "quality" },
  "00400": { label: "pH", short: "pH", group: "quality" },
  "63680": { label: "Turbidity", short: "turb.", group: "quality" },
  "00062": { label: "Reservoir elevation", short: "elev.", group: "reservoir" },
  "00054": { label: "Reservoir storage", short: "storage", group: "reservoir" },
  "72019": { label: "Depth to water (below land)", short: "depth", group: "groundwater" },
  "62610": { label: "Water level (NGVD29)", short: "level", group: "groundwater" },
  "62611": { label: "Water level (NAVD88)", short: "level", group: "groundwater" },
};

export type Verdict = "ok" | "watch" | "poor";

export interface Screen {
  param: string;
  label: string;
  value: number;
  unit: string;
  verdict: Verdict;
  /** Human sentence with the threshold and its source. */
  basis: string;
}

/**
 * Dissolved-oxygen saturation concentration (mg/L) in fresh water at sea
 * level, Benson & Krause (1984) as used by USGS DOTABLES. T in Celsius.
 */
export function doSaturationMgL(tempC: number): number {
  const T = tempC + 273.15;
  const ln =
    -139.34411 + 1.575701e5 / T - 6.642308e7 / (T * T) + 1.2438e10 / (T * T * T) - 8.621949e11 / (T * T * T * T);
  return Math.exp(ln);
}

function fahrenheitToC(v: number, unit: string): number {
  return /f/i.test(unit) && !/degC|C$/.test(unit) ? ((v - 32) * 5) / 9 : v;
}

/** Screen every quality parameter a site reports. Returns one entry per parameter. */
export function screenReadings(readings: Partial<Record<string, Reading>>): Screen[] {
  const out: Screen[] = [];
  const tempRaw = readings["00010"];
  const tempC = tempRaw ? fahrenheitToC(tempRaw.value, tempRaw.unit) : undefined;

  if (tempC != null && tempRaw) {
    out.push({
      param: "00010",
      label: "Water temperature",
      value: tempC,
      unit: "°C",
      verdict: tempC > 32 ? "poor" : tempC > 30 ? "watch" : "ok",
      basis: "Above 30 °C stresses most temperate freshwater fish; sustained > 32 °C is lethal for many species (EPA 1986 Gold Book, species-specific).",
    });
  }
  const dox = readings["00300"];
  if (dox) {
    const v = dox.value;
    let verdict: Verdict = v < 3 ? "poor" : v < 5 ? "watch" : "ok";
    let basis = "EPA freshwater aquatic-life criteria (1986): 5.0 mg/L 7-day mean minimum for warm-water life stages; < 3 mg/L is acutely harmful.";
    if (tempC != null) {
      const sat = doSaturationMgL(tempC);
      const pct = (v / sat) * 100;
      basis += ` Saturation at ${tempC.toFixed(1)} °C is ${sat.toFixed(1)} mg/L, so this reads ${pct.toFixed(0)} % (Benson & Krause 1984). Supersaturation > 120 % usually means an algal bloom.`;
      if (pct > 130 && verdict === "ok") verdict = "watch";
    }
    out.push({ param: "00300", label: "Dissolved oxygen", value: v, unit: dox.unit, verdict, basis });
  }
  const ph = readings["00400"];
  if (ph) {
    const v = ph.value;
    out.push({
      param: "00400",
      label: "pH",
      value: v,
      unit: "",
      verdict: v < 6 || v > 9.5 ? "poor" : v < 6.5 || v > 9 ? "watch" : "ok",
      basis: "EPA National Recommended Water Quality Criteria, freshwater aquatic life: pH 6.5–9.0.",
    });
  }
  const cond = readings["00095"];
  if (cond) {
    const v = cond.value;
    out.push({
      param: "00095",
      label: "Specific conductance",
      value: v,
      unit: cond.unit,
      verdict: v > 1500 ? "poor" : v > 800 ? "watch" : "ok",
      basis: "TDS ≈ 0.65 × conductance: 800 µS/cm ≈ the EPA secondary drinking-water TDS limit of 500 mg/L; 1,500 µS/cm ≈ 1,000 mg/L, twice it.",
    });
  }
  const turb = readings["63680"];
  if (turb) {
    const v = turb.value;
    out.push({
      param: "63680",
      label: "Turbidity",
      value: v,
      unit: turb.unit.replace(/^_/, ""),
      verdict: v > 100 ? "poor" : v > 25 ? "watch" : "ok",
      basis: "Source-water tiers used here: ≤ 25 FNU typical baseflow, > 25 elevated sediment, > 100 storm/erosion loading. Treated drinking water must leave the plant ≤ 0.3 NTU (EPA LT2 filtration rule); this is raw source water.",
    });
  }
  return out;
}

export interface QualityIndex {
  /** 0..1, 1 = every screened parameter inside its range. */
  score: number;
  n: number;
  worst: Verdict;
  formula: string;
}

/** Explicit tally: ok = 0, watch = 1, poor = 2 points; score = 1 − points / (2 n). */
export function qualityIndex(screens: Screen[]): QualityIndex | null {
  if (screens.length === 0) return null;
  const pts = screens.reduce((a, s) => a + (s.verdict === "poor" ? 2 : s.verdict === "watch" ? 1 : 0), 0);
  const worst: Verdict = screens.some((s) => s.verdict === "poor")
    ? "poor"
    : screens.some((s) => s.verdict === "watch")
      ? "watch"
      : "ok";
  return {
    score: 1 - pts / (2 * screens.length),
    n: screens.length,
    worst,
    formula: `1 − ${pts} / (2 × ${screens.length})`,
  };
}

/** Unit-aware value formatting for the HUD. */
export function fmtReading(param: string, r: Reading): string {
  const unit = r.unit.replace(/^_/, "").replace("ft^3/s", "ft³/s").replace("degC", "°C").replace("uS/cm @25C", "µS/cm");
  const v = Math.abs(r.value) >= 1000 ? Math.round(r.value).toLocaleString() : Math.abs(r.value) >= 10 ? r.value.toFixed(1) : r.value.toFixed(2);
  return param === "00400" ? v : `${v} ${unit}`.trim();
}

export function isStale(iso: string, now: number, maxAgeMs = 7 * 86_400_000): boolean {
  const t = Date.parse(iso);
  return !Number.isFinite(t) || now - t > maxAgeMs;
}
