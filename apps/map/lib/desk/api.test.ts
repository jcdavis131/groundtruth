import { describe, expect, it } from "vitest";
import { fetchJson, fetchSeries, fipsFromHistoryId, isCountyFips, listPicker, parseHistory, parseIndicatorList, parsePoints, parseSeries, parseSeriesList, ROUTES, unwrap } from "./api";

// Realistic fixtures in the shapes lib/series/types.ts defines; the routes
// themselves are built by other workstreams and are unverified here.
const meta = {
  id: "fred:MORTGAGE30US",
  title: "30-year fixed mortgage rate",
  unit: "%",
  frequency: "weekly",
  tags: ["housing", "macro"],
  provenance: { source: { id: "fred", name: "FRED", publisher: "Federal Reserve Bank of St. Louis", url: "https://fred.stlouisfed.org/", license: "see FRED terms" }, retrievedAt: "2026-09-11T10:00:00Z", kind: "published", seriesId: "MORTGAGE30US" },
};
const series = { ...meta, points: [{ t: 1_756_000_000_000, v: 6.5 }, { t: 1_755_000_000_000, v: null }, { t: "2026-09-04T00:00:00Z", v: "6.4" }, { t: "bad", v: 1 }, { nope: 1 }] };
const envelope = { data: [meta, { id: "" }, "junk"], provenance: [meta.provenance], generatedAt: "2026-09-11T10:00:00Z" };

