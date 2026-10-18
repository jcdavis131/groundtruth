import { describe, expect, it } from "vitest";
import { MANIFEST } from "./registry";
import {
  parseComparePair,
  parseCountyParam,
  parseMetroParam,
  parseStateParam,
  scopeBriefPath,
  scopeCentroid,
  scopeId,
  scopeLensBriefPath,
  scopeName,
  scopePath,
  scopeShortName,
  type PlaceScope,
} from "./scope";

// lib/series/collect.ts SERIES_ID_RE, copied rather than imported so a change
// there shows up here as a failure instead of silently redefining the contract.
const SERIES_ID_RE = /^[a-z0-9][a-zA-Z0-9:_.\-]{2,120}$/;

describe("parseCountyParam", () => {
  it("accepts a five-digit FIPS the manifest knows", () => {
    const s = parseCountyParam("48453");
    expect(s?.kind).toBe("county");
    expect(s?.id).toBe("48453");
    expect(s?.kind === "county" && s.provisional).toBe(false);
    expect(s?.kind === "county" && s.ref?.name).toBe("Travis County");
  });

  it("rejects anything that is not a five-digit county code", () => {
    for (const bad of ["4845", "484533", "48453x", "", " 48453", "48-453"]) expect(parseCountyParam(bad), bad).toBeNull();
    expect(parseCountyParam(undefined)).toBeNull();
    expect(parseCountyParam(null)).toBeNull();
    expect(parseCountyParam(["48", "453"])).toBeNull();
    expect(parseCountyParam(48453)).toBeNull();
  });

  it("rejects the SSCCC state form", () => {
    for (const bad of ["48000", "06000", "00000"]) expect(parseCountyParam(bad), bad).toBeNull();
  });

  it("rejects a code whose state prefix is not a state", () => {
    expect(parseCountyParam("99001")).toBeNull();
    expect(parseCountyParam("03001")).toBeNull();
  });

  it("is exact once the manifest is complete: a real county resolves, an unknown code 404s", () => {
    expect(MANIFEST.countiesComplete).toBe(true);
    const anderson = parseCountyParam("48001");
    expect(anderson?.kind === "county" && anderson.provisional).toBe(false);
    expect(anderson?.kind === "county" && anderson.ref?.name).toBe("Anderson County");
    // Structurally valid with a known state prefix, and no such county.
    expect(parseCountyParam("48999")).toBeNull();
    // Connecticut is its nine planning regions; the eight old counties are gone.
    expect(parseCountyParam("09190")?.kind === "county" && parseCountyParam("09190")?.id).toBe("09190");
    expect(parseCountyParam("09001")).toBeNull();
    // Puerto Rico municipios are county equivalents.
    expect(parseCountyParam("72127")?.kind === "county" && scopeName(parseCountyParam("72127")!)).toBe("San Juan Municipio, PR");
  });

  it("names a provisional scope by its FIPS and gives it no centroid", () => {
    // The provisional branch only fires while counties.json is incomplete; a
    // hand-built scope keeps scopeName and scopeCentroid honest for it.
    const s: PlaceScope = { kind: "county", id: "48999", ref: null, provisional: true };
    expect(scopeCentroid(s)).toBeNull();
    expect(scopeName(s)).toBe("FIPS 48999, TX");
    expect(scopeShortName(s)).toBe("FIPS 48999");
  });
});

describe("parseMetroParam", () => {
  it("accepts a published CBSA and nothing else", () => {
    const s = parseMetroParam("41700");
    expect(s?.kind).toBe("metro");
    expect(s?.kind === "metro" && s.ref.name).toContain("San Antonio");
    expect(parseMetroParam("99999")).toBeNull();
    expect(parseMetroParam("4170")).toBeNull();
    expect(parseMetroParam(undefined)).toBeNull();
  });
});

describe("parseStateParam", () => {
  it("canonicalises to upper case", () => {
    const s = parseStateParam("tx");
    expect(s?.kind).toBe("state");
    expect(s?.id).toBe("TX");
    expect(s?.kind === "state" && s.ref.name).toBe("Texas");
    expect(scopePath(s!)).toBe("/state/TX");
  });

  it("rejects a non-state", () => {
    for (const bad of ["ZZ", "T", "TXX", "4", ""]) expect(parseStateParam(bad), bad).toBeNull();
    expect(parseStateParam(["T", "X"])).toBeNull();
  });
});

