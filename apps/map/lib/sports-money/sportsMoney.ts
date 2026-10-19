// Sports-money data access: Forbes annual NBA team valuations crossed with
// Spotrac team cash payrolls (same season pairing), for "value per payroll
// dollar" views.
//
// Bundles live at lib/sports-money/data/. The valuations bundle is curated by
// hand (Forbes offers no data API and blocks extraction; see the pull script
// for the manual procedure). The payrolls bundle is filled by
// scripts/sports-money-pull.mjs. Both are imported at build time; queries are
// pure and synchronous.
//
// Gaps are explicit: 2021a edition is missing MEM, and any season absent from
// nba_payrolls.json simply returns null from the ratio helpers. Never invent.

import valuationsJson from "./data/nba_valuations.json";
import payrollsJson from "./data/nba_payrolls.json";

/** 30 team short codes, stable alphabetical order. */
export const SPORTS_MONEY_TEAMS = [
  "ATL","BKN","BOS","CHA","CHI","CLE","DAL","DEN","DET","GSW",
  "HOU","IND","LAC","LAL","MEM","MIA","MIL","MIN","NOP","NYK",
  "OKC","ORL","PHI","PHX","POR","SAC","SAS","TOR","UTA","WAS",
] as const;
export type SportsMoneyTeam = (typeof SPORTS_MONEY_TEAMS)[number];

export interface ValuationsEdition {
  edition: string;
  published: string;
  season: string;
  league_avg_b: number | null;
  source_url: string;
  notes: string;
  valuations_b: Record<string, number>;
}

export interface ValuationsBundle {
  teams: Record<string, string>;
  editions: ValuationsEdition[];
  gaps: { edition: string; team: string; rank: number; note: string }[];
}

export interface PayrollSeason {
  active_usd: Record<string, number>;
  dead_usd: Record<string, number>;
  total_cash_usd: Record<string, number>;
}

const VAL = valuationsJson as unknown as ValuationsBundle;
const PAY = payrollsJson as unknown as { seasons: Record<string, PayrollSeason> };

export function valuations(): ValuationsBundle { return VAL; }
export function payrolls(): Record<string, PayrollSeason> { return PAY.seasons; }

export function teamName(code: string): string {
  return VAL.teams[code] ?? code;
}

/** Forbes valuation in USD for a team in a given edition (e.g. "2025"). Null when absent (see gaps). */
export function valuationUsd(team: string, edition: string): number | null {
  const e = VAL.editions.find((x) => x.edition === edition);
  const v = e?.valuations_b[team];
  return typeof v === "number" ? v * 1e9 : null;
}

/** Spotrac cash payroll in USD for a team in a season (e.g. "2024-25"). "total" = active + dead + retained. */
export function payrollUsd(team: string, season: string, kind: "total" | "active" | "dead" = "total"): number | null {
  const s = PAY.seasons[season];
  if (!s) return null;
  const key = kind === "total" ? "total_cash_usd" : kind === "active" ? "active_usd" : "dead_usd";
  const v = s[key][team];
  return typeof v === "number" ? v : null;
}

/**
 * Franchise value per dollar of cash payroll: valuationUsd / payrollUsd.
 * Pairs the edition's own season with payrolls from the same season, so the
 * comparison is apples-to-apples on the money actually spent.
 * Null when either side is missing — never estimated.
 */
export function valuePerPayrollDollar(team: string, edition: string): number | null {
  const e = VAL.editions.find((x) => x.edition === edition);
  if (!e) return null;
  const v = valuationUsd(team, edition);
  const p = payrollUsd(team, e.season);
  if (v == null || p == null || p <= 0) return null;
  return v / p;
}

/** All editions in chronological order, for time-series and time-machine views. */
export function editionsChronological(): ValuationsEdition[] {
  return [...VAL.editions];
}

/** Latest edition <= a given ISO date (time-machine support, gas-layer pattern). Null before the first edition. */
export function editionAtDate(isoDate: string): ValuationsEdition | null {
  let best: ValuationsEdition | null = null;
  for (const e of VAL.editions) {
    if (e.published <= isoDate) best = e;
  }
  return best;
}

/** Appreciation multiple over the full series for one team: latest valuation / earliest valuation. Null on gaps. */
export function appreciationMultiple(team: string): number | null {
  const eds = editionsChronological().filter((e) => typeof e.valuations_b[team] === "number");
  if (eds.length < 2) return null;
  const first = eds[0].valuations_b[team];
  const last = eds[eds.length - 1].valuations_b[team];
  return last / first;
}
