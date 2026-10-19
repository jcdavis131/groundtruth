// Shared fixtures for the economy tests: a county with every join, a county
// whose QCEW cell is suppressed, and the builders that turn them into features.
import { buildAreas, type AreaJoins, type AreaPoly, type HomeValue, type JobsRow } from "./features";

const square = (w: number, s: number, e: number, n: number): AreaPoly["geometry"] => ({ type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] });

export const HOME: HomeValue = { id: "48453", name: "Travis County", metro: "Austin-Round Rock-San Marcos, TX", sizeRank: 30, asOf: "2026-07-31", latest: 452000, yoyPct: -1.234, y5Pct: 31.9, monthly: [], yearly: [] };
export const RENT: HomeValue = { id: "48453", name: "Travis County", sizeRank: 30, asOf: "2026-07-31", latest: 1810, yoyPct: 0.8, y5Pct: null, monthly: [], yearly: [] };
export const JOBS: JobsRow = { area: "48453", period: "2026 Q1", estabs: 41000, emp: 730000, wages: 1.5e10, avgWeeklyWage: 1580, yoy: { estabs: 1.2, emp: 0.9, wages: 5.5, avgWeeklyWage: 4.567 }, suppressed: false };
export const SUPPRESSED: JobsRow = { area: "48301", period: "2026 Q1", estabs: null, emp: null, wages: null, avgWeeklyWage: null, yoy: { estabs: null, emp: null, wages: null, avgWeeklyWage: null }, suppressed: true };

export function areaFixtures() {
  const polys: AreaPoly[] = [
    { geoid: "48453", name: "Travis", stusab: "TX", lon: -97.78, lat: 30.33, geometry: square(-98.2, 30.0, -97.4, 30.6) },
    { geoid: "48301", name: "Loving", stusab: "TX", lon: -103.58, lat: 31.85, geometry: square(-104, 31.6, -103.2, 32.1) },
  ];
  const joins: AreaJoins = { jobs: new Map([["48453", JOBS], ["48301", SUPPRESSED]]), home: new Map([["48453", HOME]]), rent: new Map([["48453", RENT]]), stateNames: new Map([["48453", "Texas"], ["48301", "Texas"]]) };
  return buildAreas(polys, "county", joins);
}

