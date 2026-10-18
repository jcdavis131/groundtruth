// Small key/value store for the few strings the watch feature wants to keep:
// published watchlists (`watch:<id>`) and the last values a feed saw
// (`watchstate:<id>`, needed for crosses_above / crosses_below). Mirrors
// lib/series/store.ts, which is for numbers, not documents.
//
//   memoryKv()      tests and ephemeral serverless processes
//   fileKv(dir)     one JSON file per key under `dir`, atomic rename writes
//   defaultKv()     GEV_WATCH_KV=off -> null (stateless), =memory -> memory,
//                   else a file store at GEV_WATCH_DIR or data/watch
//
// A remote adapter (Cloudflare KV, Vercel KV, Postgres) implements the same
// four methods and is returned from defaultKv() behind an env variable.

import { promises as fs } from "node:fs";
import path from "node:path";

export interface KeyValueStore {
  /** Value or null when absent or expired. */
  get(key: string): Promise<string | null>;
  /** Write; `ttlMs` makes the value disappear after that long. */
  set(key: string, value: string, opts?: { ttlMs?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  /** Keys starting with `prefix` (all when omitted), sorted. */
  list(prefix?: string): Promise<string[]>;
}

export const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9:_.\-]{0,127}$/;

/** Largest value we store, bytes. Watchlists are a few KB; state is smaller. */
export const MAX_VALUE_BYTES = 256 * 1024;

export function assertKey(key: string): void {
  if (!KEY_RE.test(key)) throw new Error(`kv: bad key "${key.slice(0, 40)}"`);
}

function assertValue(value: string): void {
  if (typeof value !== "string") throw new Error("kv: value must be a string");
  if (value.length > MAX_VALUE_BYTES) throw new Error(`kv: value exceeds ${MAX_VALUE_BYTES} bytes`);
}

interface Envelope {
  value: string;
  /** Epoch ms; absent = never. */
  expires?: number;
}

export function memoryKv(now: () => number = Date.now): KeyValueStore {
  const m = new Map<string, Envelope>();
  return {
    async get(key) {
      assertKey(key);
      const e = m.get(key);
      if (!e) return null;
      if (e.expires != null && e.expires <= now()) {
        m.delete(key);
        return null;
      }
      return e.value;
    },
    async set(key, value, opts) {
      assertKey(key);
      assertValue(value);
      m.set(key, { value, expires: opts?.ttlMs != null ? now() + opts.ttlMs : undefined });
    },
    async delete(key) {
      assertKey(key);
      m.delete(key);
    },
    async list(prefix) {
      const t = now();
      return [...m.entries()]
        .filter(([k, e]) => (!prefix || k.startsWith(prefix)) && (e.expires == null || e.expires > t))
        .map(([k]) => k)
        .sort();
    },
  };
}

/** Keys may contain ':' which is not safe on every file system. */
export function fileNameFor(key: string): string {
  return encodeURIComponent(key).replace(/%/g, "_") + ".json";
}

export function fileKv(dir: string, now: () => number = Date.now): KeyValueStore {
  const file = (key: string) => path.join(dir, fileNameFor(key));
  async function read(key: string): Promise<Envelope | null> {
    try {
      return JSON.parse(await fs.readFile(file(key), "utf8")) as Envelope;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }
  return {
    async get(key) {
      assertKey(key);
      const e = await read(key);
      if (!e) return null;
      if (e.expires != null && e.expires <= now()) {
        await fs.rm(file(key), { force: true });
        return null;
      }
      return e.value;
    },
    async set(key, value, opts) {
      assertKey(key);
      assertValue(value);
      await fs.mkdir(dir, { recursive: true });
      const e: Envelope = { value, expires: opts?.ttlMs != null ? now() + opts.ttlMs : undefined };
      const tmp = file(key) + "." + process.pid + ".tmp";
      await fs.writeFile(tmp, JSON.stringify(e));
      await fs.rename(tmp, file(key));
    },
    async delete(key) {
      assertKey(key);
      await fs.rm(file(key), { force: true });
    },
    async list(prefix) {
      let names: string[];
      try {
        names = await fs.readdir(dir);
      } catch {
        return [];
      }
      const t = now();
      const out: string[] = [];
      for (const n of names) {
        if (!n.endsWith(".json")) continue;
        const key = decodeURIComponent(n.slice(0, -5).replace(/_/g, "%"));
        if (prefix && !key.startsWith(prefix)) continue;
        const e = await read(key).catch(() => null);
        if (e && (e.expires == null || e.expires > t)) out.push(key);
      }
      return out.sort();
    },
  };
}

let _default: KeyValueStore | null | undefined;

/** Directory the file store uses when it is the default. */
export function defaultWatchDir(): string {
  return process.env.GEV_WATCH_DIR || path.join(process.cwd(), "data", "watch");
}

/**
 * The process-wide store, or null when the operator turned persistence off
 * (GEV_WATCH_KV=off). Writes may still fail on a read-only file system; callers
 * treat that as "stateless" rather than an error.
 */
export function defaultKv(): KeyValueStore | null {
  if (_default !== undefined) return _default;
  const mode = (process.env.GEV_WATCH_KV || "file").toLowerCase();
  _default = mode === "off" ? null : mode === "memory" ? memoryKv() : fileKv(defaultWatchDir());
  return _default;
}

/** Tests and tools may swap the process-wide store (null = stateless, undefined = re-read env). */
export function setDefaultKv(s: KeyValueStore | null | undefined) {
  _default = s;
}
