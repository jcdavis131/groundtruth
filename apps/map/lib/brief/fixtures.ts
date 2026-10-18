// Frozen BriefInputs, committed so a wording change is a visible diff.
//
// Three places, chosen for what they break rather than for what they show.
// TRAVIS is an ordinary county with both Zillow month columns in the table, a
// QCEW quarter, cohort percentiles and a stale release window — the case where
// every detector has something to say. LOVING is a county whose QCEW cells BLS
// withheld, which is the case a brief must not print as zero. KING is a county
// with nothing published at all, which is the case that must still produce a
// digest and a feed item rather than a blank page.
//
// Every timestamp here is a literal. Nothing in this file calls a clock, and
// every provenance record is built with an explicit retrievedAt, because
// provenance() defaults that field to new Date().toISOString() and a defaulted
// one would make the golden fixture differ on every run.

import { estimateProvenance } from "@/lib/economy/provenance";
import { source } from "@/lib/provenance/sources";
import { provenance, type Provenance } from "@/lib/provenance/types";
import type { PeerStat } from "@/lib/places/percentiles";
import type { BriefInput } from "./types";
import type { BuildBriefOptions } from "./build";

/** When the fixtures' inputs were fetched. */
export const FIXTURE_RETRIEVED_AT = "2026-08-22T11:58:00.000Z";

/** The options every fixture brief is built with. */
export const FIXTURE_OPTS: BuildBriefOptions = {
  now: Date.parse("2026-08-22T12:00:00.000Z"),
  generatedAt: "2026-08-22T12:00:00.000Z",
};

const ZHVI_SERIES = "County_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month";
const ZORI_SERIES = "County_zori_uc_sfrcondo_sm_month";

function zhvi(period: string): Provenance {
  return provenance(source("zillow-zhvi"), { kind: "published", seriesId: ZHVI_SERIES, period, retrievedAt: FIXTURE_RETRIEVED_AT });
}

function zori(period: string): Provenance {
  return provenance(source("zillow-zori"), { kind: "published", seriesId: ZORI_SERIES, period, retrievedAt: FIXTURE_RETRIEVED_AT });
}

function qcew(period: string, notes?: string[]): Provenance {
  return provenance(source("bls-qcew"), { kind: "published", seriesId: "QCEW county, all industries, all ownerships", period, retrievedAt: FIXTURE_RETRIEVED_AT, ...(notes ? { notes } : {}) });
}

function peer(over: Partial<PeerStat> & { cohortKey: string; cohortLabel: string }): PeerStat {
  return { value: null, pct: null, rank: null, n: 0, min: null, p25: null, median: null, p75: null, max: null, ...over };
}

// ---------------------------------------------------------------- Travis County, Texas

const TRAVIS_QUARTER = "2026-Q1";
const TRAVIS_MONTH = "2026-07-31";
const TRAVIS_PREV_MONTH = "2026-06-30";

/**
 * Travis County: both Zillow month columns present, a QCEW quarter whose
 * over-the-year changes are published but whose year-earlier levels are not, a
 * national cohort and a state cohort that disagree on price-to-rent by more
 * than thirty points, and a ZHVI release window that has already closed.
 */
