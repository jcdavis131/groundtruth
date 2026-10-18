import { describe, expect, it } from "vitest";
import {
  effectivePrecision,
  findEntry,
  isoDate,
  lastReleaseBefore,
  nextReleaseAfter,
  parseRule,
  RELEASE_CALENDAR,
  releasesBetween,
  upcomingReleases,
  utcDay,
  windowFor,
} from "./calendar";
import { SOURCES } from "@/lib/provenance/sources";

describe("parseRule", () => {
  it("parses every form in the grammar", () => {
    expect(parseRule("daily")).toMatchObject({ cadence: "daily", approximate: false, business: false });
    expect(parseRule("daily:business")).toMatchObject({ cadence: "daily", business: true });
    expect(parseRule("continuous")).toMatchObject({ cadence: "continuous" });
    expect(parseRule("weekly:THU")).toMatchObject({ cadence: "weekly", dow: 4, approximate: false });
    expect(parseRule("monthly:day=17")).toMatchObject({ cadence: "monthly", day: 17, approximate: false, tolDays: 0 });
    expect(parseRule("monthly:day~17")).toMatchObject({ cadence: "monthly", day: 17, approximate: true, tolDays: 3 });
    expect(parseRule("monthly:day~17:tol=2")).toMatchObject({ tolDays: 2 });
    expect(parseRule("monthly:days=14-21")).toMatchObject({ approximate: true, span: { fromDay: 14, toDay: 21 } });
    expect(parseRule("monthly:first-FRI")).toMatchObject({ nth: 1, dow: 5, approximate: false });
    expect(parseRule("monthly:last-TUE")).toMatchObject({ nth: -1, dow: 2 });
    expect(parseRule("quarterly:+150d")).toMatchObject({ cadence: "quarterly", lagDays: 150, tolDays: 10, approximate: true });
    expect(parseRule("quarterly:+150d:tol=14")).toMatchObject({ tolDays: 14 });
    expect(parseRule("annual:month=4")).toMatchObject({ cadence: "annual", month: 4, approximate: true, span: { fromDay: 1, toDay: 31 } });
    expect(parseRule("annual:month=4:day=15")).toMatchObject({ month: 4, day: 15, approximate: false });
  });
  it("rejects what it does not understand", () => {
    for (const bad of ["", "hourly", "weekly", "weekly:XYZ", "monthly:day=0", "monthly:day=32", "monthly:days=21-14", "monthly:fifth-MON", "quarterly", "quarterly:150d", "annual", "annual:month=13", "monthly:day~5:tol=99"]) {
      expect(() => parseRule(bad), bad).toThrow();
    }
  });
});

describe("utcDay / isoDate", () => {
  it("floors to the UTC day whatever the local zone", () => {
    expect(isoDate(utcDay("2026-03-08T23:59:59Z"))).toBe("2026-03-08");
    expect(isoDate(utcDay("2026-03-08"))).toBe("2026-03-08");
    expect(isoDate(utcDay(Date.UTC(2026, 10, 1, 0, 30)))).toBe("2026-11-01");
    expect(() => utcDay("not a date")).toThrow();
  });
});

describe("weekly", () => {
  it("finds the next and last Thursday, exact window", () => {
    // 2026-09-11 is a Friday.
    expect(nextReleaseAfter("weekly:THU", "2026-09-11")).toEqual({ earliest: "2026-09-17", latest: "2026-09-17", nominal: "2026-09-17" });
    expect(lastReleaseBefore("weekly:THU", "2026-09-11").nominal).toBe("2026-09-10");
    // On the day itself: last is today, next is a week out.
    expect(lastReleaseBefore("weekly:THU", "2026-09-10").nominal).toBe("2026-09-10");
    expect(nextReleaseAfter("weekly:THU", "2026-09-10").nominal).toBe("2026-09-17");
  });
  it("is unaffected by the US DST change (March 2026)", () => {
    // DST starts 2026-03-08 in the US; Thursdays stay seven days apart.
    const list = releasesBetween("weekly:THU", "2026-03-01", "2026-03-31").map((w) => w.nominal);
    expect(list).toEqual(["2026-03-05", "2026-03-12", "2026-03-19", "2026-03-26"]);
  });
});

describe("daily", () => {
  it("skips weekends in business mode", () => {
    expect(nextReleaseAfter("daily:business", "2026-09-11").nominal).toBe("2026-09-14");
    expect(nextReleaseAfter("daily", "2026-09-11").nominal).toBe("2026-09-12");
    expect(lastReleaseBefore("daily:business", "2026-09-13").nominal).toBe("2026-09-11");
  });
});

