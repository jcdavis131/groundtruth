import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyQuery, fileNameFor, fileStore, memoryStore, mergePoints } from "./store";
import type { SeriesMeta, SeriesStore } from "./types";
import { provenance } from "@/lib/provenance/types";
import { source } from "@/lib/provenance/sources";

const meta: SeriesMeta = {
  id: "snapshot:port-vessels:USLAX",
  title: "Vessels within 50 km of Los Angeles",
  unit: "count",
  frequency: "daily",
  geo: { kind: "port", id: "USLAX", name: "Los Angeles" },
  provenance: provenance(source("gev-snapshot"), { kind: "snapshot" }),
};

describe("mergePoints", () => {
  it("dedupes by time, later wins, sorted", () => {
    const out = mergePoints(
      [
        { t: 2, v: 1 },
        { t: 1, v: 1 },
      ],
      [
        { t: 2, v: 5 },
        { t: 3, v: null },
      ],
    );
    expect(out).toEqual([
      { t: 1, v: 1 },
      { t: 2, v: 5 },
      { t: 3, v: null },
    ]);
  });
});

describe("applyQuery", () => {
  const pts = [1, 2, 3, 4, 5].map((t) => ({ t, v: t }));
  it("bounds and limits keep the newest", () => {
    expect(applyQuery(pts, { from: 2, to: 4 }).map((p) => p.t)).toEqual([2, 3, 4]);
    expect(applyQuery(pts, { limit: 2 }).map((p) => p.t)).toEqual([4, 5]);
  });
});

function storeSuite(name: string, mk: () => Promise<{ store: SeriesStore; done: () => Promise<void> }>) {
  describe(name, () => {
    it("round-trips append/get/list/remove", async () => {
      const { store, done } = await mk();
      try {
        await store.append(meta, [{ t: 1000, v: 10 }]);
        await store.append(meta, [
          { t: 1000, v: 11 },
          { t: 2000, v: 12 },
        ]);
        const s = await store.get(meta.id);
        expect(s?.points).toEqual([
          { t: 1000, v: 11 },
          { t: 2000, v: 12 },
        ]);
        expect(s?.geo?.id).toBe("USLAX");
        expect((await store.list("snapshot:")).map((m) => m.id)).toEqual([meta.id]);
        expect(await store.list("other:")).toEqual([]);
        expect((await store.get(meta.id, { from: 1500 }))?.points.length).toBe(1);
        await store.remove(meta.id);
        expect(await store.get(meta.id)).toBeNull();
      } finally {
        await done();
      }
    });
  });
}

storeSuite("memoryStore", async () => ({ store: memoryStore(), done: async () => {} }));
storeSuite("fileStore", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "gev-series-"));
  return { store: fileStore(dir), done: () => rm(dir, { recursive: true, force: true }) };
});

describe("fileNameFor", () => {
  it("is filesystem safe and reversible", () => {
    const n = fileNameFor("a:b/c d");
    expect(n).not.toMatch(/[:/ ]/);
    expect(decodeURIComponent(n.slice(0, -5).replace(/_/g, "%"))).toBe("a:b/c d");
  });
});
