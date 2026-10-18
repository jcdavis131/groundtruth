import { describe, expect, it } from "vitest";
import { base64urlDecode, base64urlEncode, decodeToken, encodeToken, fromCompact, LIMITS, newId, newWatchlist, streamCodec, toCompact, validateWatchlist, windowMs, type Watchlist } from "./model";
import { decodeTokenSync, encodeTokenSync, nodeCodec } from "./token-node";

const good: Watchlist = {
  id: "austin-housing",
  title: "Austin housing",
  items: [
    { kind: "county", id: "48453", name: "Travis County, TX", geo: [-97.78, 30.33] },
    { kind: "port", id: "12345", name: "Houston" },
    { kind: "series", id: "snapshot:port-vessels:USLAX" },
  ],
  rules: [
    { itemRef: 0, metric: "home.yoyPct", op: ">=", value: 3 },
    { itemRef: "*", metric: "value", op: "changes_by_pct", value: -10, window: "7d" },
    { metric: "container.total", op: "crosses_above", value: 1e6 },
  ],
  createdAt: "2026-09-01T00:00:00.000Z",
  version: 4,
};

describe("validateWatchlist", () => {
  it("accepts a good document and normalises it", () => {
    const v = validateWatchlist({ ...good, id: " Austin-Housing ", title: "  Austin housing " });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.value.id).toBe("austin-housing");
    expect(v.value.title).toBe("Austin housing");
    expect(v.value.items[0].geo).toEqual([-97.78, 30.33]);
    expect(v.value.rules[2].itemRef).toBeUndefined();
    expect(v.warnings).toEqual([]);
  });

  it("drops unknown fields", () => {
    const v = validateWatchlist({ ...good, extra: 1, items: [{ kind: "gauge", id: "USGS-08180800", junk: true }] });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect("extra" in v.value).toBe(false);
    expect(v.value.items[0]).toEqual({ kind: "gauge", id: "USGS-08180800" });
  });

  it("names the failing field", () => {
    const v = validateWatchlist({ ...good, items: [{ kind: "planet", id: "x" }] });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.errors[0]).toMatch(/^items\[0\]\.kind/);
  });

  it("rejects a non-object, a bad id, an empty title and a bad date", () => {
    expect(validateWatchlist("nope").ok).toBe(false);
    const v = validateWatchlist({ ...good, id: "A", title: "", createdAt: "yesterday" });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.errors.join("\n")).toMatch(/id:/);
    expect(v.errors.join("\n")).toMatch(/title:/);
    expect(v.errors.join("\n")).toMatch(/createdAt:/);
  });

  it("rejects out-of-range itemRef, unknown op, non-finite value, bad window, zero pct", () => {
    const v = validateWatchlist({
      ...good,
      rules: [
        { itemRef: 9, metric: "x", op: ">", value: 1 },
        { metric: "x", op: "~", value: 1 },
        { metric: "x", op: ">", value: "1" },
        { metric: "x", op: ">", value: 1, window: "2d" },
        { metric: "x", op: "changes_by_pct", value: 0 },
        { metric: "bad metric!", op: ">", value: 1 },
      ],
    });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.errors).toHaveLength(6);
    expect(v.errors.map((e) => e.split(":")[0])).toEqual(["rules[0].itemRef", "rules[1].op", "rules[2].value", "rules[3].window", "rules[4].value", "rules[5].metric"]);
  });

  it("caps item and rule counts and geo ranges", () => {
    const many = validateWatchlist({ ...good, items: Array.from({ length: LIMITS.items + 1 }, (_, i) => ({ kind: "county", id: String(10000 + i) })) });
    expect(many.ok).toBe(false);
    const geo = validateWatchlist({ ...good, items: [{ kind: "county", id: "48453", geo: [200, 0] }] });
    expect(geo.ok).toBe(false);
    if (geo.ok) return;
    expect(geo.errors[0]).toMatch(/geo/);
  });

  it("warns about duplicates and missing rules", () => {
    const v = validateWatchlist({ ...good, items: [good.items[0], good.items[0]], rules: undefined });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.warnings.some((w) => w.includes("more than once"))).toBe(true);
    expect(v.warnings.some((w) => w.startsWith("rules"))).toBe(true);
  });
});

describe("compact form", () => {
  it("round-trips", () => {
    const c = toCompact(good);
    expect(c.i[2]).toEqual(["series", "snapshot:port-vessels:USLAX"]);
    expect(c.r[2]).toEqual(["*", "container.total", "crosses_above", 1e6]);
    const back = fromCompact(JSON.parse(JSON.stringify(c)));
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.value).toEqual({ ...good, rules: [good.rules[0], good.rules[1], { ...good.rules[2], itemRef: "*" }] });
  });

  it("rejects an unknown version", () => {
    expect(fromCompact({ v: 2 }).ok).toBe(false);
  });
});

