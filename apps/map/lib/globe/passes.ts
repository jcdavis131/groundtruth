// Satellite pass prediction (Look4Sat-style) for the satellites layer.
//
// Given an observer location and a satellite's orbital elements, finds the
// upcoming passes: when the satellite rises above the observer's horizon
// (AOS), when it sets (LOS), the azimuths at both ends, and the peak
// elevation. Geostationary objects are reported as one always-visible window.
//
// Method: the standard horizon search used by PREDICT, Gpredict and
// Look4Sat — coarse 60 s stepping to bracket each horizon crossing, then
// 500 ms refinement. This file is an original implementation of that public
// technique (Look4Sat is GPL-3.0 and was used as inspiration only; no code
// was copied). Propagation itself is SGP4 via the vendored satellite.js.
//
// Accuracy note: predictions are only as good as the element set. Elements
// refresh every 2 h server-side; drag makes LEO predictions stale within
// days. Treat far-future passes as approximate.

import * as sat from "@/lib/vendor/satellite";

/** Minimal orbital elements needed for propagation (subset of CelesTrak OMM). */
export interface PassElements {
  NORAD_CAT_ID: number;
  EPOCH: string;
  MEAN_MOTION: number;
  ECCENTRICITY: number;
  INCLINATION: number;
  RA_OF_ASC_NODE: number;
  ARG_OF_PERICENTER: number;
  MEAN_ANOMALY: number;
  BSTAR: number;
  MEAN_MOTION_DOT: number;
  MEAN_MOTION_DDOT: number;
  EPHEMERIS_TYPE?: number;
  CLASSIFICATION_TYPE?: string;
  OBJECT_ID?: string;
  OBJECT_NAME?: string;
  ELEMENT_SET_NO?: number;
  REV_AT_EPOCH?: number;
}

export interface Observer {
  lat: number; // degrees, -90..90
  lon: number; // degrees, -180..180
}

export interface SatPass {
  aosTime: number; // ms epoch, acquisition of signal
  losTime: number; // ms epoch, loss of signal
  aosAzimuth: number; // degrees 0..360
  losAzimuth: number; // degrees 0..360
  maxElevation: number; // degrees above horizon
  geostationary?: boolean;
}

export interface PassOptions {
  hoursAhead?: number; // default 24
  minElevation?: number; // degrees; default 0 (horizon)
}

const DEG = Math.PI / 180;
const EARTH_RADIUS_KM = 6378.135;
const GEO_PERIOD_MIN = 1400; // ~23.3 h; at/above this we treat the orbit as geostationary
const COARSE_STEP_MS = 60_000;
const SET_STEP_MS = 30_000;
const REFINE_STEP_MS = 500;

const recCache = new Map<string, sat.SatRec>();

function satrecFor(el: PassElements): sat.SatRec | null {
  const key = `${el.NORAD_CAT_ID}:${el.EPOCH}:${el.ELEMENT_SET_NO ?? 0}`;
  let rec = recCache.get(key);
  if (!rec) {
    try {
      rec = sat.json2satrec(el as unknown as sat.OMMJsonObject);
    } catch {
      return null;
    }
    if (recCache.size > 500) recCache.clear();
    recCache.set(key, rec);
  }
  return rec;
}

interface Look {
  azimuth: number; // degrees 0..360
  elevation: number; // degrees, negative = below horizon
}

/** Observer look angles for the satellite at timeMs; null if propagation fails. */
function lookAngles(el: PassElements, obs: Observer, timeMs: number): Look | null {
  const rec = satrecFor(el);
  if (!rec) return null;
  const date = new Date(timeMs);
  const pv = sat.propagate(rec, date);
  if (!pv || !pv.position) return null;
  const gmst = sat.gstime(date);
  const satEcf = sat.eciToEcf(pv.position, gmst);
  const look = sat.ecfToLookAngles(
    { longitude: obs.lon * DEG, latitude: obs.lat * DEG, height: 0 },
    satEcf,
  );
  if (!Number.isFinite(look.azimuth) || !Number.isFinite(look.elevation)) return null;
  return {
    azimuth: ((look.azimuth / DEG) % 360 + 360) % 360,
    elevation: look.elevation / DEG,
  };
}

function elevationAt(el: PassElements, obs: Observer, timeMs: number): number {
  return lookAngles(el, obs, timeMs)?.elevation ?? -90;
}

/** Cheap pre-filter: can this orbit ever clear the observer's horizon? */
export function willBeSeen(el: PassElements, latDeg: number): boolean {
  if (!(el.MEAN_MOTION > 1e-8)) return false;
  const sma = 331.25 * Math.exp(Math.log(1440 / el.MEAN_MOTION) * (2 / 3));
  const apogee = sma * (1 + el.ECCENTRICITY) - EARTH_RADIUS_KM;
  let inc = el.INCLINATION;
  if (inc >= 90) inc = 180 - inc;
  const horizonAngle = Math.acos(EARTH_RADIUS_KM / (apogee + EARTH_RADIUS_KM));
  return horizonAngle + inc * DEG > Math.abs(latDeg * DEG);
}

