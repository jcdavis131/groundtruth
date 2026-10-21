// /api/infra?op=hospitals, box tier: the CMS provenance entry's period is built from the baked join's own
// meta.cmsModified, not typed beside it. world_context reads that sentence as the CMS rating's publishedAt
// (lib/mcp/world.ts, PUBLISHED), so a second copy of the date could drift from the bake without any test noticing.
//
// The route holds the bake in a module-level promise, so each case resets the module registry and mocks the bake
// afresh: the real bake with only meta.cmsModified changed (its rows stay, so the box still joins). FEMA's answer is
// the captured box (lib/infra/fixtures, unmodified). No network.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import box from "@/lib/infra/fixtures/hosp-box-austin.json";

const H = "https://services.arcgis.com/XG15cJAlne2vxtgt/arcgis/rest/services/Hospitals_RAPT/FeatureServer/6/query?";
type Bake = { meta: Record<string, unknown> } & Record<string, unknown>;
type Prov = { source: { id: string }; period?: string };

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (!String(url).startsWith(H)) throw new Error(`unexpected request ${url}`);
      return new Response(JSON.stringify(box), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock("@/lib/server/cache");
  vi.doUnmock("@/lib/infra/data/cms-hospitals.json");
});

/** The route's reply for the Austin box with the baked join's cmsModified set to `cmsModified`. */
async function cmsEntry(cmsModified: string | null): Promise<Prov> {
  vi.doMock("@/lib/server/cache", () => ({
    cached: async <T,>(_k: string, _ttl: number, produce: () => Promise<T>) => ({ value: await produce(), age: 0, hit: false }),
  }));
  vi.doMock("@/lib/infra/data/cms-hospitals.json", async (importOriginal) => {
    const real = ((await importOriginal()) as { default: Bake }).default;
    return { default: { ...real, meta: { ...real.meta, cmsModified } } };
  });
  const { GET } = await import("./route");
  const { NextRequest } = await import("next/server");
  const res = await GET(new NextRequest("http://localhost/api/infra?op=hospitals&bbox=-97.8,30.2,-97.65,30.4"));
  expect(res.status).toBe(200);
  const body = (await res.json()) as { provenance: Prov[] };
  const entry = body.provenance.find((p) => p.source.id === "cms-provider-data");
  expect(entry, "the box tier carries a CMS provenance entry").toBeDefined();
  return entry!;
}

describe("op=hospitals: the CMS provenance period comes from the bake", () => {
  it("follows the bake's meta.cmsModified: a bake modified on another date gives that date, in the sentence world_context reads", async () => {
    const entry = await cmsEntry("2026-08-15");
    expect(entry.period).toBe("dataset modified 2026-08-15");
  }, 30_000);

  it("a bake that records no modified date gives an entry with no period, never a date typed beside it", async () => {
    const entry = await cmsEntry(null);
    expect(entry.period).toBeUndefined();
    expect(JSON.stringify(entry)).not.toMatch(/dataset modified/);
  }, 30_000);
});