describe("scope identity and paths", () => {
  const county = parseCountyParam("48453")!;
  const metro = parseMetroParam("41700")!;
  const state = parseStateParam("TX")!;

  it("produces ids that are legal series ids", () => {
    expect(scopeId(county)).toBe("county:48453");
    expect(scopeId(metro)).toBe("metro:41700");
    expect(scopeId(state)).toBe("state:TX");
    for (const s of [county, metro, state]) expect(SERIES_ID_RE.test(scopeId(s)), scopeId(s)).toBe(true);
  });

  it("builds the three path families", () => {
    expect(scopePath(county)).toBe("/place/48453");
    expect(scopePath(metro)).toBe("/metro/41700");
    expect(scopePath(state)).toBe("/state/TX");
    expect(scopeBriefPath(county)).toBe("/place/48453/brief");
    expect(scopeLensBriefPath(metro, "housing")).toBe("/metro/41700/brief/housing");
  });

  it("round-trips a path back through the parser", () => {
    const back = [
      [scopePath(county), parseCountyParam],
      [scopeBriefPath(county), parseCountyParam],
      [scopePath(metro), parseMetroParam],
      [scopeBriefPath(metro), parseMetroParam],
      [scopePath(state), parseStateParam],
      [scopeBriefPath(state), parseStateParam],
    ] as const;
    for (const [path, parse] of back) {
      const segment = path.split("/")[2];
      const again = parse(segment);
      expect(again, path).not.toBeNull();
      expect(scopePath(again!)).toBe(path.replace(/\/brief$/, ""));
    }
  });

  it("names and places each scope", () => {
    expect(scopeName(county)).toBe("Travis County, TX");
    expect(scopeShortName(county)).toBe("Travis County");
    expect(scopeName(state)).toBe("Texas");
    expect(scopeShortName(metro)).toBe("San Antonio, TX");
    // The Census internal point (INTPTLON/INTPTLAT) to four decimals.
    expect(scopeCentroid(county)).toEqual({ lon: -97.6913, lat: 30.2395 });
    expect(scopeCentroid(state)?.lon).toBeLessThan(0);
  });
});

describe("parseComparePair", () => {
  it("parses the bare county form", () => {
    const pair = parseComparePair("48453-vs-06037");
    expect(pair).not.toBeNull();
    expect(pair?.map(scopeId)).toEqual(["county:48453", "county:06037"]);
  });

  it("parses the prefixed form", () => {
    const pair = parseComparePair("metro.41700-vs-metro.19100");
    expect(pair?.map(scopeId)).toEqual(["metro:41700", "metro:19100"]);
    expect(parseComparePair("state.tx-vs-state.ca")?.map(scopeId)).toEqual(["state:TX", "state:CA"]);
    expect(parseComparePair("county.48453-vs-state.TX")?.map(scopeId)).toEqual(["county:48453", "state:TX"]);
  });

  it("still reads the colon form, which scopeId writes and links must not", () => {
    // A colon inside a path segment never reaches the page — the router 404s
    // first — so parsing keeps accepting it for hand-built and stored ids while
    // lib/places/links.ts emits only the dot form. See the sideToken test.
    expect(parseComparePair("metro:41700-vs-metro:19100")?.map(scopeId)).toEqual(["metro:41700", "metro:19100"]);
    expect(parseComparePair("metro.41700-vs-metro:19100")?.map(scopeId)).toEqual(["metro:41700", "metro:19100"]);
  });

  it("refuses a self-pair, a bad side and a malformed pair", () => {
    expect(parseComparePair("48453-vs-48453")).toBeNull();
    expect(parseComparePair("state.tx-vs-state.TX")).toBeNull();
    expect(parseComparePair("48453-vs-99999")).toBeNull();
    expect(parseComparePair("metro.99999-vs-metro.41700")).toBeNull();
    expect(parseComparePair("48453")).toBeNull();
    expect(parseComparePair("48453-vs-06037-vs-36061")).toBeNull();
    expect(parseComparePair("port.1401-vs-48453")).toBeNull();
    expect(parseComparePair(undefined)).toBeNull();
  });
});
