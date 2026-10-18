// Synthetic series with round numbers so the index tests can be checked by
// hand: home values step 5%/yr, rents 2%/yr, jobs 3%/yr, wages 3% then flat.
import { provenance } from "@/lib/provenance/types";
import { source } from "@/lib/provenance/sources";
import type { Series } from "@/lib/series/types";
import { monthEnd, quarterEnd } from "./align";

const pub = (id: "zillow-zhvi" | "zillow-zori" | "bls-qcew" | "fred") => provenance(source(id), { kind: "published", retrievedAt: "2023-01-01T00:00:00.000Z" });

/** 36 months, 2020-01 .. 2022-12. */
export const MONTHS = Array.from({ length: 36 }, (_, k) => monthEnd(2020 + Math.floor(k / 12), (k % 12) + 1));
/** 12 quarters, 2020 Q1 .. 2022 Q4. */
export const QUARTERS = Array.from({ length: 12 }, (_, q) => quarterEnd(2020 + Math.floor(q / 4), (q % 4) + 1));

export const zhvi: Series = {
  id: "zhvi:county:48453",
  title: "zhvi",
  unit: "$",
  frequency: "monthly",
  geo: { kind: "county", id: "48453", name: "Travis County, TX" },
  provenance: pub("zillow-zhvi"),
  points: MONTHS.map((t, k) => ({ t, v: k < 12 ? 100_000 : k < 24 ? 105_000 : 110_250 })),
};

/** Starts 2021-01 like ZORI does (2015 in real life). */
export const zori: Series = {
  id: "zori:county:48453",
  title: "zori",
  unit: "$ per month",
  frequency: "monthly",
  provenance: pub("zillow-zori"),
  points: MONTHS.slice(12).map((t, k) => ({ t, v: k < 12 ? 1000 : 1020 })),
};

const quarterly = (id: string, f: (q: number) => number): Series => ({
  id,
  title: id,
  unit: "",
  frequency: "quarterly",
  provenance: pub("bls-qcew"),
  points: QUARTERS.map((t, q) => ({ t, v: f(q) })),
});

export const emp = quarterly("qcew:county:48453:emp", (q) => (q < 4 ? 1000 : q < 8 ? 1030 : 1060.9));
export const wage = quarterly("qcew:county:48453:avg-weekly-wage", (q) => (q < 4 ? 1000 : 1030));
/** Over-the-year changes as the qcewHistory module derives them: 3 %/yr jobs; wages 3 % then 0 %. */
export const empYoY = quarterly("qcew:county:48453:emp:yoy", (q) => (q < 4 ? NaN : 3));
export const wageYoY = quarterly("qcew:county:48453:avg-weekly-wage:yoy", (q) => (q < 4 ? NaN : q < 8 ? 3 : 0));
for (const s of [empYoY, wageYoY]) for (const p of s.points) if (Number.isNaN(p.v)) p.v = null;

/** Mid-month "weekly" rate: 4 % until May 2022, 6 % from June 2022. */
export const mortgage: Series = {
  id: "fred:MORTGAGE30US",
  title: "pmms",
  unit: "%",
  frequency: "weekly",
  provenance: pub("fred"),
  points: MONTHS.map((t, k) => ({ t: t - 15 * 86_400_000, v: k < 29 ? 4 : 6 })),
};
