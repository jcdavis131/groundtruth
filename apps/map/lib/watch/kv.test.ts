import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { defaultKv, fileKv, fileNameFor, memoryKv, setDefaultKv, type KeyValueStore } from "./kv";

function suite(name: string, make: () => Promise<{ kv: KeyValueStore; clock: { t: number }; done: () => Promise<void> }>) {
  describe(name, () => {
    it("get/set/delete/list with prefixes", async () => {
      const { kv, done } = await make();
      try {
        expect(await kv.get("watch:a")).toBeNull();
        await kv.set("watch:a", "1");
        await kv.set("watch:b", "2");
        await kv.set("watchstate:a:xyz", "{}");
        expect(await kv.get("watch:a")).toBe("1");
        expect(await kv.list("watch:")).toEqual(["watch:a", "watch:b"]);
        expect(await kv.list()).toEqual(["watch:a", "watch:b", "watchstate:a:xyz"]);
        await kv.delete("watch:a");
        expect(await kv.get("watch:a")).toBeNull();
        await kv.delete("watch:a"); // idempotent
      } finally {
        await done();
      }
    });

    it("expires values after ttl", async () => {
      const { kv, clock, done } = await make();
      try {
        await kv.set("watchstate:x", "v", { ttlMs: 1000 });
        expect(await kv.get("watchstate:x")).toBe("v");
        clock.t += 1001;
        expect(await kv.get("watchstate:x")).toBeNull();
        expect(await kv.list()).toEqual([]);
      } finally {
        await done();
      }
    });

    it("rejects bad keys and oversized values", async () => {
      const { kv, done } = await make();
      try {
        await expect(kv.set("../etc/passwd", "x")).rejects.toThrow(/bad key/);
        await expect(kv.get("")).rejects.toThrow(/bad key/);
        await expect(kv.set("k", "x".repeat(300 * 1024))).rejects.toThrow(/exceeds/);
      } finally {
        await done();
      }
    });
  });
}

suite("memoryKv", async () => {
  const clock = { t: 1_000_000 };
  return { kv: memoryKv(() => clock.t), clock, done: async () => {} };
});

suite("fileKv", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "gev-watch-kv-"));
  const clock = { t: 1_000_000 };
  return { kv: fileKv(dir, () => clock.t), clock, done: () => rm(dir, { recursive: true, force: true }) };
});

describe("fileKv details", () => {
  it("maps keys to safe file names and lists an absent directory as empty", async () => {
    expect(fileNameFor("watch:my-list")).toBe("watch_3Amy-list.json");
    const kv = fileKv(path.join(os.tmpdir(), "gev-watch-kv-does-not-exist-" + Date.now()));
    expect(await kv.list()).toEqual([]);
    expect(await kv.get("watch:x")).toBeNull();
  });
});

describe("defaultKv", () => {
  const env = process.env.GEV_WATCH_KV;
  afterEach(() => {
    if (env == null) delete process.env.GEV_WATCH_KV;
    else process.env.GEV_WATCH_KV = env;
    setDefaultKv(undefined);
  });
  it("honours GEV_WATCH_KV=off and =memory", async () => {
    process.env.GEV_WATCH_KV = "off";
    setDefaultKv(undefined);
    expect(defaultKv()).toBeNull();
    process.env.GEV_WATCH_KV = "memory";
    setDefaultKv(undefined);
    const kv = defaultKv();
    expect(kv).not.toBeNull();
    await kv!.set("watch:t", "1");
    expect(await kv!.get("watch:t")).toBe("1");
  });
});