describe("monthly", () => {
  it("exact day, clamped to month length", () => {
    expect(nextReleaseAfter("monthly:day=31", "2026-02-01").nominal).toBe("2026-02-28");
    expect(nextReleaseAfter("monthly:day=17", "2026-09-17").nominal).toBe("2026-10-17");
    expect(lastReleaseBefore("monthly:day=17", "2026-09-17").nominal).toBe("2026-09-17");
  });
  it("approximate day returns a window around the nominal date", () => {
    expect(nextReleaseAfter("monthly:day~17", "2026-09-01")).toEqual({ earliest: "2026-09-14", latest: "2026-09-20", nominal: "2026-09-17" });
    expect(nextReleaseAfter("monthly:day~18:tol=2", "2026-09-01")).toEqual({ earliest: "2026-09-16", latest: "2026-09-20", nominal: "2026-09-18" });
  });
  it("day range windows and slack", () => {
    expect(nextReleaseAfter("monthly:days=14-21", "2026-09-01")).toEqual({ earliest: "2026-09-14", latest: "2026-09-21", nominal: "2026-09-14" });
    expect(windowFor(parseRule("monthly:days=14-21"), Date.UTC(2026, 8, 14), 1)).toEqual({ earliest: "2026-09-13", latest: "2026-09-22", nominal: "2026-09-14" });
  });
  it("nth weekday: first Friday and last Tuesday", () => {
    expect(nextReleaseAfter("monthly:first-FRI", "2026-09-04").nominal).toBe("2026-10-02");
    expect(lastReleaseBefore("monthly:first-FRI", "2026-09-04").nominal).toBe("2026-09-04");
    expect(nextReleaseAfter("monthly:last-TUE", "2026-09-01").nominal).toBe("2026-09-29");
    expect(nextReleaseAfter("monthly:last-TUE", "2026-09-29").nominal).toBe("2026-10-27");
    // Slack widens a one-day rule for entries marked approximate.
    expect(nextReleaseAfter("monthly:first-FRI", "2026-09-04", 7)).toEqual({ earliest: "2026-09-25", latest: "2026-10-09", nominal: "2026-10-02" });
  });
});

describe("quarterly", () => {
  it("lags quarter ends and brackets with a window", () => {
    // Q1 ends 31 Mar; +150 days = 28 Aug.
    expect(lastReleaseBefore("quarterly:+150d:tol=14", "2026-09-11")).toEqual({ earliest: "2026-08-14", latest: "2026-09-11", nominal: "2026-08-28" });
    // Q2 ends 30 Jun; +150 = 27 Nov.
    expect(nextReleaseAfter("quarterly:+150d:tol=14", "2026-09-11").nominal).toBe("2026-11-27");
    // Long lag still finds January's release of the prior year's Q3 (30 Sep + 150 = 27 Feb).
    expect(nextReleaseAfter("quarterly:+150d", "2027-01-01").nominal).toBe("2027-02-27");
  });
});

describe("annual", () => {
  it("month-only rule spans the whole month; day rule is exact", () => {
    expect(nextReleaseAfter("annual:month=4", "2026-09-11")).toEqual({ earliest: "2027-04-01", latest: "2027-04-30", nominal: "2027-04-01" });
    expect(lastReleaseBefore("annual:month=2", "2026-09-11")).toEqual({ earliest: "2026-02-01", latest: "2026-02-28", nominal: "2026-02-01" });
    expect(nextReleaseAfter("annual:month=4:day=15", "2026-04-15").nominal).toBe("2027-04-15");
  });
});

describe("RELEASE_CALENDAR", () => {
  it("every entry parses, cites a registered source and has a sane precision", () => {
    const ids = new Set<string>();
    for (const e of RELEASE_CALENDAR) {
      expect(() => parseRule(e.rule), e.id).not.toThrow();
      expect(SOURCES[e.sourceId], e.id).toBeDefined();
      expect(ids.has(e.id), `duplicate ${e.id}`).toBe(false);
      ids.add(e.id);
      // An approximate rule can never be presented as official.
      if (parseRule(e.rule).approximate) expect(effectivePrecision(e), e.id).toBe("approximate");
      if (e.precision === "official") expect(e.scheduleUrl, `${e.id} official without a schedule url`).toBeTruthy();
    }
  });
  it("official entries answer with a one-day window; approximate ones never claim a single day", () => {
    const usdm = findEntry("usdm")!;
    const w = nextReleaseAfter(usdm.rule, "2026-09-11");
    expect(w.earliest).toBe(w.latest);
    const qcew = findEntry("bls-qcew")!;
    const q = nextReleaseAfter(qcew.rule, "2026-09-11");
    expect(q.earliest < q.latest).toBe(true);
  });
  it("findEntry resolves by id or source + series", () => {
    expect(findEntry("fred:UNRATE")?.seriesId).toBe("UNRATE");
    expect(findEntry("fred", "UNRATE")?.id).toBe("fred:UNRATE");
    expect(findEntry("fred", "NOPE")).toBeUndefined();
    expect(findEntry("zillow-zhvi")?.rule).toBe("monthly:days=14-21");
  });
});

describe("upcomingReleases", () => {
  it("lists windows in range, sorted by earliest date, continuous sources once", () => {
    const list = upcomingReleases("2026-09-11", "2026-10-10");
    expect(list.length).toBeGreaterThan(10);
    for (let i = 1; i < list.length; i++) expect(list[i - 1].window.earliest <= list[i].window.earliest).toBe(true);
    expect(list.filter((o) => o.entry.id === "usgs-water")).toHaveLength(1);
    // Four Thursdays in the range for the USDM.
    expect(list.filter((o) => o.entry.id === "usdm").map((o) => o.window.nominal)).toEqual(["2026-09-17", "2026-09-24", "2026-10-01", "2026-10-08"]);
    // UNRATE is approximate with slack even though its rule lands on one day.
    const un = list.find((o) => o.entry.id === "fred:UNRATE")!;
    expect(un.precision).toBe("approximate");
    expect(un.window.earliest < un.window.latest).toBe(true);
  });
  it("accepts a custom entry list", () => {
    const list = upcomingReleases("2026-09-01", "2026-09-30", [{ id: "x", sourceId: "fred", title: "x", cadence: "weekly", rule: "weekly:MON", precision: "official" }]);
    expect(list.map((o) => o.window.nominal)).toEqual(["2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28"]);
  });
});
