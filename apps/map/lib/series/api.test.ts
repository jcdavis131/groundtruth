import { describe, expect, it } from "vitest";
import { cronAuth, csvFileName, envelope, parseFormat, parseGetParams, parseOnly, parseOp, parsePrefix, parseRollup, parseSeriesId, parseSeriesIds, parseTime } from "./api";
import { provenance } from "@/lib/provenance/types";
import { source } from "@/lib/provenance/sources";

const q = (s: string) => new URLSearchParams(s);

describe("parseTime", () => {
  it("accepts ISO and epoch ms, rejects garbage and absurd values", () => {
    expect(parseTime("2026-09-11T00:00:00Z")).toEqual({ ok: true, value: Date.UTC(2026, 8, 11) });
    expect(parseTime("1757548800000")).toEqual({ ok: true, value: 1757548800000 });
    expect(parseTime("")).toEqual({ ok: true, value: undefined });
    expect(parseTime(null)).toEqual({ ok: true, value: undefined });
    expect(parseTime("yesterday").ok).toBe(false);
    expect(parseTime("-5").ok).toBe(false);
    expect(parseTime("99999999999999999").ok).toBe(false);
  });
});

describe("enum-ish params", () => {
  it("op", () => {
    expect(parseOp(null)).toEqual({ ok: true, value: "list" });
    expect(parseOp("get")).toEqual({ ok: true, value: "get" });
    expect(parseOp("drop").ok).toBe(false);
  });
  it("prefix", () => {
    expect(parsePrefix("snapshot:port-")).toEqual({ ok: true, value: "snapshot:port-" });
    expect(parsePrefix(null)).toEqual({ ok: true, value: undefined });
    expect(parsePrefix("a b").ok).toBe(false);
    expect(parsePrefix("x".repeat(121)).ok).toBe(false);
  });
  it("rollup and format", () => {
    expect(parseRollup("daily-mean")).toEqual({ ok: true, value: "daily-mean" });
    expect(parseRollup(null)).toEqual({ ok: true, value: undefined });
    expect(parseRollup("weekly").ok).toBe(false);
    expect(parseFormat(null)).toEqual({ ok: true, value: "json" });
    expect(parseFormat("csv")).toEqual({ ok: true, value: "csv" });
    expect(parseFormat("xlsx").ok).toBe(false);
  });
  it("ids", () => {
    expect(parseSeriesId("snapshot:quakes:world:m2.5")).toEqual({ ok: true, value: "snapshot:quakes:world:m2.5" });
    expect(parseSeriesId("../x").ok).toBe(false);
    expect(parseSeriesId(null).ok).toBe(false);
    expect(parseSeriesIds("snapshot:a, snapshot:b,snapshot:a")).toEqual({ ok: true, value: ["snapshot:a", "snapshot:b"] });
    expect(parseSeriesIds(",,").ok).toBe(false);
    expect(parseSeriesIds(Array.from({ length: 21 }, (_, i) => `snapshot:s${i}`).join(",")).ok).toBe(false);
    expect(parseSeriesIds("snapshot:a,bad id").ok).toBe(false);
  });
  it("only", () => {
    expect(parseOnly(null)).toEqual({ ok: true, value: undefined });
    expect(parseOnly("quakes, gauges")).toEqual({ ok: true, value: ["quakes", "gauges"] });
    expect(parseOnly("Quakes").ok).toBe(false);
    expect(parseOnly("a;b").ok).toBe(false);
  });
});

describe("parseGetParams", () => {
  it("parses a full query", () => {
    const r = parseGetParams(q("id=snapshot:port-vessels:USLAX&from=2026-09-01&to=2026-09-11T00:00:00Z&limit=10&rollup=daily-max&format=csv"));
    expect(r).toEqual({
      ok: true,
      value: { ids: ["snapshot:port-vessels:USLAX"], single: true, from: Date.UTC(2026, 8, 1), to: Date.UTC(2026, 8, 11), limit: 10, rollup: "daily-max", format: "csv" },
    });
  });
  it("defaults and multi-id", () => {
    const r = parseGetParams(q("ids=snapshot:a,snapshot:b"));
    expect(r.ok && r.value).toMatchObject({ ids: ["snapshot:a", "snapshot:b"], single: false, limit: 5000, format: "json" });
  });
  it("rejects bad combinations", () => {
    expect(parseGetParams(q(""))).toEqual({ ok: false, error: "id (or ids) is required" });
    expect(parseGetParams(q("id=snapshot:a&ids=snapshot:b")).ok).toBe(false);
    expect(parseGetParams(q("id=snapshot:a&from=2026-09-11&to=2026-09-01")).ok).toBe(false);
    expect(parseGetParams(q("id=snapshot:a&limit=ten")).ok).toBe(false);
    expect(parseGetParams(q("id=snapshot:a&limit=-1")).ok).toBe(false);
    expect(parseGetParams(q("id=snapshot:a&rollup=hourly")).ok).toBe(false);
    expect(parseGetParams(q("id=snapshot:a&format=xml")).ok).toBe(false);
    const big = parseGetParams(q("id=snapshot:a&limit=9999999"));
    expect(big.ok && big.value.limit).toBe(50_000);
  });
});

describe("cronAuth", () => {
  it("is invisible without a secret and constant-time otherwise", () => {
    expect(cronAuth("x", undefined)).toBe("unset");
    expect(cronAuth("x", "  ")).toBe("unset");
    expect(cronAuth(null, "s3cret")).toBe("denied");
    expect(cronAuth("s3cre", "s3cret")).toBe("denied");
    expect(cronAuth("S3CRET", "s3cret")).toBe("denied");
    expect(cronAuth(" s3cret ", "s3cret")).toBe("ok");
  });
});

describe("envelope / csvFileName", () => {
  it("dedupes provenance and only adds caveats when present", () => {
    const p1 = provenance(source("adsb-lol"), { kind: "snapshot", retrievedAt: "2026-09-11T00:00:00Z" });
    const p2 = provenance(source("adsb-lol"), { kind: "snapshot", retrievedAt: "2026-09-11T01:00:00Z" });
    const p3 = provenance(source("usgs-water"), { kind: "published", seriesId: "x", retrievedAt: "2026-09-11T00:00:00Z" });
    const e = envelope({ n: 1 }, [p1, p2, p3], [], "2026-09-11T02:00:00Z");
    expect(e.provenance).toEqual([p1, p3]);
    expect(e.caveats).toBeUndefined();
    expect(e.generatedAt).toBe("2026-09-11T02:00:00Z");
    expect(envelope(1, [], ["x"]).caveats).toEqual(["x"]);
  });
  it("names downloads safely", () => {
    expect(csvFileName(["snapshot:port-vessels:USLAX"])).toBe("snapshot_port-vessels_USLAX.csv");
    expect(csvFileName(["snapshot:a", "snapshot:b"])).toBe("2-series.csv");
  });
});
