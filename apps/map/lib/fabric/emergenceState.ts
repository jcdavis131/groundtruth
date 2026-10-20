// The live vitals of the construct field, shared by the emergence bridge
// (which computes them), the field style (which draws them) and the info
// panel (which lists them). Module state rather than a React store: the
// renderer reads it every restyle, outside React.

import type { Vitals } from "./emergence";

let current = new Map<string, Vitals>();
let key = "";
let computedAt = 0;
let names = new Map<string, string>();
const listeners = new Set<() => void>();

/** The live vitals map. The same reference until setVitals runs again. */
export function getVitals(): Map<string, Vitals> {
  return current;
}

export function subscribeVitals(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** The names of the units the vitals are for, so a legend can say which unit sets the top of the ramp. */
export function setUnitNames(next: Iterable<[string, string]>): void {
  names = new Map(next);
}

export function unitName(id: string): string {
  return names.get(id) ?? id;
}

export function vitalsFor(id: string): Vitals | undefined {
  return current.get(id);
}

export function setVitals(next: Map<string, Vitals>, nextKey: string, at: number): boolean {
  computedAt = at;
  const same = nextKey === key && next.size === current.size;
  current = next;
  key = nextKey;
  for (const fn of listeners) fn();
  return !same;
}

export function vitalsComputedAt(): number {
  return computedAt;
}
