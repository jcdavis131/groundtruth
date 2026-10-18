// /api/parcels with every upstream answered from payloads captured on
// 2026-09-26 (lib/parcels/fixtures): the county from TIGERweb, the parcel
// from HCAD, the NAD points. No network. Checks the envelope, that no name
// parameter is accepted, that outlines carry no owner, and what is asked of
// the county server (explicit fields, a point, never "*").
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ADAPTER_BY_ID } from "@/lib/parcels/adapters";

/** Set by the one test that needs the real cache (deadlines, in-flight sharing, cool-downs). */
const cacheMode = vi.hoisted(() => ({ real: false }));

vi.mock("@/lib/server/cache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/cache")>();
  return {
    ...actual,
    // No memo in tests: every GET asks its upstreams again, unless a test switches the real cache on.
    cached: async <T,>(k: string, ttl: number, produce: () => Promise<T>, opts?: import("@/lib/server/cache").CachedOptions) =>
      cacheMode.real ? actual.cached(k, ttl, produce, opts) : { value: await produce(), age: 0, hit: false },
  };
});

vi.mock("@/lib/server/upstream", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/upstream")>()),
  // No politeness waits between test requests.
  polite: <T,>(_n: string, _i: number, _b: number, fn: () => Promise<T>) => fn(),
}));

import { GET } from "./route";

const load = (name: string) => JSON.parse(readFileSync(path.join(__dirname, "..", "..", "..", "lib", "parcels", "fixtures", name), "utf8"));
const hcad = load("tx-hcad.json");
const alamo = load("tx-stratmap-bexar.json");
/** TxGIO answers identify in Esri JSON: the captured Alamo row put back in that shape. */
const identifyJson = (rows: Array<{ geometry: { coordinates: number[][][] }; properties: unknown }>) => ({
  results: rows.map((r) => ({ layerId: 0, layerName: "StratMap Land Parcels", attributes: r.properties, geometryType: "esriGeometryPolygon", geometry: { rings: r.geometry.coordinates } })),
});
const nad = load("nad-alamo.json");

/** A captured fixture back in the f=geojson shape the service sent. */
const fc = (rows: Array<{ geometry: unknown; properties: unknown }>) => ({ type: "FeatureCollection", features: rows.map((r) => ({ type: "Feature", geometry: r.geometry, properties: r.properties })) });

const countyFc = (c: { geoid: string; name: string; basename: string; state: string }) => fc([{ geometry: null, properties: { GEOID: c.geoid, NAME: c.name, BASENAME: c.basename, STATE: c.state } }]);

let county = hcad.county;
const asked: URL[] = [];

beforeEach(() => {
  county = hcad.county;
  asked.length = 0;
  cacheMode.real = false;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(String(input));
    asked.push(url);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    if (url.host === "tigerweb.geo.census.gov") return json(countyFc(county));
    if (url.host === "www.gis.hctx.net") return json(fc(hcad.rows));
    if (url.host === "feature.geographic.texas.gov") return json(identifyJson(alamo.rows));
    if (url.host === "services.arcgis.com") return json(fc(nad.rows));
    return new Response("unexpected upstream in test", { status: 500 });
  });
});
afterEach(() => vi.restoreAllMocks());

async function get(qs: string) {
  const res = await GET(new NextRequest(`http://localhost/api/parcels${qs}`));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> & { data: never; provenance: Array<{ source: { id: string } }>; caveats?: string[] } };
}

