// Upstream: everything that drains to a place.
//
// The downstream walk follows one chain of ToHUC links to the sea. The same
// links read backwards give a tree: every HUC-12 whose water passes through
// the unit under a point. That set is the catchment, the land whose rain and
// runoff reach the point's subwatershed outlet, and so the land whose gauges
// read what is coming.
//
// A big catchment is tens of thousands of HUC-12s (the Mississippi at the
// Gulf is about a third of the country), far too many to draw one by one. The
// WBD codes nest (a HUC-8 is the first eight digits of its HUC-12s), so the
// set is compacted to its smallest cover: wherever every HUC-12 of a HUC-10,
// HUC-8, HUC-6, HUC-4 or region is upstream, the whole unit stands in for
// them. The cover's outlines and published areas then describe the catchment
// exactly, at the coarsest scale that is still true.
//
// Built from the bundled national drainage table, so it needs no upstream
// call; only the cover's outlines are fetched.

import type { BundledDrainage } from "./downstream";

export const HUC_LEVELS = [2, 4, 6, 8, 10, 12] as const;
export type HucLevel = (typeof HUC_LEVELS)[number];

export interface DrainageIndex {
  /** HUC-12 -> the HUC-12s that drain straight into it. */
  up: Map<string, string[]>;
  /** How many HUC-12s each 2-, 4-, 6-, 8- and 10-digit prefix holds, nationally. */
  countByPrefix: Map<string, number>;
  size: number;
}

export interface CoverUnit {
  code: string;
  level: HucLevel;
}

export interface Upstream {
  start: string;
  /** HUC-12s upstream of the start's outlet, the start included. */
  huc12s: number;
  /** The smallest set of whole WBD units that is exactly the catchment. */
  cover: CoverUnit[];
  /** Cover units by level: how many regions, subregions, basins, … */
  byLevel: Partial<Record<HucLevel, number>>;
  /** HUC-4 basins the catchment reaches into. */
  basins: string[];
}

export function buildIndex(bundle: BundledDrainage): DrainageIndex {
  const up = new Map<string, string[]>();
  const countByPrefix = new Map<string, number>();
  let size = 0;
  for (const raw of Object.values(bundle.basins)) {
    for (const pair of raw.split("|")) {
      if (pair.indexOf(">") !== 12) continue;
      const code = pair.slice(0, 12);
      const to = pair.slice(13);
      size++;
      for (const n of [2, 4, 6, 8, 10]) {
        const p = code.slice(0, n);
        countByPrefix.set(p, (countByPrefix.get(p) ?? 0) + 1);
      }
      if (/^\d{12}$/.test(to) && to !== code) {
        const list = up.get(to);
        if (list) list.push(code);
        else up.set(to, [code]);
      }
    }
  }
  return { up, countByPrefix, size };
}

/** Every HUC-12 whose water reaches `start` (breadth-first over the reversed ToHUC links), `start` included. */
export function upstreamOf(start: string, idx: Pick<DrainageIndex, "up">): Set<string> {
  const seen = new Set<string>([start]);
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    for (const u of idx.up.get(queue[i]) ?? []) {
      if (seen.has(u)) continue;
      seen.add(u);
      queue.push(u);
    }
  }
  return seen;
}

/**
 * The smallest set of whole units whose HUC-12s are exactly `set`: each HUC-12
 * is represented by its coarsest enclosing unit that lies wholly in the set,
 * or by itself when none does.
 */
export function minimalCover(set: Set<string>, countByPrefix: Map<string, number>): CoverUnit[] {
  const inSet = new Map<string, number>();
  for (const code of set)
    for (const n of [2, 4, 6, 8, 10]) {
      const p = code.slice(0, n);
      inSet.set(p, (inSet.get(p) ?? 0) + 1);
    }
  const out = new Map<string, CoverUnit>();
  for (const code of set) {
    let unit: CoverUnit = { code, level: 12 };
    for (const n of [2, 4, 6, 8, 10] as const) {
      const p = code.slice(0, n);
      const total = countByPrefix.get(p);
      if (total != null && inSet.get(p) === total) {
        unit = { code: p, level: n };
        break;
      }
    }
    out.set(unit.code, unit);
  }
  return [...out.values()].sort((a, b) => a.level - b.level || a.code.localeCompare(b.code));
}

export function upstream(start: string, idx: DrainageIndex): Upstream | null {
  if (!/^\d{12}$/.test(start) || !idx.countByPrefix.has(start.slice(0, 10))) return null;
  const set = upstreamOf(start, idx);
  const cover = minimalCover(set, idx.countByPrefix);
  const byLevel: Partial<Record<HucLevel, number>> = {};
  for (const u of cover) byLevel[u.level] = (byLevel[u.level] ?? 0) + 1;
  const basins = [...new Set([...set].map((c) => c.slice(0, 4)))].sort();
  return { start, huc12s: set.size, cover, byLevel, basins };
}

/** WBD's names for the unit at each level. */
export const LEVEL_NAMES: Record<HucLevel, [string, string]> = {
  2: ["region", "regions"],
  4: ["subregion", "subregions"],
  6: ["basin", "basins"],
  8: ["subbasin", "subbasins"],
  10: ["watershed", "watersheds"],
  12: ["subwatershed", "subwatersheds"],
};

/** "2 regions, 3 subbasins and 1 subwatershed" */
export function describeCover(byLevel: Partial<Record<HucLevel, number>>): string {
  const parts = HUC_LEVELS.filter((l) => byLevel[l]).map((l) => `${byLevel[l]} ${LEVEL_NAMES[l][byLevel[l] === 1 ? 0 : 1]}`);
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
