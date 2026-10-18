import { describe, expect, it } from "vitest";
import { describeVintages, qcewPeriod, zillowPeriod, type VintageInputs } from "./vintage";

const T = "2026-09-11T14:00:00.000Z";

const fixture: VintageInputs = {
  now: T,
  zillow: [
    { kind: "zhviCounty", asOf: "2026-07-31", rows: 3050, retrievedAt: T },
    { kind: "zoriCounty", asOf: "2026-07-31", rows: 1400, retrievedAt: T },
  ],
  qcew: { period: "2026 Q1", year: 2026, qtr: 1, counties: 3220, retrievedAt: T },
  border: { asOf: "2026-06", ports: 115, retrievedAt: T },
  ports: { year: 2025, ports: 150, retrievedAt: T },
  fred: [
    { id: "MORTGAGE30US", date: "2026-09-10", label: "30-year fixed mortgage rate", retrievedAt: T },
    { id: "UNRATE", date: "2026-08-01", label: "unemployment rate", retrievedAt: T },
    { id: "NOTINCAL", date: "2026-08-01", retrievedAt: T },
  ],
  btsIndicators: [{ id: "bts-diesel", date: "2026-09-07", label: "diesel", retrievedAt: T }],
  usdm: { retrievedAt: T },
  worldBank: { years: { "NY.GDP.MKTP.CD": "2024", "IS.SHP.GOOD.TU": "2023" }, retrievedAt: T },
  wits: { year: 2023, iso3: "USA", retrievedAt: T },
};

describe("period helpers", () => {
  it("normalise Zillow and QCEW periods", () => {
    expect(zillowPeriod("2026-07-31")).toBe("2026-07");
    expect(zillowPeriod("garbage")).toBe("garbage");
    expect(qcewPeriod("2026 Q1")).toBe("2026 Q1");
    expect(qcewPeriod("2026-Q1")).toBe("2026 Q1");
    expect(qcewPeriod("2026q3")).toBe("2026 Q3");
    expect(qcewPeriod("weird")).toBe("weird");
  });
});

describe("describeVintages", () => {
  const out = describeVintages(fixture);
  const by = (id: string) => out.find((v) => v.id === id)!;

  it("keeps every table in a stable order and reads periods from the tables", () => {
    expect(out.map((v) => v.id)).toEqual([
      "zillow-zhvi:zhviCounty",
      "zillow-zori:zoriCounty",
      "bls-qcew",
      "bts-border",
      "bts-ports",
      "fred:MORTGAGE30US",
      "fred:UNRATE",
      "fred:NOTINCAL",
      "bts-supply-chain:bts-diesel",
      "usdm",
      "worldbank-wdi",
      "worldbank-wits",
    ]);
    expect(by("zillow-zhvi:zhviCounty").period).toBe("2026-07");
    expect(by("zillow-zhvi:zhviCounty").rows).toBe(3050);
    expect(by("bls-qcew").period).toBe("2026 Q1");
    expect(by("bts-border").period).toBe("2026-06");
    expect(by("bts-ports").period).toBe("2025");
    expect(by("fred:MORTGAGE30US").period).toBe("2026-09-10");
    expect(by("worldbank-wdi").period).toBe("2024");
    expect(by("worldbank-wits").period).toBe("2023");
  });

  it("infers release windows from the calendar and says so", () => {
    const z = by("zillow-zhvi:zhviCounty");
    expect(z.basis).toBe("rule");
    expect(z.precision).toBe("approximate");
    // Retrieved 11 Sep: the last third-week window is August's.
    expect(z.releaseWindow).toEqual({ earliest: "2026-08-14", latest: "2026-08-21", nominal: "2026-08-14" });
    expect(z.nextWindow?.earliest).toBe("2026-09-14");
    expect(z.maybeStale).toBe(false);
    expect(z.notes.join(" ")).toMatch(/inferred/);
    const m = by("fred:MORTGAGE30US");
    expect(m.precision).toBe("official");
    expect(m.releaseWindow?.earliest).toBe(m.releaseWindow?.latest);
    expect(m.releaseWindow?.nominal).toBe("2026-09-10");
    expect(m.scheduleUrl).toContain("freddiemac");
  });

  it("flags a table whose next window has fully passed since retrieval", () => {
    const old = describeVintages({ now: "2026-09-11T00:00:00Z", fred: [{ id: "MORTGAGE30US", date: "2026-08-20", retrievedAt: "2026-08-21T00:00:00Z" }] });
    expect(old[0].maybeStale).toBe(true);
  });

  it("marks unknown sources rather than inventing a window", () => {
    const u = by("fred:NOTINCAL");
    expect(u.basis).toBe("unknown");
    expect(u.releaseWindow).toBeUndefined();
    expect(u.title).toBe("FRED NOTINCAL");
    expect(u.notes[0]).toMatch(/newest observation/);
  });

  it("derives the USDM map date from the Thursday cycle when the service gave none", () => {
    const u = by("usdm");
    // Last Thursday on or before 11 Sep 2026 is 10 Sep; the map is dated the Tuesday before, 8 Sep.
    expect(u.releaseWindow?.nominal).toBe("2026-09-10");
    expect(u.period).toBe("2026-09-08");
    expect(u.basis).toBe("rule");
    expect(u.notes[0]).toMatch(/not read from the table/);
    const withDate = describeVintages({ now: T, usdm: { mapDate: "2026-09-08", retrievedAt: T } });
    expect(withDate[0].period).toBe("2026-09-08");
    expect(withDate[0].notes[0]).toMatch(/read from the feature service/);
  });

  it("uses the newest retrievedAt as now when none is given", () => {
    const a = describeVintages({ qcew: { period: "2026 Q1", year: 2026, qtr: 1, retrievedAt: "2026-09-11T10:00:00Z" } });
    expect(a[0].releaseWindow?.nominal).toBe("2026-08-28");
    expect(describeVintages({})).toEqual([]);
  });
});
