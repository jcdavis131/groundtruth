// The pure parts of the network module, on captured payloads, and the one
// network call whose URL shape is a privacy rule (Cook's PIN-only read).
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Polygon } from "geojson";
import { cookAddressRow, nadAddresses, NAD_NEAR_M, parsePlss, PLSS_STATES, tcadLinkFor } from "./sources";
import { STATE_ADAPTERS } from "./adapters";

const load = (name: string) => JSON.parse(readFileSync(path.join(__dirname, "fixtures", name), "utf8"));

describe("NAD address points", () => {
  const nad = load("nad-alamo.json");
  const alamo = load("tx-stratmap-bexar.json").rows[0].geometry as Polygon;
  const point: [number, number] = [-98.4861, 29.426];

  it("keeps the points on the parcel (the Alamo's own address), nearest first", () => {
    const list = nadAddresses(nad.rows, point, alamo);
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((a) => a.onParcel)).toBe(true);
    expect(list[0].address).toBe("300 ALAMO PLAZA, SAN ANTONIO, TX");
    expect(list[0].source).toBe("State of Texas");
    expect(list[0].updated).toBe("2025-04-25");
    // "Unknown" is NAD's word for no type: not shown as a type.
    expect(list[0].type).toBeUndefined();
  });

  it("with no parcel, only points within 40 m of the click, marked as near", () => {
    const list = nadAddresses(nad.rows, point, null);
    expect(NAD_NEAR_M).toBe(40);
    expect(list.every((a) => !a.onParcel)).toBe(true);
    for (const a of list) {
      const dx = (a.lon - point[0]) * 111_320 * Math.cos((point[1] * Math.PI) / 180);
      const dy = (a.lat - point[1]) * 110_574;
      expect(Math.hypot(dx, dy)).toBeLessThan(45);
    }
  });

  it("drops rows with no geometry or no street", () => {
    expect(nadAddresses([{ geometry: null, properties: { AddNo_Full: "1" } }, { geometry: { type: "Point", coordinates: point }, properties: {} }], point, null)).toEqual([]);
  });
});

describe("BLM PLSS", () => {
  it("township and section from the two layer answers at the Montana Capitol", () => {
    const p = load("plss-helena.json");
    expect(parsePlss(p.township[0], p.section[0])).toEqual({
      state: "MT",
      meridian: "Montana Meridian",
      township: "10N 3W",
      plssId: "MT200100N0030W0",
      section: "32",
      sectionType: "Section",
      firstDivisionId: "MT200100N0030W0SN320",
    });
    expect(parsePlss(null, null)).toBeNull();
  });

  it("is asked only in the 30 public-land states (not Texas, New Jersey or New York)", () => {
    expect(PLSS_STATES.size).toBe(30);
    for (const s of ["30", "55", "12", "49"]) expect(PLSS_STATES.has(s)).toBe(true);
    for (const s of ["48", "34", "36", "25", "09", "50", "24", "37"]) expect(PLSS_STATES.has(s)).toBe(false);
    // Every wired state is one or the other on purpose.
    expect(Object.keys(STATE_ADAPTERS).length).toBeGreaterThan(10);
  });
});

describe("Travis County record link", () => {
  it("matches StratMap's PROP_ID to TCAD's geo_id and keeps TCAD's published link", () => {
    const t = load("tcad-capitol.json");
    expect(tcadLinkFor(t.rows, "0208030201")).toBe("https://stage.travis.prodigycad.com/property-detail/197003");
    // A different parcel at the point gets no link.
    expect(tcadLinkFor(t.rows, "0208030202")).toBeUndefined();
  });
});

describe("Cook County's parcel-address read", () => {
  afterEach(() => vi.restoreAllMocks());

  it("asks by PIN only: no name column, no $where, no $q", async () => {
    const row = load("il-cook.json").extra;
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify([row]), { status: 200, headers: { "content-type": "application/json" } }));
    const got = await cookAddressRow("17094470040000");
    expect(got).toEqual(row);
    const url = new URL(String(spy.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe("https://datacatalog.cookcountyil.gov/resource/3723-97qp.json");
    expect([...url.searchParams.keys()].sort()).toEqual(["$limit", "$order", "$select", "pin"]);
    expect(url.searchParams.get("pin")).toBe("17094470040000");
  });

  it("refuses anything that is not a 14-digit PIN, without a request", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    expect(await cookAddressRow("SMITH")).toBeNull();
    expect(await cookAddressRow("17094470040000' OR 1=1")).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("outline payloads carry no owner", () => {
  it.each(["tx-stratmap-outlines.json", "mn-parcels-outlines.json"])("%s", (name) => {
    const fx = load(name);
    expect(fx.features.length).toBeGreaterThan(10);
    for (const f of fx.features) {
      expect(Object.keys(f.properties.details).sort()).toEqual(["parcel id", "use", "what this is"].filter((k) => k !== "use" || f.properties.details.use !== undefined).sort());
      expect(f.properties.name).toBe(`Parcel ${f.properties.extra.parcelId}`);
    }
    const s = JSON.stringify(fx);
    for (const word of ["OWNER", "owner_name", "MAIL", "mail", "STATE OF TEXAS", "County of Hennepin"]) expect(s).not.toContain(word);
  });
});
