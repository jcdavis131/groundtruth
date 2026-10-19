"use client";
// The minimal renderer contract the globe drives per layer.
//
// LayerRenderer (lib/globe/renderer.ts) is the GeoJSON/primitive workhorse.
// FlowRenderer (lib/globe/flowRenderer.ts) draws animated particle fields on a
// canvas overlay instead. Both satisfy this interface, so LayerHost, the
// registry, the label arbiter and the per-frame tick loop can treat them the
// same. Flow-specific methods live on FlowRenderer itself, not here.

import type * as CesiumNS from "cesium";
import type { TileHealth } from "./tiles";
import type { LayerCollection, LayerFeature, LayerId } from "@/lib/layers/types";

export interface LayerRendererLike {
  readonly layer: LayerId;
  /** Live feature count (0 for renderers that draw no features). */
  readonly size: number;
  show: boolean;
  setLabelsEnabled(on: boolean): void;
  setTileAlpha(alpha: number | null): void;
  onTileHealth?: (h: TileHealth) => void;
  update(collection: LayerCollection, meta?: Record<string, unknown>): void;
  destroy(): void;
  /** Per-frame advance, driven from CesiumGlobe's scene.preUpdate. */
  tick(timeMs: number): void;
  collectLabels(out: unknown[]): void;
  applyLabelMask(allowed: Set<string> | null): void;
  refreshSelectedLines(): void;
  /** Re-apply the style to features (no-op for renderers without features). */
  restyle(ids?: Iterable<string>): void;
  setHover(id: string | null): void;
  setSelected(id: string | null): void;
  getFeature(id: string): LayerFeature | undefined;
  getPosition(id: string): CesiumNS.Cartesian3 | undefined;
  features(): Iterable<LayerFeature>;
}
