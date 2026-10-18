import { describe, expect, it } from "vitest";
import { SOURCES } from "@/lib/provenance/sources";
import { ENTITY_KINDS, entityKindOf, featureGeo, fieldByKey, fieldMeta, fieldsFor, fieldTableMarkdown, isEntityKind } from "./fields";
import { countryFeatures, countyFeatures, crossingFeatures, portFeatures, stateFeatures } from "./fixtures";

const byId = <T extends { properties: { id: string } }>(feats: T[], id: string) => feats.find((f) => f.properties.id === id)!;

describe("registry shape", () => {
  it.each(ENTITY_KINDS)("%s: keys are unique, sources registered, estimates carry a method, name is first", (kind) => {
    const fields = fieldsFor(kind);
    expect(fields.length).toBeGreaterThan(5);
    expect(new Set(fields.map((f) => f.key)).size).toBe(fields.length);
    expect(fields[0].key).toBe("name");
    for (const f of fields) {
      expect(SOURCES[f.source]).toBeDefined();
      expect(f.key).toMatch(/^[A-Za-z_][A-Za-z0-9_.]*$/);
      if (f.kind === "estimate") expect(f.method).toBeTruthy();
      else expect(f.method).toBeUndefined();
      if (f.kind === "pct") expect(f.unit).toBe("%");
    }
    expect(fields.some((f) => f.headline)).toBe(true);
  });

  it("fieldMeta strips getters and keeps everything else", () => {
    const meta = fieldMeta("county");
    expect(meta.some((m) => "get" in m)).toBe(false);
    const momentum = meta.find((m) => m.key === "momentum")!;
    expect(momentum).toMatchObject({ kind: "estimate", headline: true });
    expect(momentum.method).toContain("Σ");
    expect(fieldByKey("port", "teu")?.unit).toBe("TEU");
    expect(fieldByKey("port", "nope")).toBeUndefined();
  });

  it("isEntityKind and entityKindOf", () => {
    expect(isEntityKind("county")).toBe(true);
    expect(isEntityKind("parcel")).toBe(false);
    expect(isEntityKind(3)).toBe(false);
    expect(entityKindOf(countyFeatures()[0])).toBe("county");
    expect(entityKindOf(stateFeatures()[0])).toBe("state");
    expect(entityKindOf(portFeatures()[0])).toBe("port");
    expect(entityKindOf(crossingFeatures()[0])).toBe("crossing");
    expect(entityKindOf(countryFeatures()[0])).toBe("country");
    const f = countyFeatures()[0];
    expect(entityKindOf({ ...f, properties: { ...f.properties, kind: "gauge" } })).toBeNull();
  });

  it("featureGeo prefers the anchor, falls back to a point, and is null for a bare polygon", () => {
    expect(featureGeo(countryFeatures()[0])).toEqual([10.4, 51.1]);
    expect(featureGeo(portFeatures()[0])).toEqual([-118.27, 33.73]);
    const c = countryFeatures()[0];
    expect(featureGeo({ ...c, properties: { ...c.properties, anchor: undefined } })).toBeNull();
  });

  it("renders a markdown table with one row per field", () => {
    const md = fieldTableMarkdown("crossing");
    expect(md.split("\n")).toHaveLength(fieldsFor("crossing").length + 2);
    expect(md).toContain("| `trucks` |");
  });
});

