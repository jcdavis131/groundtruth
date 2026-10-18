// Semi-analytical turbidity from Sentinel-2 surface reflectance.
//
// This is the "physics teacher" that TurbidityVision distils: Dogliotti et al.
// (2015), "A single algorithm to retrieve turbidity from remotely-sensed data
// in all coastal and estuarine waters", Remote Sensing of Environment 156.
// Single-band form  T = A * rho_w / (1 - rho_w / C)  with published
// coefficients at 645 nm (red) and 859 nm (NIR), blended between rho_red
// 0.05 and 0.07. Applied here to Sentinel-2 B04 (~665 nm) and B8A (~865 nm),
// a documented band-shift approximation inherited from the explainer.
//
// Everything in this file is pure arithmetic on real reflectance; there is
// no fitted model and no fabricated value. Outputs are estimates and are
// labelled as such wherever they are shown.

export const DOGLIOTTI = {
  red: { A: 228.1, C: 0.1641, lambdaNm: 645 },
  nir: { A: 3078.9, C: 0.2112, lambdaNm: 859 },
  blendLow: 0.05,
  blendHigh: 0.07,
  /** Clip ceiling used by the explainer for reporting. */
  clipFnu: 4000,
} as const;

/** Turbidity (FNU) from water-leaving reflectance in red (B04) and NIR (B8A). */
export function turbidityFnu(rhoRed: number, rhoNir: number): number {
  const { red, nir, blendLow, blendHigh, clipFnu } = DOGLIOTTI;
  const tRed = single(rhoRed, red.A, red.C);
  const tNir = single(rhoNir, nir.A, nir.C);
  let t: number;
  if (rhoRed < blendLow) t = tRed;
  else if (rhoRed > blendHigh) t = tNir;
  else {
    const w = (rhoRed - blendLow) / (blendHigh - blendLow);
    t = (1 - w) * tRed + w * tNir;
  }
  if (!Number.isFinite(t) || t < 0) return NaN;
  return Math.min(t, clipFnu);
}

function single(rho: number, A: number, C: number): number {
  if (!(rho > 0)) return 0;
  const d = 1 - rho / C;
  if (d <= 0) return Number.POSITIVE_INFINITY;
  return (A * rho) / d;
}

/**
 * Sentinel-2 L2A digital number -> surface reflectance.
 * Processing baseline >= 04.00 (Jan 2022 onward) stores DN = (rho + 0.1) * 10000;
 * earlier baselines store DN = rho * 10000. `offset` is the STAC raster:bands
 * offset (-0.1 or 0). Nodata DN 0 -> NaN.
 */
export function dnToReflectance(dn: number, scale = 0.0001, offset = 0): number {
  if (dn === 0) return NaN;
  return dn * scale + offset;
}

/** SCL classes that invalidate a pixel (explainer's mask): nodata, saturated, cloud shadow, clouds, cirrus, snow. */
export const SCL_INVALID = new Set([0, 1, 3, 8, 9, 10, 11]);
export const SCL_WATER = 6;

/**
 * Water mask used by the explainer:  SCL == 6  OR  (NDWI > 0.05 AND rho_B08 < 0.10),
 * minus invalid SCL classes.  NDWI = (green - nir) / (green + nir) with B03/B08.
 */
export function isWater(scl: number, rhoGreen: number, rhoNir: number): boolean {
  if (SCL_INVALID.has(scl)) return false;
  if (scl === SCL_WATER) return true;
  if (!(Number.isFinite(rhoGreen) && Number.isFinite(rhoNir))) return false;
  const ndwi = (rhoGreen - rhoNir) / (rhoGreen + rhoNir);
  return ndwi > 0.05 && rhoNir < 0.1;
}

export interface ChipStats {
  /** Water pixels that produced a finite turbidity. */
  n: number;
  median: number;
  p10: number;
  p90: number;
  mean: number;
  /** Fraction of the chip's pixels classified as water. */
  waterFraction: number;
}

/** Order statistics over a chip's per-pixel turbidity values. */
export function chipStats(values: number[], totalPixels: number): ChipStats | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const q = (p: number) => v[Math.min(v.length - 1, Math.max(0, Math.round(p * (v.length - 1))))];
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  return {
    n: v.length,
    median: q(0.5),
    p10: q(0.1),
    p90: q(0.9),
    mean,
    waterFraction: totalPixels > 0 ? values.length / totalPixels : 0,
  };
}

/** Explainer's low-confidence rule: spread wider than the median itself. */
export function lowConfidence(s: ChipStats): boolean {
  return s.p90 - s.p10 > s.median;
}

/** Minimum water pixels for a chip to be reported (explainer: 25). */
export const MIN_WATER_PIXELS = 25;

/** Coarse qualitative class for a turbidity value, for colour only. */
export function turbidityClass(fnu: number): "clear" | "low" | "moderate" | "high" | "very-high" {
  if (fnu < 2) return "clear";
  if (fnu < 10) return "low";
  if (fnu < 50) return "moderate";
  if (fnu < 250) return "high";
  return "very-high";
}
