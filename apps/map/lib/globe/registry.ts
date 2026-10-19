"use client";
// Module-level registry of live renderers so the picking / follow / search
// code can reach any layer without prop drilling through React.

import type { LayerId, LayerFeature } from "@/lib/layers/types";
import type { LayerRendererLike } from "./rendererTypes";

const renderers = new Map<LayerId, LayerRendererLike>();

export function registerRenderer(id: LayerId, r: LayerRendererLike) {
  renderers.set(id, r);
}

export function unregisterRenderer(id: LayerId) {
  renderers.delete(id);
}

export function getRenderer(id: LayerId): LayerRendererLike | undefined {
  return renderers.get(id);
}

export function allRenderers(): IterableIterator<LayerRendererLike> {
  return renderers.values();
}

/** Every loaded feature across enabled layers (for search). */
export function allFeatures(): LayerFeature[] {
  const out: LayerFeature[] = [];
  for (const r of renderers.values()) {
    if (!r.show) continue;
    for (const f of r.features()) out.push(f);
  }
  return out;
}