describe("county / state getters", () => {
  const feats = countyFeatures();
  const get = (id: string, key: string) => fieldByKey("county", key)!.get(byId(feats, id));

  it("reads published values and leaves gaps as null", () => {
    expect(get("county:48453", "home.latest")).toBe(520_000);
    expect(get("county:48453", "home.yoyPct")).toBe(-3.5);
    expect(get("county:48453", "home.y5Pct")).toBe(-14);
    expect(get("county:48453", "home.asOf")).toBe("2026-07-31");
    expect(get("county:48453", "rent.latest")).toBe(1_700);
    expect(get("county:48453", "jobs.emp")).toBe(800_000);
    expect(get("county:48453", "jobs.avgWeeklyWage")).toBe(1_600);
    expect(get("county:48453", "jobs.yoy.emp")).toBe(2.5);
    expect(get("county:48453", "jobs.yoy.avgWeeklyWage")).toBe(4);
    expect(get("county:48453", "jobs.wages")).toBe(800_000 * 1_600 * 13);
    expect(get("county:48453", "jobs.period")).toBe("2026 Q1");
    expect(get("county:48453", "jobs.suppressed")).toBe("false");
    expect(get("county:48453", "metro")).toBe("Austin-Round Rock-San Marcos, TX");
    expect(get("county:48453", "state")).toBe("TX");
    expect(get("county:48453", "geoid")).toBe("48453");
    expect(get("county:48453", "name")).toBe("Travis County");
    // Suppressed cell: every QCEW number is null, the flag says so.
    expect(get("county:38053", "jobs.emp")).toBeNull();
    expect(get("county:38053", "jobs.yoy.emp")).toBeNull();
    expect(get("county:38053", "jobs.suppressed")).toBe("true");
    expect(get("county:38053", "rent.latest")).toBeNull();
    expect(get("county:38053", "metro")).toBeNull();
    expect(get("county:06037", "metro")).toBeNull();
  });

  it("derives estimates only when every input is present", () => {
    expect(get("county:48453", "priceToRent")).toBeCloseTo(520_000 / (1_700 * 12), 6);
    expect(get("county:38053", "priceToRent")).toBeNull();
    expect(get("county:48453", "yearsOfWages")).toBeCloseTo(520_000 / (1_600 * 52), 6);
    expect(get("county:38053", "yearsOfWages")).toBeNull();
    // momentum: home −3.5/10 → −0.35 · 0.3; rent −2/10 → −0.2 · 0.15; jobs 2.5/3 → 0.833 · 0.3; wage 4/6 → 0.667 · 0.25
    const expected = (-0.35 * 0.3 + -0.2 * 0.15 + (2.5 / 3) * 0.3 + (4 / 6) * 0.25) / 1;
    expect(get("county:48453", "momentum")).toBeCloseTo(expected, 6);
    // McKenzie has only a home value: the index still exists over the terms present.
    expect(get("county:38053", "momentum")).toBeCloseTo(Math.min(1, 8 / 10), 6);
  });

  it("states share the registry and read the state name as the state", () => {
    const states = stateFeatures();
    const tx = byId(states, "state:48");
    expect(fieldByKey("state", "state")!.get(tx)).toBe("TX");
    expect(fieldByKey("state", "home.latest")!.get(tx)).toBe(300_000);
    expect(fieldByKey("state", "jobs.emp")!.get(tx)).toBe(14_000_000);
    expect(fieldByKey("state", "rent.latest")!.get(tx)).toBeNull();
    expect(tx.properties.name).toBe("Texas");
  });
});

describe("port getters", () => {
  const feats = portFeatures();
  const get = (id: string, key: string) => fieldByKey("port", key)!.get(byId(feats, id));
  it("reads WPI and BTS values, gaps where BTS has no row", () => {
    expect(get("port:1", "name")).toBe("Los Angeles");
    expect(get("port:1", "country")).toBe("United States");
    expect(get("port:1", "locode")).toBe("USLAX");
    expect(get("port:1", "size")).toBe("large");
    expect(get("port:1", "channelM")).toBe(16.2);
    expect(get("port:1", "maxDraftM")).toBeNull();
    expect(get("port:1", "teu")).toBe(9_600_000);
    expect(get("port:1", "teu.empty")).toBe(2_100_000);
    expect(get("port:1", "teu.rank")).toBe(1);
    expect(get("port:1", "teu.yoyPct")).toBe(-4.1);
    expect(get("port:1", "tons")).toBe(80_000_000);
    expect(get("port:1", "tons.yoyPct")).toBe(1.2);
    expect(get("port:1", "bts.year")).toBe(2024);
    expect(get("port:1", "bts.authority")).toBe("Port Authority");
    expect(get("port:1", "dryBulk")).toBeNull();
    expect(get("port:1", "teu.emptySharePct")).toBeCloseTo((2_100_000 / 9_600_000) * 100, 6);
    expect(get("port:3", "teu")).toBeNull();
    expect(get("port:3", "teu.emptySharePct")).toBeNull();
    expect(get("port:3", "bts.year")).toBeNull();
    expect(get("port:4", "size")).toBe("very small");
  });
});

