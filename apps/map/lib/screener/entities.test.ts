import { describe, expect, it } from "vitest";
import type { AreaExtra } from "@/lib/economy/features";
import { buildAreaPoints, screenProvenance } from "./entities";
import { COUNTY_POINTS, countyJoins } from "./fixtures";

describe("buildAreaPoints", () => {
  it("makes one point feature per area with a join, same ids and extra as the polygon builder", () => {
    const feats = buildAreaPoints(COUNTY_POINTS, "county", countyJoins());
    expect(feats.map((f) => f.properties.id)).toEqual(["county:48453", "county:48029", "county:06037", "county:36061", "county:38053"]);
    const travis = feats[0];
    expect(travis.geometry).toEqual({ type: "Point", coordinates: [-97.78, 30.33, 0] });
    expect(travis.properties.anchor).toEqual([-97.78, 30.33]);
    expect(travis.properties.kind).toBe("county");
    expect(travis.properties.layer).toBe("realestate");
    expect(travis.properties.name).toBe("Travis County, TX");
    const x = travis.properties.extra as AreaExtra;
    expect(x).toMatchObject({ geoid: "48453", level: "county", name: "Travis County", stusab: "TX", stateName: "Texas", metro: "Austin-Round Rock-San Marcos, TX" });
    expect(x.home?.latest).toBe(520_000);
    expect(x.rent?.latest).toBe(1_700);
    expect(x.jobs?.emp).toBe(800_000);
  });

  it("drops areas with neither jobs nor a home value, keeps ones with only one", () => {
    const feats = buildAreaPoints(COUNTY_POINTS, "county", countyJoins());
    expect(feats.find((f) => f.properties.id === "county:02013")).toBeUndefined();
    const mck = feats.find((f) => f.properties.id === "county:38053")!;
    expect((mck.properties.extra as AreaExtra).rent).toBeUndefined();
    expect((mck.properties.extra as AreaExtra).jobs?.suppressed).toBe(true);
  });

  it("names states by their own name and uses it as stateName", () => {
    const feats = buildAreaPoints([{ geoid: "48", name: "Texas", stusab: "TX", lon: -99, lat: 31 }], "state", { jobs: new Map(), home: new Map([["48", { id: "Texas", name: "Texas", sizeRank: 1, asOf: "2026-07-31", latest: 1, yoyPct: null, y5Pct: null, monthly: [], yearly: [] }]]), rent: new Map() });
    expect(feats[0].properties.name).toBe("Texas");
    expect(feats[0].properties.id).toBe("state:48");
    expect((feats[0].properties.extra as AreaExtra).stateName).toBe("Texas");
  });

  it("leaves the USPS code off the name when unknown", () => {
    const feats = buildAreaPoints([{ geoid: "48453", name: "Travis County", lon: -97.78, lat: 30.33 }], "county", countyJoins());
    expect(feats[0].properties.name).toBe("Travis County");
  });
});

describe("screenProvenance", () => {
  it("lists each published source once with its period, and each estimate with its method", () => {
    const p = screenProvenance("county", { retrievedAt: "2026-09-11T10:00:00Z", periods: { "bls-qcew": "2026 Q1", "zillow-zhvi": "2026-07-31" } });
    const published = p.filter((x) => x.kind === "published");
    expect(published.map((x) => x.source.id)).toEqual(["census-tigerweb", "zillow-zhvi", "zillow-zori", "bls-qcew"]);
    expect(published.find((x) => x.source.id === "bls-qcew")?.period).toBe("2026 Q1");
    expect(published.find((x) => x.source.id === "zillow-zori")?.period).toBeUndefined();
    const estimates = p.filter((x) => x.kind === "estimate");
    expect(estimates.map((x) => x.method?.split(":")[0])).toEqual(["priceToRent", "momentum", "yearsOfWages"]);
    expect(p.every((x) => x.retrievedAt === "2026-09-11T10:00:00Z")).toBe(true);
  });

  it("notes a source that did not answer instead of dropping it", () => {
    const p = screenProvenance("port", { retrievedAt: "2026-09-11T10:00:00Z", failed: ["bts-ports"] });
    const bts = p.find((x) => x.source.id === "bts-ports")!;
    expect(bts.notes?.[0]).toContain("did not answer");
    expect(p.find((x) => x.source.id === "nga-wpi")!.notes).toBeUndefined();
  });
});
