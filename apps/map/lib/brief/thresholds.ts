// Levels for a place, written down.
//
// This closes a real gap rather than restating one. Nothing in the screener
// marks a county field as watch or alert, and of the nineteen registered
// indicators ten are national, five are river gauges, exactly one is
// state-scoped (Texas) and none is keyed to a county — so a place page has no
// existing rule to inherit. PLACE_THRESHOLDS is that rule table, hand-written,
// mirroring lib/indicators/types.ts Threshold so the two read the same.
//
// `on` says which quantity the rule tests, and therefore how the sentence
// phrases the period:
//   value   — the metric as published, at its own scale.
//   yoyPct  — a metric that is itself an over-the-year percent change.
//   momPct  — a metric that is itself a month-over-month percent change,
//             derived from the Zillow month columns (home.momPct, rent.momPct).
//   pct     — the entity's POSITION among its national peers, read off the
//             cohort table. This is how a brief is specific about a level
//             nobody official publishes: "in the top tenth of US counties" is
//             a claim about the data that is true or false, where "expensive"
//             is not.
//
// Every entry carries a non-empty citation, and where the level is ours the
// citation says so in the repo's existing words. Printing a label without its
// citation would imply an official level that does not exist.

import type { PeerStat } from "@/lib/places/percentiles";

export type PlaceThresholdLevel = "watch" | "alert";
export type PlaceThresholdOp = "<" | ">" | "<=" | ">=";
export type PlaceThresholdOn = "value" | "yoyPct" | "momPct" | "pct";

export interface PlaceThreshold {
  /** Field key in lib/screener/fields.ts, or one of the derived keys home.momPct / rent.momPct. */
  metric: string;
  level: PlaceThresholdLevel;
  op: PlaceThresholdOp;
  value: number;
  on: PlaceThresholdOn;
  /** What the rule means, in words a reader can quote. */
  label: string;
  /** Where the level comes from. Never empty. */
  citation: string;
}

const CONVENTION = "convention chosen for this dashboard, not an official level";
const OURS = "not an official level";

const ZHVI = "arithmetic on Zillow ZHVI, county and metro files";
const ZHVI_MONTHS = "arithmetic on the Zillow ZHVI month columns";
const ZORI_MONTHS = "arithmetic on the Zillow ZORI month columns";
const QCEW_OTY = "BLS QCEW over-the-year percent change, as published";

const COUNTY: readonly PlaceThreshold[] = [
  { metric: "home.yoyPct", level: "watch", op: "<", value: 0, on: "yoyPct", label: "typical home value below a year ago", citation: `${ZHVI}; ${OURS}` },
  { metric: "home.yoyPct", level: "alert", op: "<=", value: -5, on: "yoyPct", label: "typical home value at least 5 percent below a year ago", citation: `${ZHVI}; ${CONVENTION}` },
  { metric: "home.yoyPct", level: "watch", op: ">=", value: 15, on: "yoyPct", label: "typical home value at least 15 percent above a year ago", citation: `${ZHVI}; ${CONVENTION}` },
  { metric: "home.momPct", level: "watch", op: "<=", value: -1, on: "momPct", label: "typical home value at least 1 percent below the previous month", citation: `${ZHVI_MONTHS}; ${CONVENTION}` },
  { metric: "rent.yoyPct", level: "watch", op: ">=", value: 8, on: "yoyPct", label: "typical asking rent at least 8 percent above a year ago", citation: `arithmetic on Zillow ZORI; ${CONVENTION}` },
  { metric: "rent.momPct", level: "watch", op: "<=", value: -1, on: "momPct", label: "typical asking rent at least 1 percent below the previous month", citation: `${ZORI_MONTHS}; ${CONVENTION}` },
  { metric: "priceToRent", level: "watch", op: ">=", value: 90, on: "pct", label: "price-to-rent in the top tenth of US counties", citation: `position among the counties that published both ZHVI and ZORI this month; ${OURS}` },
  { metric: "priceToRent", level: "watch", op: ">=", value: 25, on: "value", label: "typical home value worth 25 or more years of typical rent", citation: `typical home value / (typical rent × 12), Zillow ZHVI over ZORI, same month; ${CONVENTION}` },
  { metric: "jobs.yoy.emp", level: "watch", op: "<", value: 0, on: "yoyPct", label: "covered employment below the same quarter a year earlier", citation: `${QCEW_OTY}; ${OURS}` },
  { metric: "jobs.yoy.emp", level: "alert", op: "<=", value: -3, on: "yoyPct", label: "covered employment at least 3 percent below the same quarter a year earlier", citation: `${QCEW_OTY}; ${CONVENTION}` },
  { metric: "jobs.yoy.avgWeeklyWage", level: "watch", op: "<", value: 0, on: "yoyPct", label: "average weekly wage below the same quarter a year earlier, before inflation", citation: `${QCEW_OTY}, nominal dollars; ${CONVENTION}` },
  { metric: "momentum", level: "watch", op: "<=", value: -0.25, on: "value", label: "momentum index in the cooling band", citation: `the cooling band of the momentum index computed here, score at or below -0.25; ${CONVENTION}` },
  { metric: "yearsOfWages", level: "watch", op: ">=", value: 10, on: "value", label: "typical home value worth 10 or more years of one average covered wage", citation: `typical home value / (average weekly wage × 52), one average covered job rather than a household; ${CONVENTION}` },
  { metric: "yearsOfWages", level: "watch", op: ">=", value: 90, on: "pct", label: "years of wages in the top tenth of US counties", citation: `position among the counties that published both a ZHVI value and a QCEW average weekly wage; ${OURS}` },
];

