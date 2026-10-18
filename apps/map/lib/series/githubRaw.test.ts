import { describe, expect, it } from "vitest";
import { layeredStore, normaliseBase, rawStore, type RawFetch } from "./githubRaw";
import { fileNameFor, memoryStore } from "./store";
import type { Series, SeriesMeta } from "./types";
import { provenance } from "@/lib/provenance/types";
import { source } from "@/lib/provenance/sources";

const meta = (id: string): SeriesMeta => ({ id, title: id, unit: "count", frequency: "irregular", provenance: provenance(source("gev-snapshot"), { kind: "snapshot", retrievedAt: "2026-09-11T00:00:00.000Z" }) });
const BASE = "https://raw.githubusercontent.com/jcdavis131/gods-eye-view/master/data/series/";

function fakeFetch(files: Record<string, unknown>, opts: { fail?: boolean } = {}) {
  const calls: string[] = [];
  const fetch: RawFetch = async (url) => {
    calls.push(url);
    if (opts.fail) throw new Error("origin down");
    const name = url.slice(url.lastIndexOf("/") + 1);
    if (!(name in files)) return { status: 404, json: async () => ({ error: "not found" }) };
    return { status: 200, json: async () => files[name] };
  };
  return { fetch, calls };
}

const A: Series = { ...meta("snapshot:a"), points: [{ t: 1000, v: 1 }, { t: 2000, v: 2 }] };

describe("rawStore", () => {
  it("fetches series files and the index under the base, caching by TTL", async () => {
    const f = fakeFetch({ [fileNameFor("snapshot:a")]: A, "index.json": [meta("snapshot:a"), meta("other:b"), { broken: true }] });
    const store = rawStore(BASE, { fetch: f.fetch });
    const s = await store.get("snapshot:a", { from: 1500 });
    expect(s?.points).toEqual([{ t: 2000, v: 2 }]);
    expect(await store.get("snapshot:a")).not.toBeNull();
    expect(f.calls).toEqual([`${normaliseBase(BASE)}/${fileNameFor("snapshot:a")}`]);
    expect((await store.list("snapshot:")).map((m) => m.id)).toEqual(["snapshot:a"]);
    expect((await store.list()).map((m) => m.id)).toEqual(["other:b", "snapshot:a"]);
    expect(await store.get("snapshot:missing")).toBeNull();
  });
  it("is read-only and empty when the index is missing", async () => {
    const f = fakeFetch({});
    const store = rawStore(BASE, { fetch: f.fetch });
    await expect(store.append(meta("x:y"), [])).rejects.toThrow(/read-only/);
    await expect(store.remove("x:y")).rejects.toThrow(/read-only/);
    expect(await store.list()).toEqual([]);
  });
  it("throws on a non-404 error and serves the last good copy afterwards", async () => {
    let fail = false;
    const inner = fakeFetch({ [fileNameFor("snapshot:a")]: A });
    const store = rawStore(BASE, {
      ttlMs: 0,
      fetch: async (url) => {
        if (fail) return { status: 500, json: async () => ({}) };
        return inner.fetch(url);
      },
    });
    expect((await store.get("snapshot:a"))?.points).toHaveLength(2);
    fail = true;
    expect((await store.get("snapshot:a"))?.points).toHaveLength(2);
    await expect(store.get("snapshot:never")).rejects.toThrow(/500/);
  });
});

describe("layeredStore", () => {
  it("merges reads from both layers, primary winning, and writes to primary only", async () => {
    const primary = memoryStore();
    const fallback = memoryStore();
    await fallback.append(meta("snapshot:a"), [{ t: 1000, v: 1 }, { t: 2000, v: 2 }]);
    await fallback.append(meta("snapshot:only-fallback"), [{ t: 1, v: 1 }]);
    const store = layeredStore(primary, fallback);
    await store.append({ ...meta("snapshot:a"), title: "primary title" }, [{ t: 2000, v: 22 }, { t: 3000, v: 3 }]);
    const s = await store.get("snapshot:a");
    expect(s?.title).toBe("primary title");
    expect(s?.points).toEqual([{ t: 1000, v: 1 }, { t: 2000, v: 22 }, { t: 3000, v: 3 }]);
    expect((await store.get("snapshot:a", { from: 2500 }))?.points).toEqual([{ t: 3000, v: 3 }]);
    expect((await store.get("snapshot:only-fallback"))?.points).toEqual([{ t: 1, v: 1 }]);
    expect(await store.get("snapshot:nowhere")).toBeNull();
    expect((await store.list("snapshot:")).map((m) => m.id)).toEqual(["snapshot:a", "snapshot:only-fallback"]);
    expect((await fallback.get("snapshot:a"))?.points).toHaveLength(2);
    await store.remove("snapshot:a");
    expect(await primary.get("snapshot:a")).toBeNull();
    expect((await store.get("snapshot:a"))?.points).toHaveLength(2);
  });
  it("treats a failing fallback as empty", async () => {
    const primary = memoryStore();
    await primary.append(meta("snapshot:a"), [{ t: 1, v: 1 }]);
    const failing = rawStore(BASE, { fetch: fakeFetch({}, { fail: true }).fetch });
    const store = layeredStore(primary, failing);
    expect((await store.get("snapshot:a"))?.points).toEqual([{ t: 1, v: 1 }]);
    expect((await store.list()).map((m) => m.id)).toEqual(["snapshot:a"]);
  });
});
