import { describe, expect, it } from "vitest";
import { affordability, momentum, MOMENTUM_SPEC } from "@/lib/economy/estimates";
import type { HomeValue, JobsRow } from "@/lib/economy/features";
import { isoDate } from "./align";
import { emp, empYoY, mortgage, wage, wageYoY, zhvi, zori } from "./fixtures";
import { affordabilityHistory, momentumHistory, momentumHomeOnly, momentumScore, MOMENTUM_TERMS } from "./indices";

const home = (yoyPct: number | null, latest = 110_250): HomeValue => ({ id: "48453", name: "Travis", sizeRank: 1, asOf: "2022-12-31", latest, yoyPct, y5Pct: null, monthly: [], yearly: [] });
const jobs = (empYoy: number | null, wageYoy: number | null, avgWeeklyWage = 1030): JobsRow => ({
  area: "48453",
  period: "2022 Q4",
  estabs: null,
  emp: null,
  wages: null,
  avgWeeklyWage,
  yoy: { estabs: null, emp: empYoy, wages: null, avgWeeklyWage: wageYoy },
  suppressed: false,
});

const at = (s: { points: Array<{ t: number; v: number | null }> }, iso: string) => s.points.find((p) => isoDate(p.t) === iso)?.v;

describe("MOMENTUM_TERMS", () => {
  it("binds to the four spec terms by name with the spec's weights", () => {
    expect(MOMENTUM_SPEC).toHaveLength(4);
    expect(MOMENTUM_TERMS.home.weight + MOMENTUM_TERMS.rent.weight + MOMENTUM_TERMS.jobs.weight + MOMENTUM_TERMS.wage.weight).toBeCloseTo(1, 12);
    expect(MOMENTUM_TERMS.home.scale).toBe(10);
    expect(MOMENTUM_TERMS.jobs.scale).toBe(3);
  });
  it("momentumScore clips, reweights over present terms, null when none", () => {
    expect(momentumScore([{ weight: 1, scale: 10, raw: 50 }])).toBe(1);
    expect(momentumScore([{ weight: 1, scale: 10, raw: -50 }])).toBe(-1);
    expect(momentumScore([{ weight: 0.3, scale: 10, raw: 5 }, { weight: 0.7, scale: 10, raw: null }])).toBeCloseTo(0.5, 12);
    expect(momentumScore([{ weight: 1, scale: 10, raw: null }])).toBeNull();
  });
});