describe("crossing getters", () => {
  const feats = crossingFeatures();
  const get = (id: string, key: string) => fieldByKey("crossing", key)!.get(byId(feats, id));
  it("reads each measure and the yoy; absent measures are null", () => {
    expect(get("crossing:2304", "name")).toBe("Laredo, TX");
    expect(get("crossing:2304", "state")).toBe("TX");
    expect(get("crossing:2304", "border")).toBe("US-Mexico Border");
    expect(get("crossing:2304", "code")).toBe("2304");
    expect(get("crossing:2304", "asOf")).toBe("2026-06");
    expect(get("crossing:2304", "trucks")).toBe(260_000);
    expect(get("crossing:2304", "trucks.yoyPct")).toBe(3.2);
    expect(get("crossing:2304", "trains")).toBe(700);
    expect(get("crossing:2304", "buses")).toBeNull();
    expect(get("crossing:2304", "cars")).toBe(500_000);
    expect(get("crossing:2304", "pedestrians")).toBe(150_000);
    expect(get("crossing:2304", "carPassengers")).toBe(900_000);
    expect(get("crossing:2304", "people")).toBe(900_000 + 150_000);
    expect(get("crossing:0712", "busPassengers")).toBe(9_000);
    expect(get("crossing:0712", "buses.yoyPct")).toBeNull();
    expect(get("crossing:0712", "people")).toBe(520_000 + 9_000);
    expect(get("crossing:2506", "trucks")).toBeNull();
  });
});

describe("country getters", () => {
  const feats = countryFeatures();
  const get = (id: string, key: string) => fieldByKey("country", key)!.get(byId(feats, id));
  it("reads World Bank values and Natural Earth attributes", () => {
    expect(get("country:DEU", "name")).toBe("Germany");
    expect(get("country:DEU", "iso3")).toBe("DEU");
    expect(get("country:DEU", "continent")).toBe("Europe");
    expect(get("country:DEU", "pop")).toBe(83_000_000);
    expect(get("country:DEU", "gdp")).toBe(4.5e12);
    expect(get("country:DEU", "gdp.year")).toBe("2024");
    expect(get("country:DEU", "exports")).toBe(2.0e12);
    expect(get("country:DEU", "imports")).toBe(1.8e12);
    expect(get("country:DEU", "tradePct")).toBe(84);
    expect(get("country:DEU", "teu")).toBe(1.5e7);
    expect(get("country:USA", "rank")).toBe(1);
    expect(get("country:DEU", "rank")).toBe(2);
    expect(get("country:ATA", "rank")).toBeNull();
    expect(get("country:ATA", "gdp")).toBeNull();
    // Natural Earth publishes 0 for Antarctica: a value, not a gap.
    expect(get("country:ATA", "pop")).toBe(0);
  });
  it("estimates: balance and share need matching years; per-capita needs a population", () => {
    expect(get("country:DEU", "balance")).toBe(2.0e12 - 1.8e12);
    expect(get("country:DEU", "balancePctGdp")).toBeCloseTo(((2.0e12 - 1.8e12) / 4.5e12) * 100, 9);
    expect(get("country:NLD", "balance")).toBeNull();
    expect(get("country:NLD", "balancePctGdp")).toBeNull();
    expect(get("country:DEU", "gdpPerCapita")).toBeCloseTo(4.5e12 / 83_000_000, 6);
    expect(get("country:ATA", "gdpPerCapita")).toBeNull();
  });
});
