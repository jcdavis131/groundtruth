import { describe, expect, it } from "vitest";
import { provenance } from "@/lib/provenance/types";
import { source } from "@/lib/provenance/sources";
import { badRequest, cacheControl, csv, csvDocument, csvFooterLines, notFound, ok, options, parseFormat, wantsCsv, withCors } from "./respond";

const P = provenance(source("fred"), { kind: "published", seriesId: "MORTGAGE30US", period: "2026-09-04", retrievedAt: "2026-09-11T10:00:00Z" });

describe("cacheControl", () => {
  it("matches the economy route's line and falls back to no-store", () => {
    expect(cacheControl(3600)).toBe("public, max-age=0, s-maxage=3600, stale-while-revalidate=3600");
    expect(cacheControl(0)).toBe("no-store");
    expect(cacheControl(-5)).toBe("no-store");
    expect(cacheControl(299.9)).toBe("public, max-age=0, s-maxage=299, stale-while-revalidate=299");
  });
});

describe("ok", () => {
  it("spreads meta beside data and always carries provenance and generatedAt", async () => {
    const res = ok({ x: 1 }, { meta: { source: "fred", cacheAge: 12 }, provenance: [P], ttlS: 60, generatedAt: "2026-09-11T10:00:00.000Z" });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("cache-control")).toBe("public, max-age=0, s-maxage=60, stale-while-revalidate=60");
    const body = await res.json();
    expect(body).toEqual({ source: "fred", cacheAge: 12, data: { x: 1 }, provenance: [P], generatedAt: "2026-09-11T10:00:00.000Z" });
  });
  it("adds caveats only when there are some, and defaults provenance to []", async () => {
    const a = await ok(null, { caveats: ["a"] }).json();
    expect(a.caveats).toEqual(["a"]);
    expect(a.provenance).toEqual([]);
    expect(typeof a.generatedAt).toBe("string");
    const b = await ok(null, { caveats: [] }).json();
    expect("caveats" in b).toBe(false);
    expect(ok(null).headers.get("cache-control")).toBe("no-store");
  });
});

describe("csv", () => {
  it("writes header, rows, then # footer lines with a citation per source", () => {
    const doc = csvDocument([{ a: 1, b: "x,y" }], { columns: ["a", "b"], provenance: [P], caveats: ["watch out"], generatedAt: "2026-09-11T10:00:00.000Z" });
    const lines = doc.split("\r\n");
    expect(lines[0]).toBe("a,b");
    expect(lines[1]).toBe('1,"x,y"');
    expect(lines[2]).toBe("# generated_at: 2026-09-11T10:00:00.000Z");
    expect(lines[3]).toMatch(/^# source: Federal Reserve Bank of St\. Louis\. FRED Economic Data\. series MORTGAGE30US\. period 2026-09-04\./);
    expect(lines[4]).toBe("# caveat: watch out");
    expect(lines[5]).toMatch(/^# read with pandas/);
    expect(doc.endsWith("\r\n")).toBe(true);
    expect(csvFooterLines({ provenance: [], generatedAt: "t" })[0]).toBe("generated_at: t");
  });
  it("can omit the footer for readers that cannot strip comments", () => {
    expect(csvDocument([{ a: 1 }], { footer: false })).toBe("a\r\n1\r\n");
  });
  it("sets text/csv, a sanitised filename, CORS and cache headers", async () => {
    const res = csv([{ a: 1 }], { filename: "economy areas/-98,29.csv", ttlS: 300, provenance: [P] });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe('inline; filename="economy_areas_-98_29.csv"');
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("cache-control")).toContain("s-maxage=300");
    const text = await res.text();
    expect(text.startsWith("a\r\n1\r\n# generated_at: ")).toBe(true);
    expect(text).toContain("# source: Federal Reserve Bank of St. Louis");
  });
});

describe("badRequest / notFound / options / withCors", () => {
  it("returns helpful JSON with CORS", async () => {
    const r = badRequest("bbox=w,s,e,n required", { got: "x" });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "bbox=w,s,e,n required", details: { got: "x" } });
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
    const plain = await badRequest("nope").json();
    expect("details" in plain).toBe(false);
    const nf = notFound("unknown site");
    expect(nf.status).toBe(404);
    expect(await nf.json()).toEqual({ error: "unknown site" });
  });
  it("answers OPTIONS with 204 and copies CORS onto foreign responses", () => {
    const o = options();
    expect(o.status).toBe(204);
    expect(o.headers.get("access-control-allow-methods")).toBe("GET, OPTIONS");
    const res = withCors(new Response("x", { status: 502 }));
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.status).toBe(502);
  });
});

describe("parseFormat / wantsCsv", () => {
  it("reads ?format= from a Request, URL, string or params", () => {
    expect(parseFormat(new Request("http://x/api/economy?op=areas&format=csv"))).toBe("csv");
    expect(parseFormat(new Request("http://x/api/economy?op=areas&format=CSV"))).toBe("csv");
    expect(parseFormat(new URL("http://x/a?format=json"))).toBe("json");
    expect(parseFormat("/api/water?format=csv")).toBe("csv");
    expect(parseFormat(new URLSearchParams("format=csv"))).toBe("csv");
    expect(parseFormat(null)).toBe("json");
  });
  it("falls back to Accept: text/csv, and to json for typos", () => {
    expect(parseFormat(new Request("http://x/a", { headers: { accept: "text/csv" } }))).toBe("csv");
    expect(parseFormat(new Request("http://x/a", { headers: { accept: "application/json, text/csv" } }))).toBe("json");
    expect(parseFormat(new Request("http://x/a?format=xlsx"))).toBe("json");
    expect(wantsCsv("/a?format=csv")).toBe(true);
    expect(wantsCsv("/a")).toBe(false);
  });
});
