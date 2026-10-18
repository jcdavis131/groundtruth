"use client";
// Time machine: mission-time <-> playback-year mapping and per-layer year
// adapters for the globe's history playback.
//
// Rules (binding):
// - Yearly data uses STEP semantics: the last known year <= the playback
//   year. Missing years stay missing; nothing is ever interpolated.
// - Gas uses the nearest weekly observation <= the playback date.
// - Real data only: adapters return null when no observation precedes the
//   playback point, and the layers say so in the details panel.

import type { CountryGeneration, CountryGenerationYear, StateElectricity } from "@/lib/energy/energy";
import type { GasHistoryPoint } from "@/lib/gas/gas";

/** Earliest year any bundled history covers (EIA SEDS residential, 1970-). */
export const PLAYBACK_MIN_YEAR = 1970;

/** Latest playback year: the current calendar year. */
export function playbackMaxYear(nowMs = Date.now()): number {
  return new Date(nowMs).getUTCFullYear();
}

/** Mission seconds per Julian year; the Cesium clock multiplier for yr/sec. */
export const SECONDS_PER_YEAR = 365.25 * 86400;

/** Cesium clock multiplier that advances `yearsPerSecond` playback years. */
export function multiplierForYearsPerSecond(yearsPerSecond: number): number {
  return yearsPerSecond * SECONDS_PER_YEAR;
}

/** Playback speeds offered by the scrubber, in years per second. */
export const PLAYBACK_SPEEDS = [1, 5, 20] as const;

/** Epoch ms for Jan 1 00:00 UTC of `year`. */
export function missionTimeForYear(year: number): number {
  return Date.UTC(year, 0, 1);
}

/** Playback year for a mission time, clamped to the bundled range. */
export function playbackYearFromMissionTime(missionMs: number, nowMs = Date.now()): number {
  const y = new Date(missionMs).getUTCFullYear();
  return Math.min(playbackMaxYear(nowMs), Math.max(PLAYBACK_MIN_YEAR, y));
}

/** Epoch ms for Dec 31 23:59:59.999 UTC of the max playback year. */
export function endOfPlaybackRange(nowMs = Date.now()): number {
  return Date.UTC(playbackMaxYear(nowMs), 11, 31, 23, 59, 59, 999);
}

/**
 * STEP lookup over ascending [year, value] pairs: the last pair with
 * pairYear <= year. Null when nothing precedes the playback year.
 */
export function stepLookup<T>(pairs: Array<readonly [number, T]>, year: number): T | null {
  let out: T | null = null;
  for (const [y, v] of pairs) {
    if (y > year) break;
    out = v;
  }
  return out;
}

/**
 * STEP lookup over ascending {year, ...} records: the last record with
 * record.year <= year. Null when nothing precedes the playback year.
 */
export function stepLookupByYear<T extends { year: number }>(records: T[], year: number): T | null {
  let out: T | null = null;
  for (const r of records) {
    if (r.year > year) break;
    out = r;
  }
  return out;
}

/** Residential cents/kWh for a state in the playback year (step). */
export function statePriceForYear(state: StateElectricity, year: number): number | null {
  return stepLookup(state.history_residential, year);
}

/** National residential average across states that have a value that year. */
export function nationalAvgForYear(states: Record<string, StateElectricity>, year: number): number | null {
  const vals = Object.values(states)
    .map((s) => statePriceForYear(s, year))
    .filter((v): v is number => v != null && v > 0);
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/** Country generation mix for the playback year (step over history). */
export function generationForYear(country: CountryGeneration, year: number): CountryGenerationYear | null {
  return stepLookupByYear(country.history, year);
}

/**
 * Gas: nearest weekly [date, price] with date <= the playback date.
 * Returns the observation and its predecessor (for the WoW change).
 */
export function gasWeekForDate(
  history: GasHistoryPoint[],
  dateMs: number,
): { point: GasHistoryPoint; prev: GasHistoryPoint | null } | null {
  let idx = -1;
  for (let i = 0; i < history.length; i++) {
    if (Date.parse(`${history[i][0]}T12:00:00Z`) <= dateMs) idx = i;
    else break;
  }
  if (idx < 0) return null;
  return { point: history[idx], prev: idx > 0 ? history[idx - 1] : null };
}

/** Layer ids that redraw for the playback year. ERCOT is live-only and is
 * hidden during playback; data centers are static and ignore the clock. */
export const TIME_AWARE_LAYER_IDS = ["uselectricity", "gasprices", "globalgeneration", "wikipedia", "wikiday"] as const;

/** Live-only layer ids hidden while the time machine is engaged. */
export const PLAYBACK_HIDDEN_LAYER_IDS = ["ercotprices"] as const;
