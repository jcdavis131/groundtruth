"use client";
// The browser side of the strata rail: read the live stack off the constructs
// layer, join what is loaded on the globe into a construct, focus a construct
// (select it, pin the stack, frame it), and the Ascend flight.

import { create } from "zustand";
import type { LayerFeature } from "@/lib/layers/types";
import { LAYER_BY_ID } from "@/lib/layers";
import { allRenderers, getRenderer } from "@/lib/globe/registry";
import { flyToConstruct, prefersReducedMotion } from "@/lib/globe/strataCamera";
import { useGlobe } from "@/lib/store/globe";
import { useMobile } from "@/lib/mobile/store";
import { isMobileViewport } from "@/lib/hooks/useIsMobile";
import { bboxContains, ringsBbox, ringsContain } from "./geo";
import { joinInside, pointOf } from "./join";
import { conditionVitals } from "./emergence";
import { conditionOf } from "./normalsClient";
import { ascendSteps, statsFromJoin, strataCaption, type InsideStats } from "./strata";
import { useStrata } from "./strataStore";
import type { ConstructExtra, ConstructNode, Fabric } from "./types";

/** The stack the constructs layer holds now (the "here" anchor carries it). */
export function currentFabric(): Fabric | null {
  const here = getRenderer("constructs")?.getFeature("here");
  return (here?.properties.extra as ConstructExtra | undefined)?.fabric ?? null;
}

export function constructFeature(id: string): LayerFeature | undefined {
  return getRenderer("constructs")?.getFeature(id);
}

/** Every physical feature loaded on the globe now (constructs, the field and warnings are frames, not things). */
export function loadedFeatures(): LayerFeature[] {
  const out: LayerFeature[] = [];
  for (const r of allRenderers()) {
    if (!r.show || r.layer === "constructs" || r.layer === "field" || r.layer === "alerts") continue;
    for (const f of r.features()) out.push(f);
  }
  return out;
}

/** Live NWS warnings whose anchor lies inside `rings`; null when the warnings layer is off (unknown, not zero). */
export function warningsInside(rings: number[][][]): number | null {
  const r = getRenderer("alerts");
  if (!r?.show || !useGlobe.getState().layers.alerts) return null;
  const box = ringsBbox(rings);
  if (!box) return 0;
  let n = 0;
  for (const f of r.features()) {
    const p = pointOf(f);
    if (p && bboxContains(box, p[0], p[1]) && ringsContain(rings, p[0], p[1])) n++;
  }
  return n;
}

/** What is inside a construct right now: counts by layer, warnings, and the rivers' condition. */
export function insideStats(node: ConstructNode, features: LayerFeature[] = loadedFeatures()): InsideStats | null {
  if (!node.rings?.length) return null;
  const joined = joinInside(node.rings, features);
  const gauges = (joined.get("water") ?? []).filter((f) => /gauge/.test(f.properties.kind ?? ""));
  const conds = gauges.map(conditionOf).filter((x): x is NonNullable<typeof x> => !!x);
  const c = conds.length ? conditionVitals(conds).condition : null;
  return statsFromJoin(joined, warningsInside(node.rings), c ? { median: c.median, rated: c.rated } : null);
}

export function captionFor(node: ConstructNode): string {
  const labels = Object.fromEntries(Object.values(LAYER_BY_ID).map((d) => [d.id, d.label]));
  return strataCaption(node, insideStats(node), labels);
}

/**
 * Focus a construct: select it (the globe draws its outline on the ground),
 * pin the stack to the point it was asked about, and frame it. On a phone the
 * sheet drops to its peek height so the frame is not under it.
 */
export function focusConstruct(id: string, opts: { fly?: boolean; instant?: boolean; durationS?: number } = {}): boolean {
  const f = constructFeature(id);
  const x = f?.properties.extra as ConstructExtra | undefined;
  if (!f || !x?.node) return false;
  const fabric = currentFabric();
  const strata = useStrata.getState();
  if (fabric && !strata.pin) strata.setPin({ lon: fabric.point.lon, lat: fabric.point.lat });
  useGlobe.getState().select({ layer: "constructs", id }, f);
  if (opts.fly !== false) flyToConstruct(x.node, x.ground, { instant: opts.instant, durationS: opts.durationS });
  if (isMobileViewport()) {
    useMobile.getState().setSheet("peek");
    // Peek shows the top of the sheet: the rail's header row, which now names the focus.
    if (typeof document !== "undefined") document.querySelector(".mobile-sheet-body")?.scrollTo({ top: 0 });
  }
  return true;
}

export function clearFocus(): void {
  const s = useGlobe.getState();
  if (s.selected?.layer === "constructs") s.select(null);
}

// ---------------------------------------------------------------------------
// Ascend: a Powers of Ten flight up through the stack.

export interface AscendState {
  active: boolean;
  /** Construct ids, smallest first. */
  steps: string[];
  index: number;
  /** When the current step began (ms). */
  startedAt: number;
  /** Reduced motion: no flight and no autoplay; the visitor steps through. */
  manual: boolean;
  start: () => boolean;
  go: (i: number) => void;
  next: () => void;
  prev: () => void;
  stop: () => void;
}

export const useAscend = create<AscendState>()((set, get) => ({
  active: false,
  steps: [],
  index: 0,
  startedAt: 0,
  manual: false,
  start: () => {
    const fabric = currentFabric();
    if (!fabric?.nodes.length) return false;
    const steps = ascendSteps(fabric.nodes).map((n) => n.id);
    const g = useGlobe.getState();
    // One thing drives the camera at a time.
    if (g.tour.active) g.setTour({ active: false, paused: false });
    set({ active: true, steps, index: 0, manual: prefersReducedMotion() });
    get().go(0);
    g.pushLog({ level: "info", text: `Ascend: ${steps.length} constructs, smallest to largest.` });
    return true;
  },
  go: (i) => {
    const { steps, manual } = get();
    if (!steps.length) return;
    const index = Math.max(0, Math.min(steps.length - 1, i));
    set({ index, startedAt: Date.now() });
    focusConstruct(steps[index], { instant: manual, durationS: 2.6 });
  },
  next: () => {
    const { index, steps } = get();
    if (index >= steps.length - 1) {
      set({ active: false });
      return;
    }
    get().go(index + 1);
  },
  prev: () => get().go(get().index - 1),
  stop: () => set({ active: false }),
}));
