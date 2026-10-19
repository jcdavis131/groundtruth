// The shared county outlines (lib/layers/areas.ts), generalised in round 4 so the
// county choropleths (riskindex, health) join onto the same polygons as commerce and
// realestate. The commerce and realestate answers must be unchanged by that: their
// fetch output is hashed against the hash it had at 2a0db3d, before the refactor, on the
// same input (lib/economy/fixtures/areas-ct.json, /api/economy?op=areas for
// -73.8,40.9,-71.7,42.1 as eye.jcamd.com answered it on 2026-10-16, unmodified).
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import areasCt from "@/lib/economy/fixtures/areas-ct.json";
import { fetchAreas } from "./areas";
import type { FetchContext } from "./types";

const ctx: FetchContext = { keys: {}, view: { lon: -72.7, lat: 41.6, height: 400_000, heading: 0, pitch: -90 }, now: 1_760_000_000_000, options: {} };

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(areasCt), { status: 200, headers: { "content-type": "application/json" } })),
  );
});
afterEach(() => vi.unstubAllGlobals());

const sha = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex");

describe("the shared county outlines", () => {
  it("leave commerce and realestate byte-identical to 2a0db3d", async () => {
    const c = await fetchAreas(ctx, "commerce");
    const r = await fetchAreas(ctx, "realestate");
    expect(c.collection.features).toHaveLength(52);
    expect(sha(c)).toBe("f3a698a6bd02aba53158d45eb22d29309eb599c75f2e1f8c3935ee781e2512c6");
    expect(sha(r)).toBe("4c94ed763383cd89ccc77440410b9d009e4eb83ed97dcc405d74faf36a581a8e");
  });
});