describe("/api/parcels identify", () => {
  it("answers the parcel at a point with its record, provenance per upstream and the caveats", async () => {
    const { status, body } = await get("?lon=-95.3693&lat=29.7604");
    expect(status).toBe(200);
    const data = body.data as unknown as { adapter: { id: string }; county: { geoid: string }; parcels: Array<{ record: { owner: { names: string[] }; parcelId: string }; geometry: { type: string } }>; addresses: unknown[] };
    expect(data.county.geoid).toBe("48201");
    expect(data.adapter.id).toBe("tx-hcad");
    expect(data.parcels[0].record.parcelId).toBe("0011490000001");
    expect(data.parcels[0].record.owner.names).toEqual(["CITY OF HOUSTON"]);
    expect(data.parcels[0].geometry.type).toBe("Polygon");
    // Texas is not a PLSS state: BLM is not asked.
    expect("plss" in (body.data as object)).toBe(false);
    expect(asked.some((u) => u.host === "gis.blm.gov")).toBe(false);
    expect(body.provenance.map((p) => p.source.id)).toEqual(expect.arrayContaining(["census-tigerweb", "hcad-parcels"]));
    expect(body.caveats?.join(" ")).toMatch(/never a name/);
    expect(body.mode).toBe("identify");
  });

  it("asks the county server at a point, for its explicit fields, never '*'", async () => {
    await get("?lon=-95.3693&lat=29.7604");
    const q = asked.find((u) => u.host === "www.gis.hctx.net")!;
    expect(q.searchParams.get("geometry")).toBe("-95.3693,29.7604");
    expect(q.searchParams.get("outFields")).toBe(ADAPTER_BY_ID.get("tx-hcad")!.outFields.join(","));
    expect(q.searchParams.get("where")).toBe("1=1");
    for (const u of asked) expect(u.searchParams.get("outFields") ?? "").not.toBe("*");
  });

  it("says so where no keyless parcel service is wired, instead of an empty success", async () => {
    county = { geoid: "47037", name: "Davidson County", basename: "Davidson", state: "47" };
    const { status, body } = await get("?lon=-86.78&lat=36.16");
    expect(status).toBe(200);
    const data = body.data as unknown as { adapter: null; parcels: unknown[]; notes: string[] };
    expect(data.adapter).toBeNull();
    expect(data.parcels).toEqual([]);
    expect(data.notes.join(" ")).toMatch(/No keyless public parcel service is wired for Davidson County/);
  });

  it("refuses any name or search parameter, before asking anyone", async () => {
    for (const k of ["owner", "name", "q", "where", "search", "query"]) {
      const { status, body } = await get(`?lon=-95.3693&lat=29.7604&${k}=CITY%20OF%20HOUSTON`);
      expect(status).toBe(400);
      expect(String(body.error)).toMatch(/never a name/);
    }
    expect(asked).toEqual([]);
  });

  it("wants a real point and a known mode", async () => {
    expect((await get("?lon=&lat=29")).status).toBe(400);
    expect((await get("?lon=-95&lat=91")).status).toBe(400);
    expect((await get("?mode=owners&lon=-95&lat=29")).status).toBe(400);
  });
});

describe("/api/parcels through TxGIO's identify, and the addresses mode", () => {
  it("reads the Alamo's record through identify, and the NAD point on the parcel", async () => {
    county = alamo.county;
    const { status, body } = await get("?lon=-98.4861&lat=29.426");
    expect(status).toBe(200);
    const data = body.data as unknown as { adapter: { id: string }; parcels: Array<{ record: { parcelId: string; owner: { names: string[] } } }>; addresses: Array<{ address: string; onParcel: boolean }> };
    expect(data.adapter.id).toBe("tx-stratmap");
    expect(data.parcels[0].record.parcelId).toBe("101328");
    expect(data.parcels[0].record.owner.names).toEqual(["STATE OF TEXAS"]);
    expect(data.addresses[0]).toMatchObject({ address: "300 ALAMO PLAZA, SAN ANTONIO, TX", onParcel: true });
    const q = asked.find((u) => u.host === "feature.geographic.texas.gov")!;
    expect(q.pathname).toMatch(/\/identify$/);
    expect(q.searchParams.get("geometry")).toBe("-98.4861,29.426");
    expect(body.caveats?.join(" ")).toMatch(/StratMap is TxGIO's statewide composite/);
    expect(body.caveats?.join(" ")).toMatch(/not intended for use as a mailing list/);
  });

  it("mode=addresses answers NAD points on the parcel at the point", async () => {
    county = alamo.county;
    const { status, body } = await get("?mode=addresses&lon=-98.4861&lat=29.426");
    expect(status).toBe(200);
    const data = body.data as unknown as { parcelOutline: boolean; addresses: Array<{ address: string }> };
    expect(data.parcelOutline).toBe(true);
    expect(data.addresses.map((a) => a.address)).toContain("300 ALAMO PLAZA, SAN ANTONIO, TX");
    expect(body.provenance.map((p) => p.source.id)).toEqual(["usdot-nad"]);
  });

  it(
    "when NAD is slower than identify waits, mode=addresses straight after waits on the same query and answers (real cache)",
    async () => {
      cacheMode.real = true;
      county = alamo.county;
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
      vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
        const url = new URL(String(input));
        asked.push(url);
        if (url.host === "tigerweb.geo.census.gov") return json(countyFc(county));
        if (url.host === "feature.geographic.texas.gov") return json(identifyJson(alamo.rows));
        // NAD answers after identify's 2.5 s wait has run out.
        if (url.host === "services.arcgis.com") return new Promise<Response>((r) => setTimeout(() => r(json(fc(nad.rows))), 2_900));
        return new Response("unexpected upstream in test", { status: 500 });
      });
      // A point no other test uses, so nothing in the real cache is shared with them.
      const first = await get("?lon=-98.48611&lat=29.42601");
      expect(first.status).toBe(200);
      expect((first.body.data as unknown as { addresses: unknown }).addresses).toBeNull();
      expect(first.body.caveats?.join(" ")).toMatch(/did not answer within 2\.5 s; mode=addresses asks again/);
      // The dossier's follow-up, at once: it waits on the query still running rather than failing on the cool-down.
      const second = await get("?mode=addresses&lon=-98.48611&lat=29.42601");
      expect(second.status).toBe(200);
      expect((second.body.data as unknown as { addresses: Array<{ address: string }> }).addresses.map((a) => a.address)).toContain("300 ALAMO PLAZA, SAN ANTONIO, TX");
      // One NAD query served both.
      expect(asked.filter((u) => u.host === "services.arcgis.com").length).toBe(1);
    },
    15_000,
  );
});

