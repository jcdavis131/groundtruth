// /api/terrain with fetch replaced: the tile op passes the publisher's image
// through with an edge cache line and refuses anything that is not an image;
// the point op answers from payloads captured from USFS, MRLC and 3DEP on
// 2026-09-26; bad parameters never reach an upstream. No network.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import whpNw from "@/lib/terrain/fixtures/whp-identify-nw.json";
import nlcdDt from "@/lib/terrain/fixtures/nlcd-gfi-dt.json";
import slopeNw from "@/lib/terrain/fixtures/slope-identify-nw.json";
import waybackConfig from "@/lib/terrain/fixtures/wayback-config-trimmed.json";
import htmcSf from "@/lib/terrain/fixtures/htmc-point-sf.json";
import tnmSf from "@/lib/terrain/fixtures/tnm-htmc-sf.json";
import meta2014 from "@/lib/terrain/fixtures/wayback-meta-2014r01-5-sf.json";
import meta2026 from "@/lib/terrain/fixtures/wayback-meta-2026r09-4-sf.json";

vi.mock("@/lib/server/cache", () => ({
  cached: async <T,>(_k: string, _ttl: number, produce: () => Promise<T>) => ({ value: await produce(), age: 0, hit: false }),
  cacheDelete: () => {},
}));

import { GET } from "./route";

const req = (qs: string) => new NextRequest(`http://localhost/api/terrain?${qs}`);
const calls: string[] = [];
let answer: (url: string) => Response = () => new Response("unset", { status: 500 });

beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls.push(String(url));
      return answer(String(url));
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("op=tile", () => {
  it("passes a rendered PNG through with CORS and a long edge cache, asking 3DEP for the tile's projected box", async () => {
    answer = () => new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { status: 200, headers: { "content-type": "image/png" } });
    const res = await GET(req("op=tile&product=slope&z=15&x=7420&y=13575"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("cache-control")).toBe("public, max-age=86400, s-maxage=2592000, stale-while-revalidate=86400");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("bbox=-10962904.34,3434162.81,-10961681.35,3435385.80");
  });

  it("refuses an answer that is not an image (ArcGIS answers errors with a 200 and JSON)", async () => {
    answer = () => new Response(JSON.stringify({ error: { code: 500, message: "Error exporting image" } }), { status: 200, headers: { "content-type": "application/json" } });
    const res = await GET(req("op=tile&product=floodmap&z=15&x=7418&y=13579"));
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toMatch(/instead of an image/);
  }, 15_000);

  it("never reaches an upstream for a product, zoom or tile it does not serve", async () => {
    for (const qs of [
      "op=tile&product=https://example.com&z=15&x=1&y=1",
      "op=tile&product=slope&z=3&x=1&y=1",
      "op=tile&product=contours&z=18&x=1&y=1",
      "op=tile&product=slope&z=10&x=5000&y=1",
      "op=tile&product=slope&z=10&x=1.5&y=1",
      "op=tile&product=slope&z=10&x=&y=1",
      "op=nope",
    ]) {
      expect((await GET(req(qs))).status, qs).toBe(400);
    }
    expect(calls).toHaveLength(0);
  });
});

