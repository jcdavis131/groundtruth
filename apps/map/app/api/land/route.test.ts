// /api/land with fetch replaced by payloads captured from the publishers on
// 2026-10-12 (lib/land/fixtures): what each op asks the upstream for (named
// fields only, never an address), what it answers, and that a lookup that
// fails leaves values missing rather than guessed. No network.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import nwiWetlands from "@/lib/land/fixtures/nwi-wetlands-mitchell.json";
import nwiSource from "@/lib/land/fixtures/nwi-source-mitchell.json";
import nrhpPoints from "@/lib/land/fixtures/nrhp-points-dc.json";
import nrhpBoundaries from "@/lib/land/fixtures/nrhp-polygons-dc.json";
import chFinalBarton from "@/lib/land/fixtures/crithab-0-barton.json";
import chProposedBarton from "@/lib/land/fixtures/crithab-2-barton.json";
import chFinalPecos from "@/lib/land/fixtures/crithab-0-pecos.json";
import chProposedPecos from "@/lib/land/fixtures/crithab-2-pecos.json";
import nmfsAreaBarton from "@/lib/land/fixtures/nmfs-226-barton.json";
import nmfsLineBarton from "@/lib/land/fixtures/nmfs-2-barton.json";
import nmfsAreaPecos from "@/lib/land/fixtures/nmfs-226-pecos.json";
import nmfsLinePecos from "@/lib/land/fixtures/nmfs-2-pecos.json";
import nmfsAreaSeattle from "@/lib/land/fixtures/nmfs-226-seattle.json";
import nmfsLineSeattle from "@/lib/land/fixtures/nmfs-2-seattle.json";
import nmfsAreaSodo from "@/lib/land/fixtures/nmfs-226-sodo.json";
import nmfsLineSodo from "@/lib/land/fixtures/nmfs-2-sodo.json";
import rangesBarton from "@/lib/land/fixtures/ranges-3-barton.json";
import rangesPecos from "@/lib/land/fixtures/ranges-3-pecos.json";
import rangesAustin from "@/lib/land/fixtures/ranges-3-austin.json";
import rangesSeattle from "@/lib/land/fixtures/ranges-3-seattle.json";
import nhlBoundaries from "@/lib/land/fixtures/nhl-bnd-cambridge.json";
import abpp0 from "@/lib/land/fixtures/abpp-0-gettysburg.json";
import abpp1 from "@/lib/land/fixtures/abpp-1-gettysburg.json";
import abpp5 from "@/lib/land/fixtures/abpp-5-gettysburg.json";
import abpp6 from "@/lib/land/fixtures/abpp-6-gettysburg.json";
import abpp8 from "@/lib/land/fixtures/abpp-8-gettysburg.json";
import whsAll from "@/lib/land/fixtures/nps-whs-all.json";
import nhlPoints from "@/lib/land/fixtures/nhl-pt-cambridge.json";
import nhlCountExcl from "@/lib/land/fixtures/nhl-bnd-cambridge-count-excl.json";
import nhlCountNoExcl from "@/lib/land/fixtures/nhl-bnd-cambridge-count-noexcl.json";

vi.mock("@/lib/server/cache", () => ({
  cached: async <T,>(_k: string, _ttl: number, produce: () => Promise<T>) => ({ value: await produce(), age: 0, hit: false }),
}));

const { GET } = await import("./route");

const calls: string[] = [];
let answer: (url: string) => Response | null = () => null;
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