export const TRAVIS_INPUT: BriefInput = Object.freeze({
  scopeKind: "county",
  scopeId: "county:48453",
  scopeName: "Travis County",
  lens: null,
  values: {
    "home.latest": 452000,
    "home.yoyPct": -6.3,
    "home.momPct": -1.22,
    "home.y5Pct": 38.4,
    "rent.latest": 1720,
    "rent.yoyPct": 1.4,
    "rent.momPct": -0.86,
    priceToRent: 21.9,
    "jobs.emp": 712340,
    "jobs.estabs": 62180,
    "jobs.wages": 17_420_000_000,
    "jobs.avgWeeklyWage": 1642,
    "jobs.yoy.emp": 0.9,
    "jobs.yoy.estabs": 1.8,
    "jobs.yoy.wages": 4.2,
    "jobs.yoy.avgWeeklyWage": 3.1,
    momentum: 0.12,
    yearsOfWages: 5.3,
  },
  previous: {
    "home.latest": 457600,
    "home.yoyPct": -4.1,
    "home.momPct": 0.3,
    "rent.latest": 1735,
    momentum: 0.21,
  },
  periods: {
    current: {
      "home.latest": TRAVIS_MONTH,
      "home.yoyPct": TRAVIS_MONTH,
      "home.momPct": TRAVIS_MONTH,
      "home.y5Pct": TRAVIS_MONTH,
      "rent.latest": TRAVIS_MONTH,
      "rent.yoyPct": TRAVIS_MONTH,
      "rent.momPct": TRAVIS_MONTH,
      priceToRent: TRAVIS_MONTH,
      "jobs.emp": TRAVIS_QUARTER,
      "jobs.estabs": TRAVIS_QUARTER,
      "jobs.wages": TRAVIS_QUARTER,
      "jobs.avgWeeklyWage": TRAVIS_QUARTER,
      "jobs.yoy.emp": TRAVIS_QUARTER,
      "jobs.yoy.estabs": TRAVIS_QUARTER,
      "jobs.yoy.wages": TRAVIS_QUARTER,
      "jobs.yoy.avgWeeklyWage": TRAVIS_QUARTER,
      momentum: TRAVIS_MONTH,
      yearsOfWages: TRAVIS_MONTH,
    },
    previous: {
      "home.latest": TRAVIS_PREV_MONTH,
      "home.yoyPct": TRAVIS_PREV_MONTH,
      "home.momPct": TRAVIS_PREV_MONTH,
      "rent.latest": TRAVIS_PREV_MONTH,
      momentum: TRAVIS_PREV_MONTH,
    },
  },
  peers: {
    "home.latest": [
      peer({ cohortKey: "county:us", cohortLabel: "US counties", value: 452000, pct: 96.2, rank: 118, n: 3088, min: 28400, p25: 148000, median: 236500, p75: 372000, max: 2140000 }),
      peer({ cohortKey: "county:state:TX", cohortLabel: "Texas counties", value: 452000, pct: 99.1, rank: 3, n: 241, min: 41200, p25: 131000, median: 189000, p75: 268000, max: 611000 }),
    ],
    priceToRent: [
      peer({ cohortKey: "county:us", cohortLabel: "US counties", value: 21.9, pct: 92.4, rank: 171, n: 1904, min: 4.1, p25: 11.2, median: 14.8, p75: 18.6, max: 44.2 }),
      peer({ cohortKey: "county:state:TX", cohortLabel: "Texas counties", value: 21.9, pct: 41, rank: 74, n: 132, min: 7.4, p25: 16.9, median: 22.6, p75: 27.1, max: 39.8 }),
    ],
    "jobs.avgWeeklyWage": [
      peer({ cohortKey: "county:us", cohortLabel: "US counties", value: 1642, pct: 94.8, rank: 141, n: 3042, min: 412, p25: 812, median: 962, p75: 1164, max: 4210 }),
    ],
    yearsOfWages: [
      peer({ cohortKey: "county:us", cohortLabel: "US counties", value: 5.3, pct: 58, rank: 1204, n: 2988, min: 0.9, p25: 3.4, median: 4.8, p75: 6.6, max: 24.1 }),
    ],
  },
  suppressed: [],
  skipped: ["home.y5Pct"],
  indicators: [],
  releases: [
    { title: "Zillow ZHVI county file", earliest: "2026-08-15T00:00:00.000Z", latest: "2026-08-20T00:00:00.000Z", precision: "approximate" },
    { title: "BLS QCEW county employment and wages", earliest: "2026-09-03T00:00:00.000Z", latest: "2026-09-10T00:00:00.000Z", precision: "official" },
  ],
  provenance: {
    "home.latest": [zhvi("2026-07")],
    "home.yoyPct": [zhvi("2026-07")],
    "home.momPct": [zhvi("2026-07")],
    "home.y5Pct": [zhvi("2026-07")],
    "rent.latest": [zori("2026-07")],
    "rent.yoyPct": [zori("2026-07")],
    "rent.momPct": [zori("2026-07")],
    priceToRent: [
      zhvi("2026-07"),
      zori("2026-07"),
      estimateProvenance("zillow-zhvi", "price-to-rent = $452,000 / ($1,720 × 12) = 21.9", FIXTURE_RETRIEVED_AT, ["Zillow ZORI is the second input."]),
    ],
    "jobs.emp": [qcew(TRAVIS_QUARTER)],
    "jobs.estabs": [qcew(TRAVIS_QUARTER)],
    "jobs.wages": [qcew(TRAVIS_QUARTER)],
    "jobs.avgWeeklyWage": [qcew(TRAVIS_QUARTER)],
    "jobs.yoy.emp": [qcew(TRAVIS_QUARTER, ["Over-the-year percent change as BLS publishes it; the file carries no year-earlier level."])],
    "jobs.yoy.estabs": [qcew(TRAVIS_QUARTER)],
    "jobs.yoy.wages": [qcew(TRAVIS_QUARTER)],
    "jobs.yoy.avgWeeklyWage": [qcew(TRAVIS_QUARTER, ["Over-the-year percent change as BLS publishes it; the file carries no year-earlier level."])],
    momentum: [
      zhvi("2026-07"),
      qcew(TRAVIS_QUARTER),
      estimateProvenance("zillow-zhvi", "momentum = 0.30 × home 1-yr / 10 + 0.15 × rent 1-yr / 10 + 0.30 × jobs oty / 3 + 0.25 × wage oty / 6, each term clipped to ±1", FIXTURE_RETRIEVED_AT),
    ],
    yearsOfWages: [
      zhvi("2026-07"),
      qcew(TRAVIS_QUARTER),
      estimateProvenance("zillow-zhvi", "years of wages = $452,000 / ($1,642 × 52) = 5.3", FIXTURE_RETRIEVED_AT, ["One average covered job, not a household."]),
    ],
  },
  retrievedAt: FIXTURE_RETRIEVED_AT,
}) as BriefInput;

