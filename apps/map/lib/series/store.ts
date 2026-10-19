// SeriesStore implementations and the process-wide default store.
//
//   memoryStore()           tests and ephemeral serverless processes
//   fileStore(dir)          one JSON file per series under `dir`; the snapshot
//                           cron commits this directory so history is free
//   defaultStore()          fileStore(GEV_SERIES_DIR or data/series), layered
//                           over the read-only raw adapter when
//                           GEV_SERIES_RAW_BASE is set (lib/series/githubRaw.ts)
//
// Adding a remote adapter (Cloudflare KV, Vercel Blob, Postgres): implement
// SeriesStore and return it from defaultStore() behind an env variable.

import { promises as fs } from "node:fs";
import path from "node:path";
import type { Point, Series, SeriesMeta, SeriesQuery, SeriesStore } from "./types";
import { layeredStore, rawStore } from "./githubRaw";

/** Series without its points: the metadata a listing returns. */
export function stripPoints(s: Series): SeriesMeta {
  const meta: Series = { ...s };
  delete (meta as Partial<Series>).points;
  return meta;
}

export function mergePoints(existing: Point[], incoming: Point[]): Point[] {
  const byT = new Map<number, Point>();
  for (const p of existing) byT.set(p.t, p);
  for (const p of incoming) byT.set(p.t, p);
  return [...byT.values()].sort((a, b) => a.t - b.t);
}

export function applyQuery(points: Point[], q?: SeriesQuery): Point[] {
  let out = points;
  if (q?.from != null) out = out.filter((p) => p.t >= q.from!);
  if (q?.to != null) out = out.filter((p) => p.t <= q.to!);
  if (q?.limit != null && out.length > q.limit) out = out.slice(out.length - q.limit);
  return out;
}

export function memoryStore(): SeriesStore {
  const series = new Map<string, Series>();
  return {
    async append(meta, points) {
      const cur = series.get(meta.id);
      series.set(meta.id, { ...meta, points: mergePoints(cur?.points ?? [], points) });
    },
    async get(id, q) {
      const s = series.get(id);
      return s ? { ...s, points: applyQuery(s.points, q) } : null;
    },
    async list(prefix) {
      return [...series.values()].filter((s) => !prefix || s.id.startsWith(prefix)).map((s) => stripPoints(s));
    },
    async remove(id) {
      series.delete(id);
    },
  };
}

/** Series ids may contain ':' and '/', which are not file-system safe. */
export function fileNameFor(id: string): string {
  return encodeURIComponent(id).replace(/%/g, "_") + ".json";
}

export function fileStore(dir: string): SeriesStore {
  const file = (id: string) => path.join(dir, fileNameFor(id));
  const locks = new Map<string, Promise<void>>();
  async function withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = locks.get(id) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((r) => (release = r));
    locks.set(id, prev.then(() => next));
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (locks.get(id) === next) locks.delete(id);
    }
  }
  async function read(id: string): Promise<Series | null> {
    try {
      return JSON.parse(await fs.readFile(file(id), "utf8")) as Series;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }
  return {
    async append(meta, points) {
      await withLock(meta.id, async () => {
        await fs.mkdir(dir, { recursive: true });
        const cur = await read(meta.id);
        const next: Series = { ...meta, points: mergePoints(cur?.points ?? [], points) };
        const tmp = file(meta.id) + ".tmp";
        await fs.writeFile(tmp, JSON.stringify(next));
        await fs.rename(tmp, file(meta.id));
      });
    },
    async get(id, q) {
      const s = await read(id);
      return s ? { ...s, points: applyQuery(s.points, q) } : null;
    },
    async list(prefix) {
      let names: string[];
      try {
        names = await fs.readdir(dir);
      } catch {
        return [];
      }
      const out: SeriesMeta[] = [];
      for (const n of names) {
        if (!n.endsWith(".json")) continue;
        const id = decodeURIComponent(n.slice(0, -5).replace(/_/g, "%"));
        if (prefix && !id.startsWith(prefix)) continue;
        const s = await read(id);
        if (s) {
          out.push(stripPoints(s));
        }
      }
      return out.sort((a, b) => a.id.localeCompare(b.id));
    },
    async remove(id) {
      await fs.rm(file(id), { force: true });
    },
  };
}

let _default: SeriesStore | null = null;

/** Directory the file store uses when it is the default. */
export function defaultSeriesDir(): string {
  return process.env.GEV_SERIES_DIR || path.join(process.cwd(), "data", "series");
}

export function defaultStore(): SeriesStore {
  if (_default) return _default;
  const files = fileStore(defaultSeriesDir());
  // Hosts whose filesystem is not the repo (Vercel) read the committed
  // snapshots over HTTP; the file store stays primary so local writes and a
  // fresh checkout still win. See lib/series/githubRaw.ts.
  const rawBase = process.env.GEV_SERIES_RAW_BASE?.trim();
  _default = rawBase ? layeredStore(files, rawStore(rawBase, { name: "GEV_SERIES_RAW_BASE" })) : files;
  return _default;
}

/** Tests and tools may swap the process-wide store. */
export function setDefaultStore(s: SeriesStore | null) {
  _default = s;
}
