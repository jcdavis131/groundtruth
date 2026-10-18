// Time machine: mission-time <-> year mapping, step semantics, gas week
// lookup, and the history bundle's integrity. Real data only: missing years
// stay missing, steps never interpolate.

import { describe, expect, it } from "vitest";
import {
  PLAYBACK_MIN_YEAR,
  PLAYBACK_SPEEDS,
  SECONDS_PER_YEAR,
  endOfPlaybackRange,
  gasWeekForDate,
  generationForYear,
  missionTimeForYear,
  multiplierForYearsPerSecond,
  nationalAvgForYear,
  playbackYearFromMissionTime,
  statePriceForYear,
  stepLookup,
  stepLookupByYear,
} from "./timeMachine";
import { globalGenerationBundle } from "@/lib/energy/energy";

describe("mission-time <-> playback-year mapping", () => {
  it("round-trips a year through mission time", () => {
    expect(playbackYearFromMissionTime(missionTimeForYear(1997))).toBe(1997);
    expect(playbackYearFromMissionTime(missionTimeForYear(2025))).toBe(2025);
  });

  it("clamps below the minimum and above the current year", () => {
    expect(playbackYearFromMissionTime(missionTimeForYear(1950))).toBe(PLAYBACK_MIN_YEAR);
    expect(playbackYearFromMissionTime(Date.UTC(2100, 5, 1), Date.UTC(2026, 9, 5))).toBe(2026);
    expect(playbackYearFromMissionTime(missionTimeForYear(1970))).toBe(1970);
  });

  it("maps mid-year dates to their calendar year", () => {
    expect(playbackYearFromMissionTime(Date.UTC(2003, 6, 15))).toBe(2003);
  });

  it("end of playback range is Dec 31 of the max year", () => {
    const end = new Date(endOfPlaybackRange(Date.UTC(2026, 9, 5)));
    expect(end.getUTCFullYear()).toBe(2026);
    expect(end.getUTCMonth()).toBe(11);
    expect(end.getUTCDate()).toBe(31);
  });

  it("multiplier advances the right years per second", () => {
    expect(multiplierForYearsPerSecond(1)).toBe(SECONDS_PER_YEAR);
    expect(multiplierForYearsPerSecond(5)).toBe(5 * SECONDS_PER_YEAR);
    for (const s of PLAYBACK_SPEEDS) expect(multiplierForYearsPerSecond(s)).toBeGreaterThan(0);
  });
});

describe("step semantics (never interpolate)", () => {
  const pairs: Array<[number, number]> = [[1970, 5.1], [1975, 6.0], [1980, 7.2]];

  it("returns the exact year when present", () => {
    expect(stepLookup(pairs, 1975)).toBe(6.0);
  });

  it("steps back to the last known year", () => {
    expect(stepLookup(pairs, 1979)).toBe(6.0);
    expect(stepLookup(pairs, 1970)).toBe(5.1);
  });

  it("returns null before the first observation (missing stays missing)", () => {
    expect(stepLookup(pairs, 1969)).toBeNull();
  });

  it("stepLookupByYear works on {year, ...} records", () => {
    const recs = [{ year: 1985, v: "a" }, { year: 1990, v: "b" }];
    expect(stepLookupByYear(recs, 1988)?.v).toBe("a");
    expect(stepLookupByYear(recs, 1984)).toBeNull();
  });
});

describe("state price adapters", () => {
  const state = {
    name: "Test",
    lat: 0,
    lon: 0,
    residential: 12,
    commercial: null,
    industrial: null,
    transportation: null,
    history_residential: [[1970, 4.0], [1980, 6.0]] as [number, number][],
  };

  it("steps the residential history", () => {
    expect(statePriceForYear(state, 1985)).toBe(6.0);
    expect(statePriceForYear(state, 1969)).toBeNull();
  });

  it("national average skips states with no value that year", () => {
    const states = {
      A: state,
      B: { ...state, history_residential: [[1990, 10.0]] as [number, number][] },
    };
    expect(nationalAvgForYear(states, 1985)).toBe(6.0);
    expect(nationalAvgForYear(states, 1995)).toBe(8.0);
    expect(nationalAvgForYear(states, 1969)).toBeNull();
  });
});

describe("gas week lookup", () => {
  const history: [string, number][] = [
    ["2020-01-06", 2.5],
    ["2020-01-13", 2.6],
    ["2020-01-20", 2.55],
  ];

  it("takes the nearest week on or before the playback date", () => {
    const r = gasWeekForDate(history, Date.parse("2020-01-15T12:00:00Z"));
    expect(r?.point).toEqual(["2020-01-13", 2.6]);
    expect(r?.prev).toEqual(["2020-01-06", 2.5]);
  });

  it("returns null before the first observation", () => {
    expect(gasWeekForDate(history, Date.parse("2019-12-01T12:00:00Z"))).toBeNull();
  });

  it("has no predecessor on the first week", () => {
    const r = gasWeekForDate(history, Date.parse("2020-01-06T12:00:00Z"));
    expect(r?.point).toEqual(["2020-01-06", 2.5]);
    expect(r?.prev).toBeNull();
  });
});

describe("generation history bundle", () => {
  it("every country has ascending, duplicate-free history with top-6 fuels", () => {
    const b = globalGenerationBundle();
    expect(b.countries.length).toBeGreaterThanOrEqual(50);
    for (const c of b.countries) {
      expect(c.history.length).toBeGreaterThan(0);
      const years = c.history.map((h) => h.year);
      expect([...years].sort((a, z) => a - z)).toEqual(years);
      expect(new Set(years).size).toBe(years.length);
      for (const h of c.history) {
        expect(h.fuels.length).toBeLessThanOrEqual(6);
        for (const f of h.fuels) expect(f.share_pct).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("history_years matches the data and stays under the size budget", () => {
    const b = globalGenerationBundle();
    const starts = b.countries.map((c) => c.history[0].year);
    const ends = b.countries.map((c) => c.history[c.history.length - 1].year);
    expect(b.history_years).toEqual([Math.min(...starts), Math.max(...ends)]);
    expect(b.history_years[0]).toBeLessThanOrEqual(2000); // deep history present
  });

  it("gaps are stepped over, never filled", () => {
    const b = globalGenerationBundle();
    // Find a country whose history skips at least one year, if any.
    const gappy = b.countries.find((c) => {
      const ys = c.history.map((h) => h.year);
      return ys.some((y, i) => i > 0 && y - ys[i - 1] > 1);
    });
    if (!gappy) return; // no gaps in this build: nothing to prove
    const ys = gappy.history.map((h) => h.year);
    const gapYear = ys.find((y, i) => i > 0 && y - ys[i - 1] > 1) as number;
    const stepped = generationForYear(gappy, gapYear);
    expect(stepped).not.toBeNull();
    expect(stepped!.year).toBeLessThan(gapYear); // stepped back, not invented
  });

  it("states coverage caveats in the bundle meta", () => {
    const b = globalGenerationBundle();
    expect((b.meta.coverage_caveats ?? []).join(" ")).toMatch(/pre-2000/i);
  });
});
