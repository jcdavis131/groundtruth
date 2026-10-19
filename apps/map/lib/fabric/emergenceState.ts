// The live vitals of the construct field, shared by the emergence bridge
// (which computes them), the field style (which draws them) and the info
// panel (which lists them). Module state rather than a React store: the
// renderer reads it every restyle, outside React.

import type { Vitals } from "./emergence";

let current = new Map<string, Vitals>();
let key = "";
let computedAt = 0;

export function vitalsFor(id: string): Vitals | undefined {
  return current.get(id);
}

export function setVitals(next: Map<string, Vitals>, nextKey: string, at: number): boolean {
  computedAt = at;
  if (nextKey === key && next.size === current.size) {
    current = next;
    return false;
  }
  current = next;
  key = nextKey;
  return true;
}

export function vitalsComputedAt(): number {
  return computedAt;
}
