import { describe, expect, it } from "vitest";
import { DEFAULT_HISTORY_POINTS, envelope, historyCsv, latestCsv, MAX_HISTORY_POINTS, parseCategory, parseHistoryParams, parseIds, parseTime } from "./api";
import type { IndicatorResult } from "./service";
import { evaluate } from "./evaluate";
import { indicatorMeta } from "./types";
import { indicatorById } from "./registry";
import { provenance } from "@/lib/provenance/types";
import { source } from "@/lib/provenance/sources";

describe("parseIds", () => {
  it("accepts absent, dedupes, keeps order", () => {
    expect(parseIds(null)).toEqual({ ok: true, value: undefined });
    expect(parseIds(" ")).toEqual({ ok: true, value: undefined });
    expect(parseIds("wti-crude, mortgage-30y,wti-crude")).toEqual({ ok: true, value: ["wti-crude", "mortgage-30y"] });
  });
  it("rejects unknown ids with the offending names and bounds the count", () => {
    const r = parseIds("wti-crude,nope,also-nope");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/nope, also-nope/);
    expect(parseIds(",,,").ok).toBe(false);
    expect(parseIds(Array.from({ length: 101 }, (_, i) => `x${i}`).join(",")).ok).toBe(false);
  });
});

describe("parseCategory / parseTime", () => {
  it("whitelists categories case-insensitively", () => {
    expect(parseCategory("Water")).toEqual({ ok: true, value: "water" });
    expect(parseCategory(null)).toEqual({ ok: true, value: undefined });
    expect(parseCategory("crypto").ok).toBe(false);
  });
  it("reads dates, ISO times and epoch ms", () => {
    expect(parseTime("2026-01-02")).toEqual({ ok: true, value: Date.UTC(2026, 0, 2) });
    expect(parseTime("2026-01-02T03:04:05Z")).toEqual({ ok: true, value: Date.UTC(2026, 0, 2, 3, 4, 5) });
    expect(parseTime("1700000000000")).toEqual({ ok: true, value: 1700000000000 });
    expect(parseTime(null)).toEqual({ ok: true, value: undefined });
    expect(parseTime("yesterday").ok).toBe(false);
  });
});

describe("parseHistoryParams", () => {
  const q = (o: Partial<Record<"id" | "from" | "to" | "limit" | "format", string>>) => ({ id: null, from: null, to: null, limit: null, format: null, ...o });
  it("requires a known id and defaults the rest", () => {
    expect(parseHistoryParams(q({})).ok).toBe(false);
    expect(parseHistoryParams(q({ id: "nope" })).ok).toBe(false);
    const r = parseHistoryParams(q({ id: "wti-crude" }));
    expect(r).toEqual({ ok: true, value: { id: "wti-crude", from: undefined, to: undefined, limit: DEFAULT_HISTORY_POINTS, format: "json" } });
  });
  it("clamps limit, validates order and format", () => {
    const big = parseHistoryParams(q({ id: "wti-crude", limit: "999999" }));
    expect(big.ok && big.value.limit).toBe(MAX_HISTORY_POINTS);
    const small = parseHistoryParams(q({ id: "wti-crude", limit: "-4" }));
    expect(small.ok && small.value.limit).toBe(1);
    expect(parseHistoryParams(q({ id: "wti-crude", limit: "abc" })).ok).toBe(false);
    expect(parseHistoryParams(q({ id: "wti-crude", from: "2026-02-01", to: "2026-01-01" })).ok).toBe(false);
    expect(parseHistoryParams(q({ id: "wti-crude", from: "bad" })).ok).toBe(false);
    expect(parseHistoryParams(q({ id: "wti-crude", format: "xml" })).ok).toBe(false);
    const csv = parseHistoryParams(q({ id: "wti-crude", format: "CSV", from: "2026-01-01", to: "2026-02-01" }));
    expect(csv.ok && csv.value.format).toBe("csv");
  });
});

describe("csv", () => {
  const prov = provenance(source("fred"), { kind: "published", seriesId: "DCOILWTICO", retrievedAt: "2026-09-11T00:00:00.000Z" });
  it("renders history rows with ISO times and escapes nothing it need not", () => {
    const csv = historyCsv({ id: "indicator:wti-crude", unit: "$ per barrel", provenance: prov, points: [{ t: Date.UTC(2026, 0, 1), v: 70.5 }, { t: Date.UTC(2026, 0, 2), v: null }] });
    expect(csv.split("\n")).toEqual(["time,value,unit,source,series_id", "2026-01-01T00:00:00.000Z,70.5,$ per barrel,fred,DCOILWTICO", "2026-01-02T00:00:00.000Z,,$ per barrel,fred,DCOILWTICO"]);
  });
  it("renders evaluated indicators one per row, quoting commas and joining triggered labels", () => {
    const ind = indicatorById("mississippi-memphis-stage")!;
    const ev = evaluate(ind, { points: [{ t: Date.UTC(2026, 8, 9), v: -4 }, { t: Date.UTC(2026, 8, 10), v: -9 }] });
    const items: IndicatorResult[] = [
      { meta: indicatorMeta(ind), evaluation: ev, provenance: prov },
      { meta: indicatorMeta(indicatorById("wti-crude")!), evaluation: evaluate(ind, { points: [] }), error: "upstream 503, retry" },
    ];
    const lines = latestCsv(items).split("\n");
    expect(lines[0]).toMatch(/^id,title,category,unit,latest,latest_at/);
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('"Mississippi River at Memphis, stage"');
    expect(lines[1]).toContain(",-9,2026-09-10T00:00:00.000Z,-4,");
    expect(lines[1]).toContain("alert,");
    expect(lines[1]).toContain("low water, barge drafts restricted (convention) | severe low water");
    expect(lines[2]).toContain("no data");
    expect(lines[2].endsWith('"upstream 503, retry"')).toBe(true);
  });
});

describe("envelope", () => {
  it("dedupes provenance by source and series and only adds caveats when present", () => {
    const a = provenance(source("fred"), { kind: "published", seriesId: "A" });
    const b = provenance(source("fred"), { kind: "published", seriesId: "A" });
    const c = provenance(source("usgs-water"), { kind: "published", seriesId: "A" });
    const e = envelope({ x: 1 }, [a, b, c], [], "2026-09-11T00:00:00.000Z");
    expect(e.provenance).toHaveLength(2);
    expect(e.generatedAt).toBe("2026-09-11T00:00:00.000Z");
    expect("caveats" in e).toBe(false);
    expect(envelope(1, [], ["careful"]).caveats).toEqual(["careful"]);
  });
});