// ---------------------------------------------------------------- Loving County, Texas

const LOVING_SUPPRESSED = ["jobs.avgWeeklyWage", "jobs.emp", "jobs.wages", "jobs.yoy.avgWeeklyWage", "jobs.yoy.emp"];

/**
 * Loving County: BLS withheld every employment and wage cell under disclosure
 * code N. Zillow publishes a home value. The brief must name the hole and must
 * never print the withheld cells as zero.
 */
export const LOVING_INPUT: BriefInput = Object.freeze({
  scopeKind: "county",
  scopeId: "county:48301",
  scopeName: "Loving County",
  lens: null,
  values: {
    "home.latest": 285400,
    "home.yoyPct": 2.1,
    "home.momPct": -0.4,
    "jobs.emp": null,
    "jobs.wages": null,
    "jobs.avgWeeklyWage": null,
    "jobs.yoy.emp": null,
    "jobs.yoy.avgWeeklyWage": null,
    momentum: null,
    yearsOfWages: null,
  },
  previous: { "home.latest": 286540 },
  periods: {
    current: { "home.latest": TRAVIS_MONTH, "home.yoyPct": TRAVIS_MONTH, "home.momPct": TRAVIS_MONTH, "jobs.emp": TRAVIS_QUARTER },
    previous: { "home.latest": TRAVIS_PREV_MONTH },
  },
  peers: {},
  suppressed: LOVING_SUPPRESSED,
  skipped: [],
  indicators: [],
  releases: [],
  provenance: {
    "home.latest": [zhvi("2026-07")],
    "home.yoyPct": [zhvi("2026-07")],
    "home.momPct": [zhvi("2026-07")],
    "jobs.emp": [qcew(TRAVIS_QUARTER, ["Disclosure code N: the cell does not meet BLS disclosure standards and is withheld."])],
    "jobs.wages": [qcew(TRAVIS_QUARTER, ["Disclosure code N: the cell does not meet BLS disclosure standards and is withheld."])],
    "jobs.avgWeeklyWage": [qcew(TRAVIS_QUARTER, ["Disclosure code N: the cell does not meet BLS disclosure standards and is withheld."])],
    "jobs.yoy.emp": [qcew(TRAVIS_QUARTER, ["Disclosure code N: the cell does not meet BLS disclosure standards and is withheld."])],
    "jobs.yoy.avgWeeklyWage": [qcew(TRAVIS_QUARTER, ["Disclosure code N: the cell does not meet BLS disclosure standards and is withheld."])],
  },
  retrievedAt: FIXTURE_RETRIEVED_AT,
}) as BriefInput;

// ---------------------------------------------------------------- King County, Texas

/**
 * King County: nothing published, nothing cached, no cohort. The brief still
 * has to exist, still has to carry a digest, and still has to say why there is
 * nothing here — a blank page or a 500 would be a failure of the contract.
 */
export const KING_INPUT: BriefInput = Object.freeze({
  scopeKind: "county",
  scopeId: "county:48269",
  scopeName: "King County",
  lens: null,
  values: { "home.latest": null, "rent.latest": null, "jobs.emp": null, "jobs.avgWeeklyWage": null, momentum: null },
  previous: {},
  periods: { current: {}, previous: {} },
  peers: {},
  suppressed: [],
  skipped: [],
  indicators: [],
  releases: [],
  provenance: {},
  retrievedAt: FIXTURE_RETRIEVED_AT,
}) as BriefInput;

/** Every fixture, for a test that wants to sweep them. */
export const BRIEF_FIXTURES: ReadonlyArray<{ name: string; input: BriefInput }> = [
  { name: "Travis County", input: TRAVIS_INPUT },
  { name: "Loving County", input: LOVING_INPUT },
  { name: "King County", input: KING_INPUT },
];