function periodMin(el: PassElements): number {
  return el.MEAN_MOTION > 1e-8 ? 1440 / el.MEAN_MOTION : Infinity;
}

const roundSec = (ms: number) => Math.round(ms / 1000) * 1000;

interface RiseSet {
  aosTime: number;
  losTime: number;
  aosAzimuth: number;
  losAzimuth: number;
  maxElevation: number;
}

/**
 * Find the next rise/set pair at or after startMs. Returns null when the
 * search fails (bad elements) — fail-closed, never a fabricated pass.
 */
function nextRiseSet(
  el: PassElements,
  obs: Observer,
  startMs: number,
  rewindMs: number,
): RiseSet | null {
  let t = startMs - rewindMs;
  let maxEl = -90;

  // If we're inside a pass, skip to its end then jump ahead past it.
  if (elevationAt(el, obs, t) > 0) {
    let guard = 0;
    do {
      t += SET_STEP_MS;
      if (++guard > 4000) return null;
    } while (elevationAt(el, obs, t) > 0);
    t += rewindMs * 3;
  }

  // Coarse search for the next rise.
  let guard = 0;
  let e = -90;
  do {
    t += COARSE_STEP_MS;
    e = elevationAt(el, obs, t);
    if (e > maxEl) maxEl = e;
    if (++guard > 30000) return null;
  } while (e < 0);

  // Refine AOS to ~0.5 s.
  t -= COARSE_STEP_MS;
  guard = 0;
  do {
    t += REFINE_STEP_MS;
    e = elevationAt(el, obs, t);
    if (e > maxEl) maxEl = e;
    if (++guard > 4000) return null;
  } while (e < 0);
  const aosLook = lookAngles(el, obs, t);
  if (!aosLook) return null;
  const aosTime = roundSec(t);
  const aosAzimuth = aosLook.azimuth;

  // Coarse search for the set.
  guard = 0;
  do {
    t += SET_STEP_MS;
    e = elevationAt(el, obs, t);
    if (e > maxEl) maxEl = e;
    if (++guard > 4000) return null;
  } while (e > 0);

  // Refine LOS to ~0.5 s.
  t -= SET_STEP_MS;
  guard = 0;
  do {
    t += REFINE_STEP_MS;
    e = elevationAt(el, obs, t);
    if (e > maxEl) maxEl = e;
    if (++guard > 4000) return null;
  } while (e > 0);
  const losLook = lookAngles(el, obs, t);
  if (!losLook) return null;

  return {
    aosTime,
    losTime: roundSec(t),
    aosAzimuth,
    losAzimuth: losLook.azimuth,
    maxElevation: maxEl,
  };
}

/**
 * Upcoming passes over the observer, soonest first. Empty array when the
 * satellite can never be seen from there, or when elements are bad.
 */
export function findPasses(
  el: PassElements,
  obs: Observer,
  fromMs: number,
  opts: PassOptions = {},
): SatPass[] {
  const hoursAhead = opts.hoursAhead ?? 24;
  const minEl = opts.minElevation ?? 0;
  const pMin = periodMin(el);
  if (!Number.isFinite(pMin)) return [];

  // Geostationary: one always-visible window when it's above the horizon now.
  if (pMin >= GEO_PERIOD_MIN) {
    const now = lookAngles(el, obs, fromMs);
    if (!now || now.elevation < minEl) return [];
    const day = 24 * 3600 * 1000;
    return [
      {
        aosTime: roundSec(fromMs - day),
        losTime: roundSec(fromMs + day),
        aosAzimuth: now.azimuth,
        losAzimuth: now.azimuth,
        maxElevation: now.elevation,
        geostationary: true,
      },
    ];
  }

  if (!willBeSeen(el, obs.lat)) return [];

  const quarterMs = (pMin * 60_000) / 4;
  const endMs = fromMs + hoursAhead * 3600 * 1000;
  const passes: SatPass[] = [];
  let t = fromMs;
  let first = true;
  let guard = 0;
  for (;;) {
    if (++guard > 64) break;
    const rs = nextRiseSet(el, obs, t, first ? quarterMs : 0);
    if (!rs) break;
    first = false;
    if (rs.aosTime > endMs) break;
    if (rs.losTime > fromMs && rs.maxElevation >= minEl) passes.push(rs);
    t = rs.losTime + quarterMs * 3;
    if (rs.aosTime >= endMs) break;
  }
  return passes;
}
