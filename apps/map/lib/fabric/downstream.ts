// Downstream: follow the water from a point to where it leaves the land.
//
// Water is the physical flow that links constructs. Every HUC-12 in the
// Watershed Boundary Dataset names the HUC-12 it drains to (ToHUC), or a
// terminal (OCEAN, CLOSED BASIN, CANADA, MEXICO). Walking that chain from the
// unit under a point gives the sequence of watersheds a drop of rain there
// passes through, which physical gauges sit along it, and where it ends.
//
// The walk loads one basin table at a time (every HUC-12 in a HUC-4 with its
// ToHUC, attributes only) through an injected loader, so it is testable
// without the network and cheap to cache: a basin table changes only when WBD
// is republished. WBD answers a cold query in tens of seconds, so a walk stops
// at a time budget and hands back `next`; the caller continues from there.
// Outlines (and so centroids and the drawn path) come separately, in batches.

import { haversineKm, ringCentroid, roundRings } from "./geo";
import type { ArcQueryResponse } from "./field";

export interface BasinRow {
  huc12: string;
  to: string;
  name: string;
  areaKm2?: number;
  centroid?: [number, number];
}

export type BasinTable = Map<string, BasinRow>;

export interface DownstreamStep extends BasinRow {
  /** Hop number from the start, 0 = the unit under the point. */
  hop: number;
}

export interface Downstream {
  start: string;
  steps: DownstreamStep[];
  /** How the chain ends: "ocean", "closed basin", "canada", "mexico", "unknown" when a unit is missing from WBD, or "" while truncated. */
  terminal: string;
  totalAreaKm2: number;
  /** HUC-4 basins the chain passed through, in order. */
  basins: string[];
  /** true when the hop cap or the time budget stopped the walk before a terminal. */
  truncated: boolean;
  /** Where to continue from when truncated (the next HUC-12 to visit). */
  next?: string;
}

/** What /api/fabric?op=downstream answers. */
export interface DownstreamResult extends Downstream {
  /** The point asked about; absent when the walk continued `from` a HUC-12. */
  point?: { lon: number; lat: number };
  startName: string;
}

/** Sum of straight lines between successive centroids, km. Not river length. */
export function centroidPathKm(centroids: Array<[number, number] | undefined>): number {
  let km = 0;
  let prev: [number, number] | undefined;
  for (const c of centroids) {
    if (c && prev) km += haversineKm(prev, c);
    if (c) prev = c;
  }
  return Math.round(km);
}

/** Every HUC-12 in one HUC-4 from a WBD layer-6 query answer. */
export function parseBasinTable(res: ArcQueryResponse): BasinTable {
  const t: BasinTable = new Map();
  for (const f of res.features ?? []) {
    const a: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(f.attributes ?? {})) a[k.toLowerCase()] = v;
    const huc12 = a.huc12 == null ? "" : String(a.huc12);
    if (!/^\d{12}$/.test(huc12)) continue;
    const rings = f.geometry?.rings?.length ? roundRings(f.geometry.rings, 3) : undefined;
    const area = Number(a.areasqkm);
    t.set(huc12, {
      huc12,
      to: a.tohuc == null ? "" : String(a.tohuc).trim(),
      name: a.name == null ? huc12 : String(a.name),
      areaKm2: Number.isFinite(area) ? area : undefined,
      centroid: rings ? (ringCentroid(rings) ?? undefined) : undefined,
    });
  }
  return t;
}

/** The bundled drainage table (scripts/wbd-data.mjs): per HUC-4, "huc12>tohuc" pairs joined with "|". */
export interface BundledDrainage {
  pulled: string | null;
  complete: boolean;
  basins: Record<string, string>;
}

/** One basin from the bundle, or null when the bundle does not carry it. Names are filled in later from the outline call. */
export function basinFromBundle(bundle: BundledDrainage, huc4: string): BasinTable | null {
  const raw = bundle.basins[huc4];
  if (raw == null) return null;
  const t: BasinTable = new Map();
  for (const pair of raw.split("|")) {
    const i = pair.indexOf(">");
    if (i !== 12) continue;
    const huc12 = pair.slice(0, 12);
    t.set(huc12, { huc12, to: pair.slice(13), name: huc12 });
  }
  return t;
}

export interface WalkOptions {
  maxHops?: number;
  /**
   * Do not start loading a basin once this many ms have passed; stop and hand
   * back `next` instead. Hops inside an already-loaded basin are free.
   */
  budgetMs?: number;
  now?: () => number;
}

/** Walk ToHUC from `start` until a terminal, loading basin tables as the chain enters them. */
export async function walkDownstream(start: string, loadBasin: (huc4: string) => Promise<BasinTable>, opts: WalkOptions = {}): Promise<Downstream> {
  const maxHops = opts.maxHops ?? 800;
  const now = opts.now ?? Date.now;
  const t0 = now();
  const tables = new Map<string, BasinTable>();
  const basins: string[] = [];
  const steps: DownstreamStep[] = [];
  const seen = new Set<string>();
  let cur = start;
  let terminal = "unknown";
  let truncated = false;
  let next: string | undefined;
  while (true) {
    if (steps.length >= maxHops) {
      truncated = true;
      terminal = "";
      next = cur;
      break;
    }
    if (seen.has(cur)) {
      terminal = "loop in WBD ToHUC";
      break;
    }
    seen.add(cur);
    const huc4 = cur.slice(0, 4);
    let table = tables.get(huc4);
    if (!table && steps.length && opts.budgetMs != null && now() - t0 > opts.budgetMs) {
      truncated = true;
      terminal = "";
      next = cur;
      break;
    }
    if (!table) {
      try {
        table = await loadBasin(huc4);
      } catch (err) {
        // A basin that will not load ends this leg where it stands; the
        // caller continues from `next` (the upstream is often warm by then).
        if (!steps.length) throw err;
        truncated = true;
        terminal = "";
        next = cur;
        break;
      }
      tables.set(huc4, table);
    }
    if (basins[basins.length - 1] !== huc4) basins.push(huc4);
    const row = table.get(cur);
    if (!row) break;
    steps.push({ ...row, hop: steps.length });
    if (!/^\d{12}$/.test(row.to)) {
      // WBD spells terminals a few ways (CLOSED BASIN, CLOSED_BASIN, Canada).
      terminal = row.to ? row.to.toLowerCase().replace(/_/g, " ") : "unknown";
      break;
    }
    cur = row.to;
  }
  return {
    start,
    steps,
    terminal,
    totalAreaKm2: Math.round(steps.reduce((s, x) => s + (x.areaKm2 ?? 0), 0)),
    basins,
    truncated,
    ...(next ? { next } : {}),
  };
}
