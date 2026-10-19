"use client";
// The Ask Jev panel's state: which place was asked about and the one reply.
// One question at a time: a new ask cancels the one in flight.

import { create } from "zustand";
import { askJev, targetForPick, JEV_TIMEOUT_MS, type JevTarget, type PlacePick } from "./ask";
import type { JevBundle } from "./format";

export interface JevState {
  /** What the visitor picked, in words, until the reply names it. */
  asked: string | null;
  status: "idle" | "loading" | "done" | "error";
  bundle: JevBundle | null;
  error: string | null;
  seq: number;
}

interface Store extends JevState {
  set: (s: Partial<JevState>) => void;
}

export const useJev = create<Store>()((set) => ({ asked: null, status: "idle", bundle: null, error: null, seq: 0, set: (s) => set(s) }));

let inflight: AbortController | null = null;

async function run(label: string, target: (signal: AbortSignal) => Promise<JevTarget>): Promise<void> {
  inflight?.abort();
  const ctrl = new AbortController();
  inflight = ctrl;
  const timer = setTimeout(() => ctrl.abort(), JEV_TIMEOUT_MS);
  const seq = useJev.getState().seq + 1;
  useJev.getState().set({ asked: label, status: "loading", bundle: null, error: null, seq });
  const mine = () => useJev.getState().seq === seq;
  try {
    const t = await target(ctrl.signal);
    const r = await askJev(t, ctrl.signal);
    if (!mine()) return;
    if (r.ok) useJev.getState().set({ status: "done", bundle: r.bundle });
    else useJev.getState().set({ status: "error", error: r.error });
  } catch (err) {
    if (!mine()) return;
    const aborted = err instanceof DOMException && err.name === "AbortError";
    useJev.getState().set({ status: "error", error: aborted ? "no answer within a minute" : err instanceof Error ? err.message : String(err) });
  } finally {
    clearTimeout(timer);
    if (inflight === ctrl) inflight = null;
  }
}

/** Ask about a point (a right-click on the globe, through What's here). */
export function askJevAboutPoint(lon: number, lat: number): Promise<void> {
  return run(`${lat.toFixed(4)}, ${lon.toFixed(4)}`, async () => ({ kind: "point", lon, lat }));
}

/** Ask about a ⌘K place hit: a county or state by FIPS, anything else by its point. */
export function askJevAboutPick(name: string, hit: PlacePick): Promise<void> {
  return run(name, (signal) => targetForPick(hit, signal));
}

export function closeJev(): void {
  inflight?.abort();
  inflight = null;
  const seq = useJev.getState().seq + 1;
  useJev.getState().set({ asked: null, status: "idle", bundle: null, error: null, seq });
}
