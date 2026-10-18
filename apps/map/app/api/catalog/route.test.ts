// /api/catalog: static, no upstream call; sources expanded from the registry.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { LAYER_IDS } from "@/lib/layers/types";
import { COLLECTIONS, catalogued } from "@/lib/catalog/collections";
import { PLACE_EXPORTS, PLACE_EXPORT_FORM } from "@/lib/catalog/placeExport";
import nplFile from "@/lib/catalog/data/npl-county.json";
import { GET } from "./route";

const fetchSpy = vi.fn(async () => {
  throw new Error("the catalogue makes no request");
});
beforeEach(() => vi.stubGlobal("fetch", fetchSpy));
afterEach(() => vi.unstubAllGlobals());

async function get(qs = "") {
  const res = GET(new NextRequest(`http://localhost/api/catalog${qs ? `?${qs}` : ""}`));
  return { status: res.status, headers: res.headers, body: (await res.json()) as Record<string, unknown> & { data: Record<string, unknown> } };
}

describe("/api/catalog", () => {
  it("lists every collection with its sources expanded, and the layers not yet catalogued", async () => {
    const { status, headers, body } = await get();
    expect(status).toBe(200);
    expect(headers.get("access-control-allow-origin")).toBe("*");
    expect(headers.get("cache-control")).toContain("s-maxage=3600");
    const d = body.data as { collections: Array<{ id: string; sources: Array<{ publisher: string; license: string }>; globe: string }>; uncatalogued: string[] };
    expect(d.collections.map((c) => c.id)).toEqual(COLLECTIONS.map((c) => c.id));
    const nrhp = d.collections.find((c) => c.id === "nrhp-listed")!;
    expect(nrhp.sources[0].publisher).toMatch(/National Park Service/);
    expect(nrhp.sources[0].license.length).toBeGreaterThan(5);
    expect(nrhp.globe).toBe("/?layers=historic");
    expect(d.uncatalogued).toEqual(LAYER_IDS.filter((l) => !catalogued().includes(l)));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("answers one id, or 404 with the list of ids", async () => {
    const one = await get("id=nrhp-listed");
    expect(one.status).toBe(200);
    expect((one.body.data.collection as { id: string }).id).toBe("nrhp-listed");
    const miss = await get("id=nope");
    expect(miss.status).toBe(404);
    expect((miss.body.details as { ids: string[] }).ids).toContain("fws-crithab");
  });

  it("answers a layer's collections, and refuses a layer id that does not exist", async () => {
    const ok = await get("layer=contaminants");
    expect(ok.status).toBe(200);
    expect((ok.body.data.collections as Array<{ id: string }>).map((c) => c.id)).toEqual(["emef-sems", "emef-tri", "emef-rcra", "emef-acres", "tri-releases", "npl-boundaries", "npl-status", "fuds-properties", "fuds-projects", "fuds-mrs"]);
    expect((await get("layer=relief")).body.data.collections).toEqual([]);
    expect((await get("layer=nope")).status).toBe(400);
  });
});

describe("/api/catalog?op=search", () => {
  it("ranks collections for a query with the embedder named, and makes no request", async () => {
    const { status, headers, body } = await get("op=search&q=leaking%20fuel%20tanks&limit=3");
    expect(status).toBe(200);
    expect(headers.get("cache-control")).toContain("s-maxage=3600");
    const d = body.data as { hits: Array<{ id: string; score: number; ops: string[]; catalog: string }>; embedder: { id: string; commit: string; licence: string }; matched: boolean };
    expect(d.matched).toBe(true);
    expect(d.hits).toHaveLength(3);
    for (const h of d.hits) {
      expect(COLLECTIONS.map((c) => c.id)).toContain(h.id);
      expect(h.catalog).toBe(`/catalog#${h.id}`);
    }
    expect(d.embedder).toMatchObject({ id: "potion-base-8M@bf8b0566-int8", licence: "MIT" });
    expect(d.embedder.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses a query under 2 or over 200 characters without echoing it, and a bad limit", async () => {
    for (const qs of ["op=search", "op=search&q=a", `op=search&q=${"x".repeat(201)}`, "op=search&q=dams&limit=0", "op=search&q=dams&limit=11"]) {
      const r = await get(qs);
      expect(r.status, qs).toBe(400);
      expect(JSON.stringify(r.body), qs).not.toContain("xxxxxxxxxx");
    }
    expect((await get("op=nope")).status).toBe(400);
  });

  it("answers an empty list, not noise, for a query with no known word", async () => {
    const r = await get("op=search&q=%F0%9F%A6%96%F0%9F%A6%96");
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ hits: [], matched: false });
  });
});

describe("/api/catalog?op=place-export", () => {
  it("serves the committed NPL county export with its rules, and refuses an unknown collection", async () => {
    const r = await get("op=place-export&collection=npl-status");
    expect(r.status).toBe(200);
    const d = r.body.data as { meta: { zero_vs_missing: string; years: number[]; features: string[]; counts: { serviceCount: number; sitesRead: number } }; places: string[]; value: number[][][]; nullPlaces: Record<string, string> };
    expect(d.meta.zero_vs_missing).toBe("complete-census");
    expect(d.meta.counts.sitesRead).toBe(d.meta.counts.serviceCount);
    expect(d.value).toHaveLength(d.places.length);
    for (const v of d.value) expect(v).toHaveLength(d.meta.years.length);
    for (const g of d.places) expect(d.nullPlaces[g]).toBeUndefined();
    // Lewis and Clark, MT is one county, not "Lewis" + "Clark": a split on "and" once nulled all of Montana.
    const sites = (r.body.data as { siteIds: Record<string, string[]> }).siteIds;
    expect(sites["30049"]).toEqual(expect.arrayContaining(["MTD006230346", "MTSFN7578012"]));
    expect(Object.keys(d.nullPlaces).filter((g) => g.startsWith("30")).every((g) => d.nullPlaces[g] === "join:multi_county")).toBe(true);
    expect((await get("op=place-export&collection=nope")).status).toBe(400);
    expect((await get("op=place-export&collection=attains-impaired")).status).toBe(400);
    expect((await get("op=place-export")).status).toBe(400);
  });

  it("serves the static UST and FUDS exports with their caveats", async () => {
    for (const id of ["ust-releases-county", "ust-facilities-county", "fuds-properties"]) {
      const r = await get(`op=place-export&collection=${id}`);
      expect(r.status, id).toBe(200);
      const d = r.body.data as { meta: { collection: string; form: string; years: null }; places: string[]; value: unknown[][] };
      expect(d.meta).toMatchObject({ collection: id, form: "static", years: null });
      expect(d.value).toHaveLength(d.places.length);
      expect((r.body as { caveats?: string[] }).caveats?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("serves meta.form for every export, from PLACE_EXPORT_FORM when the file has none (npl-county.json)", async () => {
    expect((nplFile.meta as { form?: string }).form).toBeUndefined();
    for (const id of PLACE_EXPORTS) {
      const r = await get(`op=place-export&collection=${id}`);
      expect((r.body.data as { meta: { form: string } }).meta.form, id).toBe(PLACE_EXPORT_FORM[id]);
    }
    expect(PLACE_EXPORT_FORM["npl-status"]).toBe("series");
    // The served copy carries the rest of meta unchanged.
    const npl = (await get("op=place-export&collection=npl-status")).body.data as { meta: Record<string, unknown> };
    expect({ ...npl.meta, form: undefined }).toEqual({ ...nplFile.meta, form: undefined });
  });
});