describe("momentumHistory", () => {
  const m = momentumHistory(zhvi, zori, empYoY, wageYoY);
  it("is monthly over the ZHVI months with an estimate provenance naming its inputs", () => {
    expect(m.id).toBe("momentum:county:48453");
    expect(m.points).toHaveLength(36);
    expect(m.frequency).toBe("monthly");
    expect(m.provenance.kind).toBe("estimate");
    expect(m.provenance.method).toContain("clip");
    expect(m.provenance.notes?.[0]).toBe("inputs: zhvi:county:48453, zori:county:48453, qcew:county:48453:emp:yoy, qcew:county:48453:avg-weekly-wage:yoy");
    expect(m.geo).toEqual(zhvi.geo);
  });
  it("hand-computed months", () => {
    // 2022-12: home 5/10, rent 2/10, jobs 3/3 -> 1, wage 0/6 -> 0.3·0.5 + 0.15·0.2 + 0.3·1 + 0.25·0 = 0.48
    expect(at(m, "2022-12-31")).toBeCloseTo(0.48, 12);
    // 2021-06: rent absent (ZORI has no 2020-06); home 0.5, jobs 1, wage 0.5 -> (0.15 + 0.3 + 0.125) / 0.85
    expect(at(m, "2021-06-30")).toBeCloseTo(0.575 / 0.85, 12);
    // 2021-01: only the home term is computable (Q4 2020 has no over-the-year base)
    expect(at(m, "2021-01-31")).toBeCloseTo(0.5, 12);
    // first twelve months: nothing has a base
    expect(m.points.slice(0, 12).every((p) => p.v === null)).toBe(true);
  });
  it("last month equals estimates.ts momentum() on the latest published values", () => {
    const latest = momentum(home(5), home(2), jobs(3, 0));
    expect(at(m, "2022-12-31")).toBeCloseTo(latest.score!, 12);
    const partial = momentum(home(5), undefined, jobs(3, 3));
    expect(at(m, "2021-06-30")).toBeCloseTo(partial.score!, 12);
  });
  it("publication lag shifts the quarterly terms later", () => {
    const lagged = momentumHistory(zhvi, zori, empYoY, wageYoY, { lagMonths: 5 });
    expect(lagged.provenance.notes?.[1]).toContain("lag 5 months");
    // 2022-12 with lag 5 uses 2022 Q2 (stamped Nov 30): same 3 % / 0 % -> 0.48
    expect(at(lagged, "2022-12-31")).toBeCloseTo(0.48, 12);
    // 2021-06 with lag 5: newest usable quarter is 2020 Q4, which has no base -> home only
    expect(at(lagged, "2021-06-30")).toBeCloseTo(0.5, 12);
  });
  it("home-only reduced form is the home term alone and says so", () => {
    const h = momentumHomeOnly(zhvi);
    expect(h.id).toBe("momentum:county:48453:home-only");
    expect(at(h, "2022-12-31")).toBeCloseTo(0.5, 12);
    expect(h.provenance.method).toContain("reduced form");
    expect(h.provenance.notes).toContain("not the full momentum index: rent, jobs and wage terms are missing");
    expect(momentumHistory(zhvi).points.map((p) => p.v)).toEqual(h.points.map((p) => p.v));
  });
});

describe("affordabilityHistory", () => {
  const a = affordabilityHistory(zhvi, mortgage, wage, zori);
  it("last month equals estimates.ts affordability() on the latest values", () => {
    const ref = affordability(home(5), home(2, 1020), jobs(3, 0, 1030), { value: 6, date: "2022-12-16" })!;
    expect(at(a.payment, "2022-12-31")).toBeCloseTo(ref.payment, 9);
    expect(at(a.wageShare!, "2022-12-31")).toBeCloseTo(ref.wageSharePct!, 9);
    expect(at(a.priceToRent!, "2022-12-31")).toBeCloseTo(ref.priceToRent!, 12);
  });
  it("uses the month's rate and the carried-forward wage", () => {
    // 2020-06: price 100,000 at 4 % -> P = 80,000; wage 1000/wk
    const r = 0.04 / 12;
    const pay = (80_000 * r) / (1 - Math.pow(1 + r, -360));
    expect(at(a.payment, "2020-06-30")).toBeCloseTo(pay, 9);
    expect(at(a.wageShare!, "2020-06-30")).toBeCloseTo((pay / ((1000 * 52) / 12)) * 100, 9);
    expect(at(a.priceToRent!, "2020-06-30")).toBeNull(); // ZORI starts 2021
    expect(at(a.priceToRent!, "2021-06-30")).toBeCloseTo(105_000 / 12_000, 12);
  });
  it("omits series whose inputs are absent and labels everything an estimate", () => {
    const bare = affordabilityHistory(zhvi, mortgage);
    expect(bare.wageShare).toBeNull();
    expect(bare.priceToRent).toBeNull();
    expect(bare.payment.id).toBe("affordability:county:48453:payment");
    expect(a.wageShare!.id).toBe("affordability:county:48453:wage-share");
    expect(a.priceToRent!.id).toBe("affordability:county:48453:price-to-rent");
    for (const s of [a.payment, a.wageShare!, a.priceToRent!]) {
      expect(s.provenance.kind).toBe("estimate");
      expect(s.provenance.method).toBeTruthy();
      expect(s.provenance.notes?.[0]).toMatch(/^inputs: zhvi:county:48453/);
    }
    expect(a.wageShare!.provenance.notes?.[0]).toContain(wage.id);
    expect(emp.id).toBe("qcew:county:48453:emp");
  });
});
