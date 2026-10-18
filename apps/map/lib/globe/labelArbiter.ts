"use client";
// Runs the label budget (lib/globe/labelBudget.ts) over every layer at once:
// gathers the labels each renderer wants, projects them to the screen, keeps
// the ones that fit and hides the rest. Called from the globe's frame loop a
// few times a second; the HUD chrome that covers the globe marks itself with
// data-hud-occluder so no label is placed under a panel.

import type * as CesiumNS from "cesium";
import { getCesium } from "./cesium";
import { labelBudget, placeLabels, type LabelCandidate, type Rect } from "./labelBudget";
import type { LabelSlot } from "./renderer";
import type { LayerRendererLike } from "./rendererTypes";

const scratch: { c2?: CesiumNS.Cartesian2 } = {};

/** Screen rectangles of HUD chrome that sits over the globe. */
function occluders(): Rect[] {
  if (typeof document === "undefined") return [];
  const out: Rect[] = [];
  document.querySelectorAll<HTMLElement>("[data-hud-occluder]").forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) out.push({ x: r.left, y: r.top, w: r.width, h: r.height });
  });
  return out;
}

export function arbitrateLabels(viewer: CesiumNS.Viewer, renderers: Iterable<LayerRendererLike>): void {
  const C = getCesium();
  const scene = viewer.scene;
  const canvas = scene.canvas;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return;
  const list = [...renderers];
  const slots: LabelSlot[] = [];
  for (const r of list) r.collectLabels(slots);
  const cands: LabelCandidate[] = [];
  for (const s of slots) {
    const p = C.SceneTransforms.worldToWindowCoordinates(scene, s.pos, scratch.c2 ?? (scratch.c2 = new C.Cartesian2()));
    if (!p) continue;
    cands.push({ key: s.key, x: p.x, y: p.y, text: s.text, priority: s.priority, pinned: s.pinned, offset: s.offset });
  }
  const allowed = placeLabels(cands, { width, height, blocked: occluders(), budget: labelBudget(width, height) });
  for (const r of list) r.applyLabelMask(allowed);
}