describe("op=point", () => {
  it("answers the WHP class with the service's own class table and its caveat", async () => {
    answer = () => Response.json(whpNw);
    const j = (await (await GET(req("op=point&product=firehazard&lon=-98.75&lat=29.65"))).json()) as {
      data: { class: { code: number; label: string }; classes: unknown[] };
      provenance: Array<{ source: { id: string } }>;
      caveats: string[];
    };
    expect(j.data.class).toMatchObject({ code: 2, label: "Low" });
    expect(j.data.classes).toHaveLength(7);
    expect(j.provenance[0].source.id).toBe("usfs-whp");
    expect(j.caveats[0]).toMatch(/not an explicit map of wildfire threat or risk/);
  });

  it("answers the NLCD class and the 3DEP slope", async () => {
    answer = () => Response.json(nlcdDt);
    const lc = (await (await GET(req("op=point&product=landcover&lon=-98.4936&lat=29.4241"))).json()) as { data: { class: { code: number } } };
    expect(lc.data.class.code).toBe(24);
    answer = () => Response.json(slopeNw);
    const sl = (await (await GET(req("op=point&product=slope&lon=-98.75&lat=29.65"))).json()) as { data: { degrees: number } };
    expect(sl.data.degrees).toBe(11);
  });

  it("says there is no class rather than inventing one", async () => {
    answer = () => Response.json({ objectId: 0, name: "Pixel", value: "NoData" });
    const j = (await (await GET(req("op=point&product=firehazard&lon=-40&lat=30"))).json()) as { data: { class: unknown }; caveats: string[] };
    expect(j.data.class).toBeNull();
    expect(j.caveats.join(" ")).toMatch(/has no class here/);
  });

  it("needs a known product and a real point", async () => {
    expect((await GET(req("op=point&product=soils&lon=1&lat=1"))).status).toBe(400);
    expect((await GET(req("op=point&product=slope&lon=&lat=1"))).status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

describe("op=products", () => {
  it("lists every picture with its delivery, and the terrain attribution", async () => {
    const j = (await (await GET(req("op=products"))).json()) as { data: { products: Array<{ id: string; delivery: string }>; terrainAttribution: string[] } };
    const ids = j.data.products.map((p) => `${p.id}:${p.delivery}`);
    expect(ids).toEqual(expect.arrayContaining(["slope:route", "contours:route", "landcover:route", "floodmap:route", "relief:direct", "soils:direct", "firehazard:direct", "sealevel:direct", "terrain:direct"]));
    expect(j.data.terrainAttribution.length).toBeGreaterThan(5);
  });
});

describe("op=wayback", () => {
  it("answers Esri's release index newest first, and never a tile", async () => {
    answer = (url) => (url.startsWith("https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json") ? new Response(JSON.stringify(waybackConfig), { status: 200, headers: { "content-type": "application/json" } }) : new Response("unexpected", { status: 500 }));
    const res = await GET(req("op=wayback"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { releases: Array<{ release: number; date: string }>; newest: { date: string }; oldest: { date: string }; tiles: string }; caveats: string[] };
    expect(calls).toHaveLength(1);
    expect(body.data.releases.map((r) => r.release)).toEqual([63116, 26334, 23001, 4230, 10]);
    expect(body.data.newest.date).toBe("2026-09-24");
    expect(body.data.oldest.date).toBe("2014-02-20");
    expect(body.data.tiles).toContain("wayback.maptiles.arcgis.com");
    expect(body.data.tiles).toContain("/tile/{release}/{z}/{y}/{x}");
    expect(body.caveats.join(" ")).toMatch(/not a capture date/);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});

describe("op=topo", () => {
  const usgs = (tnmUp: boolean) => (url: string) => {
    if (url.startsWith("https://historical1.arcgis.com/arcgis/rest/services/USGS_Historical_Topographic_Maps/ImageServer/query?")) return new Response(JSON.stringify(htmcSf), { status: 200, headers: { "content-type": "application/json" } });
    if (url.startsWith("https://tnmaccess.nationalmap.gov/api/v1/products?")) return tnmUp ? new Response(JSON.stringify(tnmSf), { status: 200, headers: { "content-type": "application/json" } }) : new Response("down", { status: 404 });
    return new Response("unexpected", { status: 500 });
  };

  it("asks the HTMC for named fields at the snapped point, lists the editions, and links each sheet's files from TNM", async () => {
    answer = usgs(true);
    const res = await GET(req("op=topo&lon=-122.4213&lat=37.7712"));
    expect(res.status).toBe(200);
    const htmcCall = calls.find((u) => u.includes("/ImageServer/query?"))!;
    const p = new URL(htmcCall).searchParams;
    expect(p.get("geometry")).toBe("-122.42,37.77");
    expect(p.get("outFields")).toBe("OBJECTID,Scan_Id,DateCurrent,Map_Scale,Map_Name,Citation,Imprint_Year,Survey_Year");
    expect(p.get("where")).toBe("Category=1");
    expect(p.get("returnDistinctValues")).toBeNull();
    expect(p.get("returnGeometry")).toBe("false");
    const tnmCall = calls.find((u) => u.includes("tnmaccess"))!;
    expect(new URL(tnmCall).searchParams.get("bbox")).toBe("-122.425,37.765,-122.415,37.775");
    const body = (await res.json()) as { data: { lon: number; lat: number; years: Array<{ year: number }>; sheets: Array<{ geotiff: string | null }>; tiles: string }; caveats: string[] };
    expect(body.data.lon).toBe(-122.42);
    expect(body.data.years[0].year).toBe(1895);
    expect(body.data.sheets).toHaveLength(31);
    expect(body.data.sheets.filter((s) => s.geotiff)).toHaveLength(30);
    expect(body.data.tiles).toContain("DateCurrent%3D{year}");
    expect(body.caveats.join(" ")).toMatch(/edition year is not a survey date/);
  });

  it("still answers the sheets when TNM fails, without links, and refuses a point without lon and lat", async () => {
    answer = usgs(false);
    const res = await GET(req("op=topo&lon=-122.42&lat=37.77"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { sheets: Array<{ geotiff: string | null; geopdf: string | null }> }; caveats: string[] };
    expect(body.data.sheets).toHaveLength(31);
    expect(body.data.sheets.every((s) => s.geotiff === null && s.geopdf === null)).toBe(true);
    expect(body.caveats.join(" ")).toMatch(/TNM did not answer/);
    calls.length = 0;
    expect((await GET(req("op=topo&lon=-122.42"))).status).toBe(400);
    expect((await GET(req("op=topo&lon=&lat=37.77"))).status).toBe(400);
    expect(calls).toEqual([]);
  });
});

describe("op=waybackdate", () => {
  const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
  const esri = (url: string) => {
    if (url.startsWith("https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json")) return json(waybackConfig);
    if (url.startsWith("https://metadata.maptiles.arcgis.com/arcgis/rest/services/World_Imagery_Metadata_2014_r01/MapServer/5/query?")) return json(meta2014);
    if (url.startsWith("https://metadata.maptiles.arcgis.com/arcgis/rest/services/World_Imagery_Metadata_2026_r09/MapServer/4/query?")) return json(meta2026);
    return new Response("unexpected", { status: 500 });
  };

  it("reads the release's metadata URL from Esri's index and returns every capture under the point", async () => {
    answer = esri;
    const res = await GET(req("op=waybackdate&release=10&z=18&lon=-122.42&lat=37.77"));
    expect(res.status).toBe(200);
    const q = calls.find((u) => u.includes("/World_Imagery_Metadata_2014_r01/MapServer/5/query?"))!;
    const p = new URL(q).searchParams;
    expect(p.get("outFields")).toBe("SRC_DATE,SRC_DATE2,SRC_RES,SRC_ACC,SRC_DESC,NICE_NAME,NICE_DESC,MinMapLevel,MaxMapLevel,DrawOrder");
    expect(p.get("geometry")).toBe("-122.42,37.77");
    const body = (await res.json()) as { data: { release: { date: string }; layer: number; captures: Array<{ date: string; name: string | null }> }; caveats: string[] };
    expect(body.data.release.date).toBe("2014-02-20");
    expect(body.data.layer).toBe(5);
    expect(body.data.captures.map((c) => c.date)).toEqual(["2010-10-26", "2010-11-02"]);
    expect(body.data.captures[0].name).toBeNull();
    expect(body.caveats.join(" ")).toMatch(/more than one capture/);
  });

  it("uses the newest release when none is given", async () => {
    answer = esri;
    const res = await GET(req("op=waybackdate&z=19&lon=-122.42&lat=37.77"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { release: { release: number }; captures: Array<{ provider: string }> } };
    expect(body.data.release.release).toBe(63116);
    expect(body.data.captures[0].provider).toBe("Vantor");
  });

  it("refuses a release Esri does not list and never takes a URL from the caller", async () => {
    answer = esri;
    const res = await GET(req("op=waybackdate&release=999&z=18&lon=-122.42&lat=37.77&url=https://example.com/MapServer"));
    expect(res.status).toBe(400);
    expect(calls.some((u) => u.includes("example.com"))).toBe(false);
    calls.length = 0;
    expect((await GET(req("op=waybackdate&z=24&lon=-122.42&lat=37.77"))).status).toBe(400);
    expect((await GET(req("op=waybackdate&z=18.5&lon=-122.42&lat=37.77"))).status).toBe(400);
    expect((await GET(req("op=waybackdate&release=abc&z=18&lon=-122.42&lat=37.77"))).status).toBe(400);
    expect((await GET(req("op=waybackdate&lon=-122.42&lat=37.77"))).status).toBe(400);
    expect(calls).toEqual([]);
  });
});