describe("base64url", () => {
  it("round-trips arbitrary bytes without padding", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255, 63, 62]);
    const s = base64urlEncode(bytes);
    expect(s).not.toMatch(/[+/=]/);
    expect(base64urlDecode(s)).toEqual(bytes);
  });
  it("refuses non-base64url input", () => {
    expect(() => base64urlDecode("ab+c")).toThrow(/base64url/);
  });
});

describe("token (Node zlib path)", () => {
  it("round-trips synchronously", () => {
    const t = encodeTokenSync(good);
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(t.length).toBeLessThan(400);
    expect(decodeTokenSync(t)).toEqual({ ...good, rules: [good.rules[0], good.rules[1], { ...good.rules[2], itemRef: "*" }] });
  });

  it("fails clearly on garbage, empty and oversized tokens", () => {
    expect(() => decodeTokenSync("")).toThrow(/token: empty/);
    expect(() => decodeTokenSync("not*base64")).toThrow(/base64url/);
    expect(() => decodeTokenSync("AAAA")).toThrow(/token:/);
    expect(() => decodeTokenSync("a".repeat(LIMITS.tokenChars + 1))).toThrow(/longer than/);
  });

  it("refuses a token that inflates past the cap (zip bomb)", async () => {
    const huge: Watchlist = { ...good, items: [], rules: [], title: "x".repeat(100) };
    // Hand-build a compact payload that is tiny deflated but large inflated.
    const json = JSON.stringify({ v: 1, id: "bomb", t: "x".repeat(LIMITS.inflatedBytes + 10), i: [], r: [], c: huge.createdAt, n: 1 });
    const bytes = await nodeCodec.deflate(new TextEncoder().encode(json));
    const token = base64urlEncode(bytes);
    expect(token.length).toBeLessThan(LIMITS.tokenChars);
    expect(() => decodeTokenSync(token)).toThrow(/token:/);
  });

  it("enforces the 8 KB token cap on encode", () => {
    // Random text does not compress: 50 items x (64 + 120 chars) + 100 rules x 64 chars is ~17 KB raw.
    const rnd = (n: number) => Array.from({ length: Math.ceil(n / 12) }, () => newId()).join("").slice(0, n);
    const big: Watchlist = {
      ...good,
      items: Array.from({ length: 50 }, () => ({ kind: "series" as const, id: rnd(64), name: rnd(120) })),
      rules: Array.from({ length: 100 }, (_, i) => ({ itemRef: i % 50, metric: "m" + rnd(63), op: ">" as const, value: Math.random() * 1e6, window: "7d" as const })),
    };
    expect(() => encodeTokenSync(big)).toThrow(/exceeds/);
  });
});

describe("token (isomorphic path)", () => {
  it("round-trips through CompressionStream", async () => {
    const t = await encodeToken(good, streamCodec);
    expect(await decodeToken(t, streamCodec)).toEqual(decodeTokenSync(t));
  });

  it("stream and zlib tokens decode each other", async () => {
    const a = await encodeToken(good, streamCodec);
    const b = encodeTokenSync(good);
    expect(await decodeToken(b, streamCodec)).toEqual(decodeTokenSync(a));
  });

  it("rejects corrupt input through the stream path", async () => {
    await expect(decodeToken("AAAAAAAA", streamCodec)).rejects.toThrow(/token:/);
  });

  it("stops inflating past the cap through the stream path", async () => {
    const json = JSON.stringify({ v: 1, id: "bomb", t: "y".repeat(LIMITS.inflatedBytes * 4), i: [], r: [], c: good.createdAt, n: 1 });
    const token = base64urlEncode(await streamCodec.deflate(new TextEncoder().encode(json)));
    await expect(decodeToken(token, streamCodec)).rejects.toThrow(/inflates past/);
  });
});

describe("helpers", () => {
  it("newWatchlist has a valid id and empty lists", () => {
    const w = newWatchlist("x");
    expect(validateWatchlist(w).ok).toBe(true);
    expect(w.items).toEqual([]);
    expect(newId()).toMatch(/^[a-z2-7]{12}$/);
  });
  it("windowMs", () => {
    expect(windowMs("1d")).toBe(86_400_000);
    expect(windowMs("30d")).toBe(30 * 86_400_000);
    expect(windowMs(undefined)).toBe(7 * 86_400_000);
  });
});
