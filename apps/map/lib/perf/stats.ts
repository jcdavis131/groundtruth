// ?perf=1 frame statistics. Pure functions, no DOM: the overlay feeds them
// requestAnimationFrame deltas (milliseconds between frames).

/** One frame at 60 Hz. A delta over this is a missed frame. */
export const FRAME_BUDGET_MS = 16.7;

/**
 * A delta longer than this is the tab being hidden or the device sleeping
 * (rAF stops), not a slow frame, so it is left out of the stats.
 */
export const MAX_DELTA_MS = 1000;

/**
 * The p-th percentile (0-100) of an ascending-sorted array, by linear
 * interpolation between the closest ranks. null for an empty array.
 */
export function percentile(sorted: readonly number[], p: number): number | null {
  const n = sorted.length;
  if (n === 0) return null;
  if (n === 1) return sorted[0];
  const q = Math.min(100, Math.max(0, p)) / 100;
  const rank = q * (n - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

export interface FrameStats {
  /** Frames counted (deltas kept after dropping hidden-tab gaps). */
  frames: number;
  /** Deltas dropped as longer than MAX_DELTA_MS. */
  dropped: number;
  p50: number | null;
  p95: number | null;
  /** Share (0-1) of counted frames over FRAME_BUDGET_MS. null with no frames. */
  overBudget: number | null;
  mean: number | null;
}

/** p50, p95 and the share of frames over budget, from rAF deltas in ms. */
export function frameStats(deltas: readonly number[]): FrameStats {
  const kept: number[] = [];
  let dropped = 0;
  for (const d of deltas) {
    if (!Number.isFinite(d) || d < 0) continue;
    if (d > MAX_DELTA_MS) dropped++;
    else kept.push(d);
  }
  if (kept.length === 0) return { frames: 0, dropped, p50: null, p95: null, overBudget: null, mean: null };
  kept.sort((a, b) => a - b);
  let over = 0;
  let sum = 0;
  for (const d of kept) {
    if (d > FRAME_BUDGET_MS) over++;
    sum += d;
  }
  return {
    frames: kept.length,
    dropped,
    p50: percentile(kept, 50),
    p95: percentile(kept, 95),
    overBudget: over / kept.length,
    mean: sum / kept.length,
  };
}

/** A fixed-size ring of the latest numbers (the rolling frame window). */
export class Ring {
  private buf: Float64Array;
  private next = 0;
  private filled = 0;
  constructor(readonly capacity: number) {
    this.buf = new Float64Array(Math.max(1, capacity));
  }
  push(x: number): void {
    this.buf[this.next] = x;
    this.next = (this.next + 1) % this.buf.length;
    if (this.filled < this.buf.length) this.filled++;
  }
  get size(): number {
    return this.filled;
  }
  /** Oldest first. */
  values(): number[] {
    const out: number[] = [];
    const start = this.filled < this.buf.length ? 0 : this.next;
    for (let i = 0; i < this.filled; i++) out.push(this.buf[(start + i) % this.buf.length]);
    return out;
  }
  clear(): void {
    this.next = 0;
    this.filled = 0;
  }
}