function fakeFetch(routes: Record<string, { status: number; body?: unknown }>) {
  const calls: string[] = [];
  const impl = async (url: string): Promise<Response> => {
    calls.push(url);
    const r = routes[url];
    if (!r) return new Response("not found", { status: 404 });
    return new Response(r.body == null ? "" : JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
  };
  return { impl, calls };
}

describe("parsers", () => {
  it("parsePoints accepts {t,v} and [t,v], coerces strings, drops junk and sorts", () => {
    const p = parsePoints(series.points);
    expect(p).toEqual([
      { t: 1_755_000_000_000, v: null },
      { t: 1_756_000_000_000, v: 6.5 },
      { t: Date.parse("2026-09-04T00:00:00Z"), v: 6.4 },
    ]);
    expect(parsePoints([[1, 2], ["2026-01-01", null], ["x", 1]])).toEqual([{ t: 1, v: 2 }, { t: Date.parse("2026-01-01"), v: null }]);
    expect(parsePoints("nope")).toEqual([]);
  });
  it("parseSeries keeps meta and points; rejects records without an id", () => {
    const s = parseSeries(series)!;
    expect(s.id).toBe("fred:MORTGAGE30US");
    expect(s.unit).toBe("%");
    expect(s.points).toHaveLength(3);
    expect(s.provenance.source.id).toBe("fred");
    expect(parseSeries({ title: "no id" })).toBeNull();
    expect(parseSeries(null)).toBeNull();
    // missing provenance gets an honest placeholder rather than a crash
    expect(parseSeries({ id: "x", points: [] })!.provenance.source.id).toBe("unknown");
  });
  it("parseSeriesList unwraps the envelope and skips malformed entries", () => {
    const items = parseSeriesList(envelope);
    expect(items).toEqual([{ id: "fred:MORTGAGE30US", label: "30-year fixed mortgage rate", unit: "%", source: "series", hint: "housing macro" }]);
    expect(parseSeriesList([meta])).toHaveLength(1);
    expect(parseSeriesList({ data: "x" })).toEqual([]);
    expect(unwrap({ data: 1 })).toBe(1);
    expect(unwrap([1])).toEqual([1]);
  });
  it("parseIndicatorList reads indicator metadata", () => {
    const items = parseIndicatorList({ data: [{ id: "sahm-rule", title: "Sahm rule", unit: "pts", category: "labour", seriesId: "SAHMREALTIME" }, { title: "no id" }] });
    expect(items).toEqual([{ id: "sahm-rule", label: "Sahm rule", unit: "pts", source: "indicator", hint: "labour SAHMREALTIME" }]);
  });
  it("parseHistory accepts an array, a {series} object or a single series", () => {
    expect(parseHistory({ data: [series, series] })).toHaveLength(2);
    expect(parseHistory({ data: { series: [series] } })).toHaveLength(1);
    expect(parseHistory({ data: series })).toHaveLength(1);
    expect(parseHistory({ data: null })).toEqual([]);
  });
  it("validates county FIPS and extracts them from history ids", () => {
    expect(isCountyFips("48453")).toBe(true);
    expect(isCountyFips("72001")).toBe(true);
    expect(isCountyFips("99001")).toBe(false);
    expect(isCountyFips("4845")).toBe(false);
    expect(fipsFromHistoryId("zhvi:county:48453")).toBe("48453");
    expect(fipsFromHistoryId("qcew:48453:10")).toBe("48453");
    expect(fipsFromHistoryId("fred:MORTGAGE30US")).toBeNull();
    expect(fipsFromHistoryId("x:99999")).toBeNull();
  });
});

describe("fetchJson", () => {
  it("folds 404 into missing, other errors into messages, and returns JSON on success", async () => {
    const { impl } = fakeFetch({
      "/ok": { status: 200, body: { data: 1 } },
      "/bad": { status: 400, body: { error: "fips must be five digits" } },
      "/boom": { status: 500 },
    });
    expect(await fetchJson("/ok", impl)).toEqual({ ok: true, data: { data: 1 } });
    expect(await fetchJson("/missing", impl)).toMatchObject({ ok: false, missing: true });
    expect(await fetchJson("/bad", impl)).toEqual({ ok: false, missing: false, message: "fips must be five digits" });
    expect(await fetchJson("/boom", impl)).toEqual({ ok: false, missing: false, message: "HTTP 500" });
    const failing = async () => {
      throw new Error("offline");
    };
    expect(await fetchJson("/x", failing)).toEqual({ ok: false, missing: false, message: "offline" });
  });
});

describe("listPicker / fetchSeries", () => {
  it("lists series and indicators through their routes", async () => {
    const { impl, calls } = fakeFetch({
      [ROUTES.seriesList]: { status: 200, body: envelope },
      [ROUTES.indicatorList]: { status: 200, body: { data: [{ id: "i1", title: "I", unit: "u", category: "water" }] } },
    });
    const s = await listPicker("series", { fetchImpl: impl });
    expect(s.ok && s.data[0].id).toBe("fred:MORTGAGE30US");
    const i = await listPicker("indicator", { fetchImpl: impl });
    expect(i.ok && i.data[0].source).toBe("indicator");
    expect(calls).toEqual([ROUTES.seriesList, ROUTES.indicatorList]);
  });
  it("county history needs a valid FIPS and yields one item per series", async () => {
    const { impl } = fakeFetch({ [ROUTES.countyHistory("48453")]: { status: 200, body: { data: [{ ...series, id: "zhvi:county:48453" }] } } });
    expect(await listPicker("history", { fetchImpl: impl, fips: "12" })).toMatchObject({ ok: false, missing: false });
    const h = await listPicker("history", { fetchImpl: impl, fips: "48453" });
    expect(h.ok && h.data).toEqual([{ id: "zhvi:county:48453", label: meta.title, unit: "%", source: "history", hint: "48453" }]);
  });
  it("reports a missing route instead of throwing", async () => {
    const { impl } = fakeFetch({});
    const r = await listPicker("series", { fetchImpl: impl });
    expect(r).toMatchObject({ ok: false, missing: true });
  });
  it("fetches a series, an indicator's series, and a history series by FIPS in its id", async () => {
    const { impl } = fakeFetch({
      [ROUTES.seriesGet("fred:MORTGAGE30US")]: { status: 200, body: { data: series } },
      [ROUTES.indicatorGet("i1")]: { status: 200, body: { data: { indicator: { id: "i1" }, series: { ...series, id: "indicator:i1" }, status: {} } } },
      [ROUTES.countyHistory("48453")]: { status: 200, body: { data: [{ ...series, id: "zhvi:county:48453" }, { ...series, id: "qcew:48453" }] } },
    });
    const a = await fetchSeries({ id: "fred:MORTGAGE30US", label: "", color: "", source: "series" }, { fetchImpl: impl });
    expect(a.ok && a.data.points.length).toBe(3);
    const b = await fetchSeries({ id: "i1", label: "", color: "", source: "indicator" }, { fetchImpl: impl });
    expect(b.ok && b.data.id).toBe("indicator:i1");
    const c = await fetchSeries({ id: "qcew:48453", label: "", color: "", source: "history" }, { fetchImpl: impl });
    expect(c.ok && c.data.id).toBe("qcew:48453");
    const d = await fetchSeries({ id: "zhvi:county:00000", label: "", color: "", source: "history" }, { fetchImpl: impl });
    expect(d).toMatchObject({ ok: false });
    const e = await fetchSeries({ id: "nope:48453", label: "", color: "", source: "history" }, { fetchImpl: impl });
    expect(e).toMatchObject({ ok: false, missing: false });
    const f = await fetchSeries({ id: "gone", label: "", color: "", source: "series" }, { fetchImpl: impl });
    expect(f).toMatchObject({ ok: false, missing: true });
  });
});
