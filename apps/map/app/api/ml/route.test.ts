// Route contract for /api/ml: validation is strict, unknowns 404, the
// similar op serves from the bundled embedding with no network, and every
// estimate provenance entry names its inputs (record rule).
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";

const get = (qs: string) => GET(new NextRequest(`http://localhost/api/ml${qs}`));

describe("/api/ml", () => {
  it("rejects unknown ops and bad fips", async () => {
    expect((await get("?op=nope")).status).toBe(400);
    expect((await get("?op=forecast")).status).toBe(400);
    expect((await get("?op=forecast&fips=48")).status).toBe(400);
    expect((await get("?op=similar&fips=abc")).status).toBe(400);
  });

  it("op=similar returns neighbours from the bundled embedding", async () => {
    const res = await get("?op=similar&fips=48453&k=5");
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: { modelVersion: string; vintage: string; neighbours: Array<{ fips: string; similarity: number }>; modelCard: string };
      provenance: Array<{ kind: string; inputs?: unknown[] }>;
      caveats: string[];
    };
    expect(json.data.modelVersion).toBe("county-sim-v1");
    expect(json.data.neighbours).toHaveLength(5);
    expect(json.data.neighbours.every((n) => n.fips !== "48453")).toBe(true);
    const ds = json.data.neighbours.map((n) => n.similarity);
    for (let i = 1; i < ds.length; i++) expect(ds[i]).toBeLessThanOrEqual(ds[i - 1]);
    expect(json.data.modelCard).toMatch(/model-cards\/county-sim-v1\.md$/);
    expect(json.provenance.length).toBeGreaterThan(0);
  });

  it("op=similar 404s on a county outside the embedding", async () => {
    const res = await get("?op=similar&fips=99999");
    expect(res.status).toBe(404);
  });

  it("estimate provenance entries name their inputs", async () => {
    const res = await get("?op=similar&fips=48453&k=5");
    const json = (await res.json()) as {
      provenance: Array<{ kind: string; inputs?: Array<{ sourceId: string; retrievedAt: string }> }>;
    };
    const estimates = json.provenance.filter((p) => p.kind === "estimate");
    expect(estimates.length).toBeGreaterThan(0);
    for (const e of estimates) {
      expect(e.inputs && e.inputs.length > 0).toBe(true);
      for (const i of e.inputs ?? []) {
        expect(typeof i.sourceId).toBe("string");
        expect(typeof i.retrievedAt).toBe("string");
      }
    }
  });
});
