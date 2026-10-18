// State for the constructs HUD: where the stack is anchored, whether the rail
// is open, the second place of a comparison, and the Ascend flight.
//
// The stack normally follows the camera target. Focusing a construct flies
// the camera to fit it, which would move the target and re-ask the stack
// somewhere else; so focusing (and comparing, and ascending) pins the stack to
// the point it was asked about until the pin is released. No Cesium here: the
// constructs layer reads the pin while fetching, on the server as well.

import { create } from "zustand";
import type { Fabric } from "./types";

export interface LonLat {
  lon: number;
  lat: number;
}

export type CompareStatus = "idle" | "loading" | "ready" | "error";

interface StrataState {
  /** The point the stack is anchored to; null while it follows the camera target. */
  pin: LonLat | null;
  setPin: (pin: LonLat | null) => void;
  /** The strata rail (desktop side rail, phone bottom sheet). */
  railOpen: boolean;
  setRailOpen: (open: boolean) => void;

  /** Place B of a comparison; A is the pinned stack. */
  compare: LonLat | null;
  compareFabric: Fabric | null;
  compareStatus: CompareStatus;
  compareError: string | null;
  /** Waiting for a tap on the globe to drop pin B. */
  picking: boolean;
  setPicking: (on: boolean) => void;
  setCompare: (p: LonLat | null) => Promise<void>;
}

let compareSeq = 0;

/** Snap to the same 0.001° grid the fabric route caches on, so a link and a tap agree. */
export function snapPoint(p: LonLat): LonLat {
  return { lon: Math.round(p.lon * 1000) / 1000, lat: Math.round(p.lat * 1000) / 1000 };
}

export const useStrata = create<StrataState>()((set) => ({
  pin: null,
  setPin: (pin) => set({ pin: pin ? snapPoint(pin) : null }),
  railOpen: true,
  setRailOpen: (railOpen) => set({ railOpen }),

  compare: null,
  compareFabric: null,
  compareStatus: "idle",
  compareError: null,
  picking: false,
  setPicking: (picking) => set({ picking }),
  setCompare: async (p) => {
    const seq = ++compareSeq;
    if (!p) {
      set({ compare: null, compareFabric: null, compareStatus: "idle", compareError: null, picking: false });
      return;
    }
    const pt = snapPoint(p);
    set({ compare: pt, compareStatus: "loading", compareError: null, picking: false });
    try {
      const res = await fetch(`/api/fabric?op=stack&lon=${pt.lon.toFixed(3)}&lat=${pt.lat.toFixed(3)}&geometry=1`);
      const body = (await res.json()) as { data?: Fabric; error?: string };
      if (seq !== compareSeq) return;
      if (!res.ok || !body.data) throw new Error(body.error ?? `fabric ${res.status}`);
      set({ compareFabric: body.data, compareStatus: "ready" });
    } catch (err) {
      if (seq !== compareSeq) return;
      set({ compareFabric: null, compareStatus: "error", compareError: err instanceof Error ? err.message : String(err) });
    }
  },
}));