describe("/api/parcels outlines", () => {
  it("returns lot lines with the parcel id and use class only", async () => {
    const { status, body } = await get("?mode=outlines&bbox=-95.3715,29.7585,-95.3665,29.7625");
    expect(status).toBe(200);
    const s = JSON.stringify(body);
    expect(s).not.toContain("CITY OF HOUSTON");
    expect(s).not.toContain("PO BOX");
    const features = (body.data as unknown as { features: Array<{ properties: { id: string; details: Record<string, unknown> } }> }).features;
    expect(features.map((f) => f.properties.id)).toEqual(["parcel:tx-hcad:0011490000001"]);
    // The outline query asks for the id and use fields only.
    const q = asked.find((u) => u.host === "www.gis.hctx.net")!;
    expect(q.searchParams.get("outFields")).toBe("HCAD_NUM,state_class");
    // The box is snapped to the 0.002 degree grid and returned.
    expect(body.bbox).toEqual([-95.372, 29.758, -95.366, 29.764]);
  });

  it("keeps a box under the response budget, and says so (derived: the City Hall outline repeated 12,000 times under new ids)", async () => {
    const many = Array.from({ length: 12_000 }, (_, i) => ({ geometry: hcad.rows[0].geometry, properties: { HCAD_NUM: String(i).padStart(13, "0"), state_class: "X1" } }));
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = new URL(String(input));
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
      if (url.host === "tigerweb.geo.census.gov") return json(countyFc(county));
      return json(fc(many));
    });
    const res = await GET(new NextRequest("http://localhost/api/parcels?mode=outlines&bbox=-95.3715,29.7585,-95.3665,29.7625"));
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text.length).toBeLessThan(4_500_000);
    const body = JSON.parse(text) as { data: { features: unknown[] }; cutForSize: boolean; truncated: boolean; caveats: string[] };
    expect(body.cutForSize).toBe(true);
    expect(body.truncated).toBe(true);
    expect(body.data.features.length).toBeLessThan(12_000);
    expect(body.caveats.join(" ")).toMatch(/response limit/);
  });

  it("draws a lot once where two adapters meet: StratMap's Harris rows are left to HCAD (derived: the Alamo row copied under Houston City Hall's id and Harris's FIPS)", async () => {
    const harrisInStratmap = { ...alamo.rows[0], properties: { ...alamo.rows[0].properties, PROP_ID: "0011490000001", FIPS: "48201", COUNTY: "HARRIS" } };
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = new URL(String(input));
      asked.push(url);
      if (url.host === "tigerweb.geo.census.gov") {
        // The box touches Harris and a StratMap county.
        return json(fc([...countyFc(hcad.county).features, ...countyFc(alamo.county).features].map((f) => ({ geometry: null, properties: f.properties }))));
      }
      if (url.host === "www.gis.hctx.net") return json(fc(hcad.rows));
      if (url.host === "feature.geographic.texas.gov") return json(identifyJson([alamo.rows[0], harrisInStratmap]));
      return new Response("unexpected upstream in test", { status: 500 });
    });
    const { status, body } = await get("?mode=outlines&bbox=-95.3715,29.7585,-95.3665,29.7625");
    expect(status).toBe(200);
    const ids = (body.data as unknown as { features: Array<{ properties: { extra: { adapter: string; parcelId: string } } }> }).features.map((f) => f.properties.extra);
    // Both services were asked, and every parcel id comes from one adapter only.
    expect(new Set(ids.map((x) => x.adapter))).toEqual(new Set(["tx-hcad", "tx-stratmap"]));
    const byId = new Map<string, Set<string>>();
    for (const x of ids) byId.set(x.parcelId, new Set([...(byId.get(x.parcelId) ?? []), x.adapter]));
    for (const [id, adapters] of byId) expect(adapters.size, `parcel ${id}`).toBe(1);
    expect(byId.get("0011490000001")).toEqual(new Set(["tx-hcad"]));
    const sources = body.sources as Array<{ id: string; count: number }>;
    expect(sources.find((s) => s.id === "tx-stratmap")?.count).toBe(1);
    expect(sources.find((s) => s.id === "tx-hcad")?.count).toBe(1);
  });

  it("clamps a wide box to 0.01 degrees", async () => {
    const { body } = await get("?mode=outlines&bbox=-95.5,29.6,-95.2,29.9");
    const [w, s, e, n] = body.bbox as number[];
    expect(e - w).toBeLessThanOrEqual(0.0141);
    expect(n - s).toBeLessThanOrEqual(0.0141);
  });
});