// Metros get a reduced set: the metro page reads no QCEW metro row (level-40
// boundaries follow each year's delineation) and ships a county rollup
// instead. Nothing here may depend on it.
const METRO: readonly PlaceThreshold[] = [
  { metric: "home.yoyPct", level: "watch", op: "<", value: 0, on: "yoyPct", label: "typical home value below a year ago", citation: `${ZHVI}; ${OURS}` },
  { metric: "home.yoyPct", level: "alert", op: "<=", value: -5, on: "yoyPct", label: "typical home value at least 5 percent below a year ago", citation: `${ZHVI}; ${CONVENTION}` },
  { metric: "home.momPct", level: "watch", op: "<=", value: -1, on: "momPct", label: "typical home value at least 1 percent below the previous month", citation: `${ZHVI_MONTHS}; ${CONVENTION}` },
  { metric: "rent.yoyPct", level: "watch", op: ">=", value: 8, on: "yoyPct", label: "typical asking rent at least 8 percent above a year ago", citation: `arithmetic on Zillow ZORI; ${CONVENTION}` },
  { metric: "priceToRent", level: "watch", op: ">=", value: 90, on: "pct", label: "price-to-rent in the top tenth of US metro areas", citation: `position among the metro areas that published both ZHVI and ZORI this month; ${OURS}` },
  { metric: "priceToRent", level: "watch", op: ">=", value: 25, on: "value", label: "typical home value worth 25 or more years of typical rent", citation: `typical home value / (typical rent × 12), Zillow ZHVI over ZORI, same month; ${CONVENTION}` },
];

// The state table omits rent.* and priceToRent entirely: app/api/screen/route.ts
// passes Promise.resolve(null) for zoriState, so those fields are structurally
// null at state level and a rule over them could never fire.
const STATE: readonly PlaceThreshold[] = [
  { metric: "home.yoyPct", level: "watch", op: "<", value: 0, on: "yoyPct", label: "typical home value below a year ago", citation: `${ZHVI}; ${OURS}` },
  { metric: "home.yoyPct", level: "alert", op: "<=", value: -5, on: "yoyPct", label: "typical home value at least 5 percent below a year ago", citation: `${ZHVI}; ${CONVENTION}` },
  { metric: "home.momPct", level: "watch", op: "<=", value: -1, on: "momPct", label: "typical home value at least 1 percent below the previous month", citation: `${ZHVI_MONTHS}; ${CONVENTION}` },
  { metric: "jobs.yoy.emp", level: "watch", op: "<", value: 0, on: "yoyPct", label: "covered employment below the same quarter a year earlier", citation: `${QCEW_OTY}; ${OURS}` },
  { metric: "jobs.yoy.emp", level: "alert", op: "<=", value: -3, on: "yoyPct", label: "covered employment at least 3 percent below the same quarter a year earlier", citation: `${QCEW_OTY}; ${CONVENTION}` },
  { metric: "jobs.yoy.avgWeeklyWage", level: "watch", op: "<", value: 0, on: "yoyPct", label: "average weekly wage below the same quarter a year earlier, before inflation", citation: `${QCEW_OTY}, nominal dollars; ${CONVENTION}` },
  { metric: "momentum", level: "watch", op: "<=", value: -0.25, on: "value", label: "momentum index in the cooling band", citation: `the cooling band of the momentum index computed here, score at or below -0.25; ${CONVENTION}` },
  { metric: "yearsOfWages", level: "watch", op: ">=", value: 10, on: "value", label: "typical home value worth 10 or more years of one average covered wage", citation: `typical home value / (average weekly wage × 52), one average covered job rather than a household; ${CONVENTION}` },
];

export const PLACE_THRESHOLDS: Record<"county" | "metro" | "state", readonly PlaceThreshold[]> = {
  county: COUNTY,
  metro: METRO,
  state: STATE,
};

export interface TriggeredPlaceThreshold {
  threshold: PlaceThreshold;
  /** The metric's own published value, whatever quantity the rule tested. */
  value: number;
  /** The national cohort stat, present only for an on:"pct" rule. */
  peer?: PeerStat;
}

function compare(v: number, th: PlaceThreshold): boolean {
  switch (th.op) {
    case "<":
      return v < th.value;
    case "<=":
      return v <= th.value;
    case ">":
      return v > th.value;
    case ">=":
      return v >= th.value;
  }
}

/**
 * The national cohort's stat for a metric. peerStats keys the national cohort
 * "<scope>:us"; anything else is a state or metro cohort and a percentile rule
 * must not silently fall back to it.
 */
export function nationalPeer(stats: PeerStat[] | undefined): PeerStat | undefined {
  return stats?.find((p) => /:us$/.test(p.cohortKey));
}

/**
 * Which rules fire. A rule whose metric is missing is SKIPPED, never assumed
 * false-safe — the same contract as triggeredThresholds in
 * lib/indicators/evaluate.ts. An on:"pct" rule additionally needs a national
 * percentile, and is skipped when the cohort could not be built, which is the
 * normal state of the world with no egress.
 */
export function triggeredPlaceThresholds(
  kind: "county" | "metro" | "state",
  values: Record<string, number | null>,
  peers: Record<string, PeerStat[]>,
): TriggeredPlaceThreshold[] {
  const out: TriggeredPlaceThreshold[] = [];
  for (const threshold of PLACE_THRESHOLDS[kind]) {
    const value = values[threshold.metric];
    if (value == null || !Number.isFinite(value)) continue;
    if (threshold.on === "pct") {
      const peer = nationalPeer(peers[threshold.metric]);
      if (!peer || peer.pct == null || !Number.isFinite(peer.pct)) continue;
      if (compare(peer.pct, threshold)) out.push({ threshold, value, peer });
      continue;
    }
    if (compare(value, threshold)) out.push({ threshold, value });
  }
  return out;
}
