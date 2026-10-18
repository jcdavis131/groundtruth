// /api/soil with Soil Data Access replaced by answers captured on 2026-09-26:
// the two queries a point takes, the `{}` SDA sends where nothing is mapped,
// and parameters that never reach SQL. No network.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import clayPoint from "@/lib/terrain/fixtures/sda-saclay-point.json";
import clayMapunit from "@/lib/terrain/fixtures/sda-saclay-mapunit.json";
import duvalMapunit from "@/lib/terrain/fixtures/sda-duval-mapunit.json";

vi.mock("@/lib/server/cache", () => ({
  cached: async <T,>(_k: string, _ttl: number, produce: () => Promise<T>) => ({ value: await produce(), age: 0, hit: false }),
}));

import { GET } from "./route";

const req = (qs: string) => new NextRequest(`http://localhost/api/soil?${qs}`);
const queries: string[] = [];
let mapped = true;

beforeEach(() => {
  queries.length = 0;
  mapped = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const q = (JSON.parse(String(init?.body ?? "{}")) as { query?: string }).query ?? "";
      queries.push(q);
      if (q.includes("SDA_Get_Mukey_from_intersection_with_WktWgs84")) return Response.json(mapped ? clayPoint : {});
      if (q.includes("WHERE c.mukey = '390497'")) return Response.json(clayMapunit);
      if (q.includes("WHERE c.mukey = '390459'")) return Response.json(duvalMapunit);
      return Response.json({});
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

interface PointAnswer {
  data: { mapUnit: { name: string; farmlandClass: string; surveySaved: string }; dominant: { nccpi: number }; nccpi: string } | null;
  provenance: Array<{ source: { id: string }; seriesId: string; revision?: string }>;
  caveats: string[];
}

describe("op=point", () => {
  it("answers the map unit, its farmland class and the dominant component's NCCPI in two queries", async () => {
    const j = (await (await GET(req("op=point&lon=-98.45&lat=29.28"))).json()) as PointAnswer;
    expect(queries).toHaveLength(2);
    expect(queries[0]).toContain("POINT(-98.450000 29.280000)");
    expect(j.data?.mapUnit).toMatchObject({ name: "San Antonio clay loam, 1 to 3 percent slopes", farmlandClass: "All areas are prime farmland" });
    expect(j.data?.nccpi).toBe("0.455 (Moderate inherent productivity)");
    expect(j.provenance[0]).toMatchObject({ source: { id: "nrcs-ssurgo" }, seriesId: "mukey 390497, survey area TX029", revision: "survey area saved 9/4/2025 2:58:52 PM" });
    expect(j.caveats.join(" ")).toMatch(/never a price/);
  });

  it("answers null where SDA maps nothing, without a second query", async () => {
    mapped = false;
    const j = (await (await GET(req("op=point&lon=-40&lat=30"))).json()) as PointAnswer;
    expect(j.data).toBeNull();
    expect(queries).toHaveLength(1);
    expect(j.caveats[0]).toMatch(/No SSURGO map unit/);
  });

  it("needs a real point", async () => {
    for (const qs of ["op=point&lon=&lat=29", "op=point&lon=-98&lat=95", "op=point"]) expect((await GET(req(qs))).status, qs).toBe(400);
    expect(queries).toHaveLength(0);
  });
});

describe("op=mapunit", () => {
  it("lists the components with unrated ones as null", async () => {
    const j = (await (await GET(req("op=mapunit&mukey=390459"))).json()) as { data: { components: Array<{ name: string; nccpi: number | null }>; nccpi: string } };
    expect(j.data.components.map((c) => c.nccpi)).toEqual([0.379, null, null, null, null]);
    expect(j.data.nccpi).toBe("0.379 (Moderately low inherent productivity)");
  });

  it("never puts anything but digits into SQL", async () => {
    for (const qs of ["op=mapunit&mukey=1%27%20OR%201%3D1", "op=mapunit&mukey=", "op=mapunit", "op=drop"]) expect((await GET(req(qs))).status, qs).toBe(400);
    expect(queries).toHaveLength(0);
  });
});