beforeEach(() => {
  calls.length = 0;
  answer = () => null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      calls.push(u);
      const r = answer(u);
      if (!r) throw new Error(`unexpected request ${u}`);
      return r;
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

type Body = Record<string, unknown> & { data: { features: Array<{ properties: Record<string, unknown> & { details?: Record<string, unknown>; extra?: Record<string, unknown> } }> }; caveats?: string[]; provenance?: Array<{ seriesId?: string }> };
async function get(qs: string) {
  const res = await GET(new NextRequest(`http://localhost/api/land?${qs}`));
  return { status: res.status, body: (await res.json()) as Body };
}
const param = (url: string, k: string) => new URL(url).searchParams.get(k);

describe("op=wetlands", () => {
  const nwi = (u: string) => {
    if (u.includes("/Wetlands/MapServer/0/query")) return json(nwiWetlands);
    if (u.includes("/Data_Source/MapServer/3/query")) return json(nwiSource);
    return null;
  };

  it("asks layer 0 for plain fields (the prefixed join is a 400 since 2026) and decodes each code locally, no second call", async () => {
    answer = nwi;
    const { status, body } = await get("op=wetlands&bbox=-98.48,29.30,-98.46,29.32");
    expect(status).toBe(200);
    const q0 = calls.find((u) => u.includes("/Wetlands/MapServer/0/query"))!;
    expect(param(q0, "outFields")).toBe("OBJECTID,ATTRIBUTE,WETLAND_TYPE,ACRES");
    expect(calls.some((u) => u.includes("/Wetlands/MapServer/1/"))).toBe(false);
    expect(calls).toHaveLength(2);
    expect(body.data.features).toHaveLength(14);
    const lake = body.data.features.find((f) => f.properties.extra?.code === "L2USAh")!;
    expect(lake.properties.details).toMatchObject({ system: "Lacustrine", subsystem: "Littoral", class: "Unconsolidated Shore", "water regime": "Temporarily Flooded", "mapped from": "1983 imagery (Southton, CIR 1:58,000, 03/83)" });
    expect(body.imageYears).toEqual([1983]);
    expect(body).not.toHaveProperty("codesDecoded");
    expect(body.provenance?.map((p) => p.seriesId)).toEqual(expect.arrayContaining([expect.stringContaining("Data_Source MapServer layer 3")]));
  });

  it("still draws and names the polygons when the source layer fails, imagery year unknown, and says so", async () => {
    answer = (u) => (u.includes("/Data_Source/MapServer/3/query") ? new Response("bad gateway", { status: 502 }) : nwi(u));
    const { status, body } = await get("op=wetlands&bbox=-98.48,29.30,-98.46,29.32");
    expect(status).toBe(200);
    expect(body.data.features).toHaveLength(14);
    expect(body.data.features[0].properties.extra?.system).toBe("Lacustrine");
    expect(body.imageYears).toBeNull();
    expect(body.caveats?.join(" ")).toMatch(/Data_Source layer did not answer/);
  });
});

// NPS's boundary layer (1) holds listed polygons whose Address reads "Address
// Restricted" (3 on 2026-10-12: 66000046, 66000049, 66000113); the point layer has
// none. The filter runs at NPS, so it is checked as the where clause sent.
const NRHP_WHERE = "STATUS='Listed' AND (Address IS NULL OR UPPER(Address) NOT LIKE '%RESTRICT%')";

describe("op=historic", () => {
  const nps = (u: string) => {
    if (u.includes("/nrhp_locations/MapServer/0/query")) return json(nrhpPoints);
    if (u.includes("/nrhp_locations/MapServer/1/query")) return json(nrhpBoundaries);
    return null;
  };

  it("asks NPS for listed properties only, by named fields, never the address", async () => {
    answer = nps;
    const { status, body } = await get("op=historic&bbox=-77.04,38.88,-77.02,38.90");
    expect(status).toBe(200);
    expect(calls).toHaveLength(1);
    const q = calls[0];
    expect(param(q, "where")).toBe(NRHP_WHERE);
    const fields = param(q, "outFields")!.split(",");
    expect(fields).toEqual(["OBJECTID", "NRIS_Refnum", "RESNAME", "ResType", "City", "County", "State", "Is_NHL", "CertDate", "NARA_URL"]);
    expect(fields).not.toContain("Address");
    expect(fields).not.toContain("*");
    expect(param(q, "resultRecordCount")).toBe("2000");
    expect(body.data.features).toHaveLength(60);
    expect(body.points).toBe(60);
    expect(body.boundaries).toBeUndefined();
    expect(body.caveats?.join(" ")).toMatch(/NHPA section 304 \/ ARPA/);
    expect(body.caveats?.join(" ")).toMatch(/not a substitute for Section 106/);
  });

  it("adds the boundaries with polygons=1, and keeps the points when the boundary layer fails", async () => {
    answer = nps;
    const both = await get("op=historic&bbox=-77.04,38.88,-77.02,38.90&polygons=1");
    expect(both.body.data.features).toHaveLength(78);
    expect(both.body.boundaries).toBe(18);
    const q1 = calls.find((u) => u.includes("/MapServer/1/query"))!;
    expect(param(q1, "outFields")).not.toContain("Address");
    expect(param(q1, "where")).toBe(NRHP_WHERE);

    answer = (u) => (u.includes("/MapServer/1/query") ? new Response("down", { status: 503 }) : nps(u));
    const half = await get("op=historic&bbox=-77.04,38.88,-77.02,38.90&polygons=1");
    expect(half.status).toBe(200);
    expect(half.body.data.features).toHaveLength(60);
    expect(half.body.boundaries).toBeNull();
    expect(half.body.caveats?.join(" ")).toMatch(/boundary layer did not answer/);
  });

  it("never asks either layer for a listing NPS marks Address Restricted, and never requests the address", async () => {
    answer = nps;
    await get("op=historic&bbox=-71.14,42.36,-71.10,42.38&polygons=1");
    const layers = ["/MapServer/0/query", "/MapServer/1/query"].map((p) => calls.find((u) => u.includes(p))!);
    for (const u of layers) {
      expect(u).toBeTruthy();
      const where = param(u, "where")!;
      expect(where).toMatch(/^STATUS='Listed' AND /);
      expect(where).toContain("UPPER(Address) NOT LIKE '%RESTRICT%'");
      expect(param(u, "outFields")!.split(",")).not.toContain("Address");
    }
  });

  it("keeps a box already on the 0.02 grid, and refuses a blank coordinate instead of reading it as 0", async () => {
    answer = nps;
    const on = await get("op=historic&bbox=-77.04,38.88,-77.02,38.90");
    expect(on.body.bbox).toEqual([-77.04, 38.88, -77.02, 38.9]);
    calls.length = 0;
    for (const b of ["-77.05,,-77.0,38.9", "-77.05,38.88,-77.0,", ",38.88,-77.0,38.9"]) {
      const r = await get(`op=historic&bbox=${b}`);
      expect(r.status).toBe(400);
    }
    expect(calls).toEqual([]);
  });

  it("clamps the box to 0.12 degrees on a 0.02 grid and refuses a bad one without asking NPS", async () => {
    answer = nps;
    const { body } = await get("op=historic&bbox=-77.5,38.5,-76.5,39.5");
    const [w, s, e, n] = body.bbox as number[];
    expect(e - w).toBeLessThanOrEqual(0.12 + 0.02 + 1e-9);
    expect(n - s).toBeLessThanOrEqual(0.12 + 0.02 + 1e-9);
    for (const v of [w, s, e, n]) expect(Math.abs(v / 0.02 - Math.round(v / 0.02))).toBeLessThan(1e-6);
    expect(w).toBeLessThanOrEqual(-77.06);
    expect(e).toBeGreaterThanOrEqual(-76.94);
    calls.length = 0;
    const bad = await get("op=historic&bbox=1,2,3");
    expect(bad.status).toBe(400);
    expect(calls).toEqual([]);
  });
});

// NPS answers captured 2026-10-16 for -71.14,42.36,-71.12,42.38 (Cambridge, MA), unmodified: listed
// NHL boundaries with the restricted-address exclusion (10), and the counts with and without it
// (10 and 11): in this box, dropping the exclusion would add a row. That row is not committed.
describe("op=historic&nhl=1 (Landmarks only)", () => {
  const strict = (u: string) => {
    const where = param(u, "where") ?? "";
    // Only the full where is answered: listed, restricted addresses excluded, and the NHL clause.
    if (!where.startsWith("STATUS='Listed' AND (Address IS NULL OR UPPER(Address) NOT LIKE '%RESTRICT%')") || !where.endsWith(" AND Is_NHL='X'")) return null;
    if (u.includes("/nrhp_locations/MapServer/0/query")) return json(nhlPoints);
    if (u.includes("/nrhp_locations/MapServer/1/query")) return json(nhlBoundaries);
    return null;
  };

  it("ANDs the NHL clause onto the listed-only and restricted-address exclusions, never replacing them", async () => {
    expect((nhlCountNoExcl as { count: number }).count - (nhlCountExcl as { count: number }).count).toBe(1);
    answer = strict;
    const { status, body } = await get("op=historic&bbox=-71.14,42.36,-71.12,42.38&polygons=1&nhl=1");
    expect(status).toBe(200);
    expect(calls).toHaveLength(2);
    for (const u of calls) expect(param(u, "where")).toBe("STATUS='Listed' AND (Address IS NULL OR UPPER(Address) NOT LIKE '%RESTRICT%') AND Is_NHL='X'");
    const b = body as unknown as { boundaries: number; nhlOnly: boolean; data: { features: Array<{ properties: { details: Record<string, unknown> } }> } };
    expect(b.nhlOnly).toBe(true);
    expect(b.boundaries).toBe((nhlCountExcl as { count: number }).count);
    for (const f of b.data.features) expect(f.properties.details["national historic landmark"]).toMatch(/^yes/);
    expect(body.caveats?.join(" ")).toMatch(/National Historic Landmarks only/);
  });

  it("leaves the where unchanged without nhl=1", async () => {
    answer = (u) => (u.includes("/nrhp_locations/MapServer/") ? json(nhlPoints) : null);
    await get("op=historic&bbox=-71.14,42.36,-71.12,42.38");
    expect(param(calls[0], "where")).toBe("STATUS='Listed' AND (Address IS NULL OR UPPER(Address) NOT LIKE '%RESTRICT%')");
  });
});

describe("op=crithab", () => {
  const NOAA = { barton: [nmfsAreaBarton, nmfsLineBarton], pecos: [nmfsAreaPecos, nmfsLinePecos] } as const;
  const fws = (place: "barton" | "pecos") => (u: string) => {
    if (u.includes("/USFWS_Critical_Habitat/FeatureServer/0/query")) return json(place === "barton" ? chFinalBarton : chFinalPecos);
    if (u.includes("/USFWS_Critical_Habitat/FeatureServer/2/query")) return json(place === "barton" ? chProposedBarton : chProposedPecos);
    if (u.includes("/All_NMFS_Critical_Habitat/MapServer/226/query")) return json(NOAA[place][0]);
    if (u.includes("/All_NMFS_Critical_Habitat/MapServer/2/query")) return json(NOAA[place][1]);
    if (u.includes("/Species_Ranges/FeatureServer/3/query")) return json(place === "barton" ? rangesBarton : rangesPecos);
    return null;
  };
  const isFws = (u: string) => u.includes("/USFWS_Critical_Habitat/");

  it("asks both FWS layers at the point for named fields and no geometry, and reads a final designation", async () => {
    answer = fws("barton");
    const { status, body } = await get("op=crithab&lon=-97.7713&lat=30.2638");
    expect(status).toBe(200);
    expect(calls).toHaveLength(5);
    for (const u of calls.filter(isFws)) {
      expect(param(u, "returnGeometry")).toBe("false");
      expect(param(u, "outFields")).toBe("comname,sciname,listing_status,status,fedreg,pubdate");
      expect(param(u, "geometry")).toBe("-97.7713,30.2638");
    }
    const d = body.data as unknown as { final: Array<Record<string, string>>; proposed: unknown[]; noaa: unknown[] };
    expect(d.noaa).toEqual([]);
    expect(d.final).toEqual([{ common: "Austin blind Salamander", scientific: "Eurycea waterlooensis", listing: "Endangered", designation: "Final", fedreg: "78FR51328 51379", published: "2013-08-20" }]);
    expect(d.proposed).toEqual([]);
    expect(body.caveats?.join(" ")).toMatch(/not species range or occurrence/);
  });

  it("labels a proposed designation as proposed", async () => {
    answer = fws("pecos");
    const { body } = await get("op=crithab&lon=-104.30215&lat=33.17766");
    const d = body.data as unknown as { final: unknown[]; proposed: Array<Record<string, string>> };
    expect(d.final).toEqual([]);
    expect(d.proposed).toEqual([expect.objectContaining({ common: "Pecos pupfish", listing: "Proposed Threatened", designation: "Proposed", published: "2024-11-22" })]);
  });

  it("names a layer that failed as unknown, not absent, and refuses a point without lon and lat", async () => {
    answer = (u) => (u.includes("/FeatureServer/2/query") ? new Response("down", { status: 503 }) : fws("barton")(u));
    const { status, body } = await get("op=crithab&lon=-97.7713&lat=30.2638");
    expect(status).toBe(200);
    expect((body.data as unknown as { proposed: unknown }).proposed).toBeNull();
    expect(body.caveats?.join(" ")).toMatch(/proposed critical habitat layer did not answer/);
    calls.length = 0;
    expect((await get("op=crithab&lon=-97.7")).status).toBe(400);
    expect(calls).toEqual([]);
  });
});

describe("op=crithab, NOAA Fisheries", () => {
  const noaa = (area: unknown, line: unknown) => (u: string) => {
    if (u.includes("/USFWS_Critical_Habitat/FeatureServer/")) return json({ type: "FeatureCollection", features: [] });
    if (u.includes("/All_NMFS_Critical_Habitat/MapServer/226/query")) return json(area);
    if (u.includes("/All_NMFS_Critical_Habitat/MapServer/2/query")) return json(line);
    return null;
  };

  it("asks NOAA's polygons at the point and its lines in a box about 200 m around it, and splits the Federal Register anchor", async () => {
    answer = (u) => (u.includes("/Species_Ranges/FeatureServer/3/query") ? json(rangesSeattle) : noaa(nmfsAreaSeattle, nmfsLineSeattle)(u));
    const { status, body } = await get("op=crithab&lon=-122.4&lat=47.6");
    expect(status).toBe(200);
    const area = calls.find((u) => u.includes("/MapServer/226/query"))!;
    const line = calls.find((u) => u.includes("/MapServer/2/query"))!;
    expect(param(area, "geometry")).toBe("-122.4,47.6");
    expect(param(area, "outFields")).toBe("SCIENAME,COMNAME,LISTSTATUS,CHSTATUS,UNIT,ECFR,FR,PUBDATE,EFFECTDATE,HABTYPE");
    expect(JSON.parse(param(line, "geometry")!)).toEqual({ xmin: -122.402, ymin: 47.598, xmax: -122.398, ymax: 47.602 });
    expect(param(line, "geometryType")).toBe("esriGeometryEnvelope");
    const d = body.data as unknown as { noaa: Array<Record<string, unknown>>; ranges: Array<Record<string, unknown>> };
    // NOAA-led ranges (whales, Steller sea lion) and FWS-led ones come back in the same list.
    expect(d.ranges).toHaveLength(10);
    expect(d.ranges.filter((s) => s.agency === "NMFS").length).toBe(7);
    expect(d.noaa).toEqual([
      expect.objectContaining({
        agency: "NOAA Fisheries",
        shape: "area",
        common: "Whale, killer",
        scientific: "Orcinus orca",
        listing: "Endangered",
        designation: "Final",
        unit: "Puget Sound",
        fr: { text: "71 FR 69054", url: "https://www.fisheries.noaa.gov/west-coast/endangered-species-conservation/critical-habitat-southern-resident-killer-whales" },
        published: "2006-11-29",
        effective: "2006-12-29",
      }),
    ]);
    expect(body.caveats?.join(" ")).toMatch(/NOAA's combined polygon layer is dated 2023-05-02/);
  });

  it("reads a line within about 200 m with a blank unit as no unit, and both date formats", async () => {
    answer = noaa(nmfsAreaSodo, nmfsLineSodo);
    const { body } = await get("op=crithab&lon=-122.346&lat=47.5694");
    const d = body.data as unknown as { noaa: Array<Record<string, unknown>> };
    const steelhead = d.noaa.find((s) => s.shape === "line")!;
    expect(steelhead).toMatchObject({ common: "Steelhead", listing: "Threatened", published: "2016-02-24", effective: "2016-03-25" });
    expect(steelhead.unit).toBeUndefined();
    expect(d.noaa.find((s) => s.shape === "area")).toMatchObject({ common: "Salmon, Chinook", unit: "N8", published: "2005-09-02" });
  });

  it("names NOAA as unknown when it fails, and keeps FWS's rows", async () => {
    answer = (u) => (u.includes("/All_NMFS_Critical_Habitat/") ? new Response("down", { status: 404 }) : (u.includes("/USFWS_Critical_Habitat/FeatureServer/0/query") ? json(chFinalBarton) : u.includes("/USFWS_Critical_Habitat/FeatureServer/2/query") ? json(chProposedBarton) : null));
    const { status, body } = await get("op=crithab&lon=-97.7713&lat=30.2638");
    expect(status).toBe(200);
    const d = body.data as unknown as { final: unknown[]; noaa: unknown };
    expect(d.noaa).toBeNull();
    expect(d.final).toHaveLength(1);
    expect(body.caveats?.join(" ")).toMatch(/NOAA Fisheries' critical habitat layers did not answer this time/);
  });
});

describe("op=crithab, species ranges", () => {
  const ranges = (body: unknown) => (u: string) => {
    if (u.includes("/USFWS_Critical_Habitat/FeatureServer/") || u.includes("/All_NMFS_Critical_Habitat/")) return json({ type: "FeatureCollection", features: [] });
    if (u.includes("/Species_Ranges/FeatureServer/3/query")) return body == null ? new Response("down", { status: 404 }) : json(body);
    return null;
  };

  it("lists the species whose range covers the point, separately from habitat, never drawn", async () => {
    answer = ranges(rangesAustin);
    const { status, body } = await get("op=crithab&lon=-97.74&lat=30.27");
    expect(status).toBe(200);
    const q = calls.find((u) => u.includes("/Species_Ranges/"))!;
    expect(param(q, "returnDistinctValues")).toBe("true");
    expect(param(q, "returnGeometry")).toBe("false");
    expect(param(q, "outFields")).toBe("Common_Name,Scientific_Name,ESA_Listing_Status,Entity_Description,Lead_Agency,ECOS_Listed_Species_ID,Range_Shapefile_Last_Updated,Taxonomic_Group,Status_Category");
    expect(param(q, "outFields")).not.toMatch(/Office_Name|Address_City/);
    const d = body.data as unknown as { final: unknown[]; ranges: Array<Record<string, unknown>> };
    expect(d.final).toEqual([]);
    expect(d.ranges).toHaveLength(13);
    expect(d.ranges.find((s) => s.common === "Bone Cave harvestman")).toMatchObject({ scientific: "Texella reyesi", listing: "Endangered", group: "Arachnids", agency: "FWS", rangeUpdated: "2018-01-24", ecos: "https://ecos.fws.gov/ecp/species/465" });
    expect(body.caveats?.join(" ")).toMatch(/it is not presence/);
  });

  it("says unknown, not none, when the range layer fails", async () => {
    answer = ranges(null);
    const { status, body } = await get("op=crithab&lon=-97.74&lat=30.27");
    expect(status).toBe(200);
    expect((body.data as unknown as { ranges: unknown }).ranges).toBeNull();
    expect(body.caveats?.join(" ")).toMatch(/species range layer did not answer this time \(ranges: null\)/);
  });
});

// NPS answers captured 2026-10-16, unmodified (lib/land/fixtures/abpp-*-gettysburg.json, nps-whs-all.json).
describe("op=heritage", () => {
  const ABPP = "/ABPP_Battlefield_Boundaries/FeatureServer/";
  const byLayer: Record<string, unknown> = { 0: abpp0, 1: abpp1, 5: abpp5, 6: abpp6, 8: abpp8 };

  it("asks six ABPP layers in the snapped box, named fields only, and reads a layer that fails as unknown", async () => {
    answer = (u) => {
      const m = u.match(/ABPP_Battlefield_Boundaries\/FeatureServer\/(\d+)\/query/);
      if (!m) return null;
      return m[1] === "9" ? new Response("upstream down", { status: 400 }) : json(byLayer[m[1]]);
    };
    const { status, body } = await get("op=heritage&kind=battlefields&bbox=-77.5,39.5,-77.0,40.0");
    expect(status).toBe(200);
    const asked = calls.filter((u) => u.includes(ABPP)).map((u) => u.match(/FeatureServer\/(\d+)\//)![1]).sort();
    expect(asked).toEqual(["0", "1", "5", "6", "8", "9"]);
    for (const u of calls) expect(param(u, "outFields")).toBe("SITE,NAME,WAR,STATE,BOUNDARY,Acres");
    const b = body as unknown as { bbox: number[]; coverage: Array<{ id: string; state: string; count: number | null }>; data: { features: unknown[] } };
    expect(b.bbox).toEqual([-77.5, 39.5, -77, 40]);
    expect(b.data.features).toHaveLength(3);
    expect(b.coverage.find((c) => c.id === "abpp-9")).toMatchObject({ state: "error", count: null });
    expect(b.coverage.find((c) => c.id === "abpp-5")).toMatchObject({ state: "covered", count: 0 });
    expect(body.caveats?.join(" ")).toMatch(/unknown, not none/);
  });

  it("answers the World Heritage Sites nationally, never asking for SiteOwner", async () => {
    answer = (u) => (u.includes("/World_Heritage_Sites/FeatureServer/0/query") ? json(whsAll) : null);
    const { status, body } = await get("op=heritage&kind=whs");
    expect(status).toBe(200);
    expect(param(calls[0], "outFields")).toBe("RESNAME,UNIT,WHS_Ref,WHS_Link,WebLink");
    expect((body as unknown as { count: number }).count).toBe(26);
  });

  it("refuses an unknown kind, and battlefields without a box, without asking", async () => {
    expect((await get("op=heritage&kind=trails")).status).toBe(400);
    expect((await get("op=heritage&kind=battlefields")).status).toBe(400);
    expect(calls).toEqual([]);
  });
});
