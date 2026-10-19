"use client";
// Generic, primitive-based renderer for one data layer.
//
// Every layer's GeoJSON goes through the same LayerRenderer: point features
// become billboards (oriented glyphs) or point primitives, optional per-feature
// polylines are drawn, labels appear on hover/selection (or for everything when
// the layer is small), and a LayerStyle may supply a time-dependent position
// so satellites / simulated cars / launch vehicles move without re-fetching.
//
// Primitives are used instead of Entities because a few thousand entities
// updating every frame would crawl; PointPrimitiveCollection and
// BillboardCollection are designed for exactly this.

import type * as CesiumNS from "cesium";
import type { MultiLineString, MultiPolygon, Polygon } from "geojson";
import { getCesium } from "./cesium";
import { getGlow, getIcon, iconKey, type IconKind } from "./icons";
import { DEG } from "./geo";
import { LAYER_LABEL_PRIORITY } from "./labelBudget";
import { addOrdered, createTileLayer, inHeightGate, removeOrdered, type TileHealth, type TileSpec } from "./tiles";
import type { LayerCollection, LayerFeature, LayerId } from "@/lib/layers/types";

export type LonLatAlt = [lon: number, lat: number, alt: number];

export interface StyledLine {
  positions: LonLatAlt[];
  color?: string;
  width?: number;
  /** 0..1 alpha */
  alpha?: number;
  dashed?: boolean;
  glow?: boolean;
}

export interface StyledPolygon {
  /** Outer ring first, then holes; each ring a list of [lon, lat]. */
  rings: number[][][];
  color?: string;
  /** 0..1 alpha */
  alpha?: number;
}

export interface OverlaySpec {
  image: HTMLCanvasElement;
  west: number;
  south: number;
  east: number;
  north: number;
  alpha?: number;
}

export interface LayerStyle {
  color: string;
  /** Return a glyph kind for a billboard, or null to draw a plain point. */
  icon?: (f: LayerFeature) => IconKind | null;
  iconSize?: number;
  pointSize?: (f: LayerFeature) => number;
  colorFor?: (f: LayerFeature) => string;
  label?: (f: LayerFeature) => string;
  /** Show labels for every feature while the layer has at most this many. */
  labelMax?: number;
  /** Dynamic position at mission time (ms). Return null to hide the feature. */
  position?: (f: LayerFeature, timeMs: number) => LonLatAlt | null;
  headingAt?: (f: LayerFeature, timeMs: number) => number | undefined;
  /** Polylines drawn for every feature (e.g. launch trajectories, road network). */
  lines?: (f: LayerFeature, timeMs: number) => StyledLine[] | null;
  /** Polylines drawn only for the selected feature (e.g. an orbit). */
  selectedLines?: (f: LayerFeature, timeMs: number) => StyledLine[] | null;
  /** Record a position history and draw it as a trail for the selected feature. */
  trail?: boolean;
  /** Refresh cadence for dynamic positions in ms. 0 = every frame. */
  tickMs?: number;
  /** Scale glyphs down when far away. [near, nearScale, far, farScale] */
  scaleByDistance?: [number, number, number, number];
  /** Fade glyphs when far away. [near, nearAlpha, far, farAlpha] */
  translucencyByDistance?: [number, number, number, number];
  /** Extra per-feature gate for labels (on top of hover / selection / labelMax). */
  labelWhen?: (f: LayerFeature, timeMs: number) => boolean;
  /** Features that keep a label regardless of labelMax (major rivers, matched chips). */
  labelAlways?: (f: LayerFeature) => boolean;
  /** Importance of a feature's label within its layer, 0..20; the label budget keeps higher ones first. */
  labelPriority?: (f: LayerFeature) => number;
  /** Pixel offset of standing labels from the anchor; default [14, -12]. Lets two layers label one point. */
  labelOffset?: [number, number];
  /** Filled ground polygons for a feature (drought classes). */
  polygons?: (f: LayerFeature) => StyledPolygon[] | null;
  /** One raster overlay derived from the whole collection (turbidity map). */
  overlay?: (features: LayerFeature[]) => OverlaySpec | null;
  /**
   * Tiled imagery (lib/globe/tiles.ts): a picture a publisher renders, drawn with
   * an opacity, a camera-height gate and a credit. Read on every update with the
   * fetch result's `meta` (a scenario level, a product), so a new key rebuilds it.
   */
  tiles?: (ctx: { meta?: Record<string, unknown> }) => TileSpec[] | null;
}

export interface PickId {
  layer: LayerId;
  id: string;
}

interface Item {
  feature: LayerFeature;
  point?: CesiumNS.PointPrimitive;
  billboard?: CesiumNS.Billboard;
  label?: CesiumNS.Label;
  lines: CesiumNS.Polyline[];
  history: Array<[t: number, lon: number, lat: number, alt: number]>;
  lastHistoryAt: number;
  pos?: CesiumNS.Cartesian3;
  color: string;
  ground?: CesiumNS.GroundPrimitive;
  anchor?: LonLatAlt;
  /** On the camera-facing side of the planet (the horizon test in occlude()). */
  facing?: boolean;
}

/** One label as the cross-layer budget sees it (lib/globe/labelArbiter.ts). */
export interface LabelSlot {
  key: string;
  pos: CesiumNS.Cartesian3;
  text: string;
  priority: number;
  pinned: boolean;
  offset: [number, number];
}

const colorCache = new Map<string, CesiumNS.Color>();
function cssColor(hex: string, alpha?: number): CesiumNS.Color {
  const C = getCesium();
  const key = alpha == null ? hex : `${hex}@${alpha}`;
  let c = colorCache.get(key);
  if (!c) {
    c = C.Color.fromCssColorString(hex);
    if (alpha != null) c = c.withAlpha(alpha);
    colorCache.set(key, c);
  }
  return c;
}

/**
 * Globe labels are set in the HUD's own text face. next/font serves Geist Mono
 * under a generated family name, so read it from the CSS variable the layout
 * declares; fall back to a plain mono stack before the stylesheet is in.
 */
let labelFont: string | null = null;
function labelFontCss(): string {
  if (labelFont) return labelFont;
  const fallback = "JetBrains Mono, Consolas, monospace";
  let family = "";
  if (typeof document !== "undefined") {
    family = getComputedStyle(document.documentElement).getPropertyValue("--font-geist-mono").trim();
  }
  labelFont = `500 11px ${family ? `${family}, ` : ""}${fallback}`;
  return labelFont;
}
const MAX_HISTORY = 240;

export class LayerRenderer {
  readonly layer: LayerId;
  readonly style: LayerStyle;
  private readonly viewer: CesiumNS.Viewer;
  private readonly points: CesiumNS.PointPrimitiveCollection;
  private readonly billboards: CesiumNS.BillboardCollection;
  private readonly labels: CesiumNS.LabelCollection;
  private readonly polylines: CesiumNS.PolylineCollection;
  private readonly fx: CesiumNS.BillboardCollection;
  private readonly ground: CesiumNS.PrimitiveCollection;
  private readonly groundOk: boolean;
  private overlayLayer: CesiumNS.ImageryLayer | null = null;
  private tileLayers: Array<{ spec: TileSpec; layer: CesiumNS.ImageryLayer; inGate: boolean }> = [];
  /** The viewer's opacity for this layer's pictures; null = each spec's own default. */
  private tileAlpha: number | null = null;
  private lastGate = 0;
  /** Told when this layer's tiles start failing, and when they load again. */
  onTileHealth?: (h: TileHealth) => void;
  private readonly items = new Map<string, Item>();
  private selectedId: string | null = null;
  private hoverId: string | null = null;
  private selectedLines: CesiumNS.Polyline[] = [];
  private trailLine: CesiumNS.Polyline | null = null;
  private glow: CesiumNS.Billboard | null = null;
  private lastTick = 0;
  private lastTime = 0;
  private _show = true;
  private labelsEnabled = true;
  /** Label keys the cross-layer budget let through; null = no budget applied yet. */
  private labelMask: Set<string> | null = null;
  private destroyed = false;

  constructor(viewer: CesiumNS.Viewer, layer: LayerId, style: LayerStyle) {
    const C = getCesium();
    this.viewer = viewer;
    this.layer = layer;
    this.style = style;
    const scene = viewer.scene;
    this.polylines = scene.primitives.add(new C.PolylineCollection());
    this.points = scene.primitives.add(new C.PointPrimitiveCollection());
    this.fx = scene.primitives.add(new C.BillboardCollection({ scene }));
    this.billboards = scene.primitives.add(new C.BillboardCollection({ scene }));
    this.labels = scene.primitives.add(new C.LabelCollection({ scene }));
    this.ground = scene.groundPrimitives.add(new C.PrimitiveCollection());
    this.groundOk = C.GroundPrimitive.isSupported(scene);
  }

  get show() {
    return this._show;
  }
  set show(v: boolean) {
    this._show = v;
    this.points.show = v;
    this.billboards.show = v;
    this.labels.show = v;
    this.polylines.show = v;
    this.fx.show = v;
    this.ground.show = v;
    if (this.overlayLayer) this.overlayLayer.show = v;
    for (const t of this.tileLayers) t.layer.show = v && t.inGate;
  }

  setLabelsEnabled(on: boolean) {
    this.labelsEnabled = on;
    this.refreshLabels();
  }

  get size() {
    return this.items.size;
  }

  getFeature(id: string): LayerFeature | undefined {
    return this.items.get(id)?.feature;
  }

  *features(): IterableIterator<LayerFeature> {
    for (const it of this.items.values()) yield it.feature;
  }

  /** Current world position of a feature (Cartesian3), if it has one. */
  getPosition(id: string): CesiumNS.Cartesian3 | undefined {
    return this.items.get(id)?.pos;
  }

  /** Replace the layer contents with a fresh collection, diffing by id. `meta` is the fetch result's, for tiled pictures. */
  update(collection: LayerCollection, meta?: Record<string, unknown>) {
    if (this.destroyed) return;
    const now = this.currentTimeMs();
    const seen = new Set<string>();
    for (const f of collection.features) {
      const id = f.properties.id;
      seen.add(id);
      const existing = this.items.get(id);
      if (existing) {
        // Layers that memoise static features (hydrography, drought) hand back
        // the same objects; nothing to redraw for those.
        if (existing.feature !== f) {
          existing.feature = f;
          this.applyStatic(existing, now);
        }
      } else {
        const item: Item = {
          feature: f,
          lines: [],
          history: [],
          lastHistoryAt: 0,
          color: this.style.colorFor?.(f) ?? this.style.color,
        };
        this.items.set(id, item);
        this.applyStatic(item, now);
      }
    }
    for (const [id, item] of this.items) {
      if (!seen.has(id)) {
        this.removeItem(item);
        this.items.delete(id);
        if (this.selectedId === id) this.setSelected(null);
      }
    }
    this.refreshLabels();
    this.applyOverlay();
    this.applyTiles(meta);
    // A refetch can hand back the selected feature as a new object (the
    // constructs stack at a new height): redraw what hangs off the selection.
    if (this.selectedId && this.items.has(this.selectedId)) this.refreshSelectedLines();
    this.tick(now, true);
  }

  /**
   * Re-run the style for some features without new data: for styles that read
   * state outside the feature (the construct field reads live vitals).
   */
  restyle(ids?: Iterable<string>) {
    if (this.destroyed) return;
    const now = this.currentTimeMs();
    const want = ids ? new Set(ids) : null;
    for (const [id, item] of this.items) if (!want || want.has(id)) this.applyStatic(item, now);
    if (this.selectedId && (!want || want.has(this.selectedId))) this.refreshSelectedLines();
    this.refreshLabels();
    this.tick(now, true);
  }

  private applyOverlay() {
    if (!this.style.overlay) return;
    const C = getCesium();
    const spec = this.style.overlay([...this.features()]);
    if (this.overlayLayer) {
      this.viewer.imageryLayers.remove(this.overlayLayer, true);
      this.overlayLayer = null;
    }
    if (!spec) return;
    const provider = new C.SingleTileImageryProvider({
      url: spec.image.toDataURL("image/png"),
      rectangle: C.Rectangle.fromDegrees(spec.west, spec.south, spec.east, spec.north),
      tileWidth: spec.image.width,
      tileHeight: spec.image.height,
    });
    this.overlayLayer = this.viewer.imageryLayers.addImageryProvider(provider);
    this.overlayLayer.alpha = spec.alpha ?? 0.85;
    this.overlayLayer.magnificationFilter = C.TextureMagnificationFilter.NEAREST;
    this.overlayLayer.show = this._show;
  }

  private cameraHeight(): number {
    return this.viewer.camera.positionCartographic.height;
  }

  /** Add, keep or drop this layer's tiled pictures to match the style's specs (diffed by key). */
  private applyTiles(meta?: Record<string, unknown>) {
    if (!this.style.tiles) return;
    let specs: TileSpec[] = [];
    try {
      specs = this.style.tiles({ meta }) ?? [];
    } catch (err) {
      this.onTileHealth?.({ failing: true, message: `tiles: ${err instanceof Error ? err.message : String(err)}` });
    }
    const want = new Set(specs.map((s) => s.key));
    for (const t of this.tileLayers.filter((x) => !want.has(x.spec.key))) removeOrdered(this.viewer, t.layer);
    this.tileLayers = this.tileLayers.filter((x) => want.has(x.spec.key));
    const have = new Set(this.tileLayers.map((t) => t.spec.key));
    const height = this.cameraHeight();
    for (const spec of specs) {
      if (have.has(spec.key)) continue;
      try {
        const layer = createTileLayer(spec, (h) => this.onTileHealth?.(h));
        layer.alpha = this.tileAlpha ?? spec.alpha;
        const inGate = inHeightGate(spec, height);
        layer.show = this._show && inGate;
        addOrdered(this.viewer, layer, spec.z);
        this.tileLayers.push({ spec, layer, inGate });
      } catch (err) {
        this.onTileHealth?.({ failing: true, message: `tiles: ${err instanceof Error ? err.message : String(err)}` });
      }
    }
  }

  /** The viewer's opacity for this layer's pictures (null restores each picture's default). */
  setTileAlpha(alpha: number | null) {
    this.tileAlpha = alpha == null || !Number.isFinite(alpha) ? null : Math.max(0, Math.min(1, alpha));
    for (const t of this.tileLayers) t.layer.alpha = this.tileAlpha ?? t.spec.alpha;
  }

  /** Whether the layer has tiled pictures (a picture layer, or a vector layer with a picture). */
  get hasTiles(): boolean {
    return this.tileLayers.length > 0;
  }

  /** Show each picture only inside its camera-height gate (checked about four times a second). */
  private gateTiles(force = false) {
    if (!this.tileLayers.length) return;
    const now = performance.now();
    if (!force && now - this.lastGate < 250) return;
    this.lastGate = now;
    const height = this.cameraHeight();
    for (const t of this.tileLayers) {
      t.inGate = inHeightGate(t.spec, height);
      const want = this._show && t.inGate;
      if (t.layer.show !== want) t.layer.show = want;
    }
  }

  private currentTimeMs(): number {
    const C = getCesium();
    return C.JulianDate.toDate(this.viewer.clock.currentTime).getTime();
  }

  private lonLatAlt(item: Item, timeMs: number): LonLatAlt | null {
    const f = item.feature;
    if (this.style.position) return this.style.position(f, timeMs);
    if (f.geometry.type === "Point") {
      const [lon, lat, alt] = f.geometry.coordinates;
      return [lon, lat, alt ?? f.properties.altitude ?? 0];
    }
    if (!item.anchor) item.anchor = anchorOf(f) ?? undefined;
    return item.anchor ?? null;
  }

  private applyStatic(item: Item, timeMs: number) {
    const C = getCesium();
    const f = item.feature;
    item.color = this.style.colorFor?.(f) ?? this.style.color;
    const color = cssColor(item.color);
    const pick: PickId = { layer: this.layer, id: f.properties.id };
    const kind = this.style.icon?.(f) ?? null;
    const lineOnly = f.geometry.type !== "Point" && !kind;

    if (lineOnly) {
      // Pure polyline feature (roads, tracks): no marker, position = first vertex.
      if (item.point) {
        this.points.remove(item.point);
        item.point = undefined;
      }
      if (item.billboard) {
        this.billboards.remove(item.billboard);
        item.billboard = undefined;
      }
      item.anchor = anchorOf(f) ?? undefined;
      item.pos = item.anchor ? C.Cartesian3.fromDegrees(item.anchor[0], item.anchor[1], item.anchor[2]) : undefined;
    } else if (kind) {
      if (item.point) {
        this.points.remove(item.point);
        item.point = undefined;
      }
      const size = this.style.iconSize ?? 28;
      if (!item.billboard) {
        item.billboard = this.billboards.add({
          id: pick,
          position: new C.Cartesian3(),
          width: size,
          height: size,
          verticalOrigin: C.VerticalOrigin.CENTER,
          horizontalOrigin: C.HorizontalOrigin.CENTER,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        });
        if (this.style.scaleByDistance) {
          const [n, ns, fa, fs] = this.style.scaleByDistance;
          item.billboard.scaleByDistance = new C.NearFarScalar(n, ns, fa, fs);
        }
        if (this.style.translucencyByDistance) {
          const [n, na, fa, fal] = this.style.translucencyByDistance;
          item.billboard.translucencyByDistance = new C.NearFarScalar(n, na, fa, fal);
        }
      }
      item.billboard.setImage(iconKey(kind, item.color, 32), getIcon(kind, item.color, 32));
    } else {
      if (item.billboard) {
        this.billboards.remove(item.billboard);
        item.billboard = undefined;
      }
      if (!item.point) {
        item.point = this.points.add({
          id: pick,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        });
        if (this.style.scaleByDistance) {
          const [n, ns, fa, fs] = this.style.scaleByDistance;
          item.point.scaleByDistance = new C.NearFarScalar(n, ns, fa, fs);
        }
        if (this.style.translucencyByDistance) {
          const [n, na, fa, fal] = this.style.translucencyByDistance;
          item.point.translucencyByDistance = new C.NearFarScalar(n, na, fa, fal);
        }
      }
      item.point.color = color;
      item.point.outlineColor = C.Color.BLACK.withAlpha(0.7);
      item.point.outlineWidth = 1;
      item.point.pixelSize = this.style.pointSize?.(f) ?? 6;
    }

    // Static polylines (trajectories, roads).
    for (const l of item.lines) this.polylines.remove(l);
    item.lines = [];
    const lines = this.style.lines?.(f, timeMs);
    if (lines) {
      for (const l of lines) item.lines.push(this.addLine(l, pick));
    }

    // Filled ground polygons (drought classes).
    if (item.ground) {
      this.ground.remove(item.ground);
      item.ground = undefined;
    }
    const polys = this.style.polygons?.(f);
    if (polys && polys.length && this.groundOk) {
      const instances: CesiumNS.GeometryInstance[] = [];
      for (const p of polys) {
        const hierarchy = toHierarchy(p.rings);
        if (!hierarchy) continue;
        instances.push(
          new C.GeometryInstance({
            geometry: new C.PolygonGeometry({
              polygonHierarchy: hierarchy,
              vertexFormat: C.PerInstanceColorAppearance.FLAT_VERTEX_FORMAT,
            }),
            attributes: {
              color: C.ColorGeometryInstanceAttribute.fromColor(cssColor(p.color ?? this.style.color, p.alpha ?? 0.3)),
            },
            id: pick,
          }),
        );
      }
      if (instances.length) {
        item.ground = this.ground.add(
          new C.GroundPrimitive({
            geometryInstances: instances,
            appearance: new C.PerInstanceColorAppearance({ flat: true, translucent: true }),
            asynchronous: true,
            allowPicking: true,
          }),
        );
      }
    }

    if (!this.style.position && !lineOnly) this.place(item, timeMs);
  }

  private addLine(l: StyledLine, id?: PickId): CesiumNS.Polyline {
    const C = getCesium();
    const flat: number[] = [];
    for (const p of l.positions) flat.push(p[0], p[1], p[2] ?? 0);
    const color = cssColor(l.color ?? this.style.color, l.alpha ?? 0.8);
    const material = l.dashed
      ? C.Material.fromType("PolylineDash", { color, dashLength: 12 })
      : l.glow
        ? C.Material.fromType("PolylineGlow", { color, glowPower: 0.2 })
        : C.Material.fromType("Color", { color });
    return this.polylines.add({
      positions: C.Cartesian3.fromDegreesArrayHeights(flat),
      width: l.width ?? 1.5,
      material,
      id,
    });
  }

  private place(item: Item, timeMs: number) {
    const C = getCesium();
    if (!item.point && !item.billboard && !item.label) return;
    const lla = this.lonLatAlt(item, timeMs);
    const visible = lla != null;
    if (item.point) item.point.show = visible;
    if (item.billboard) item.billboard.show = visible;
    if (item.label) item.label.show = visible && item.facing !== false && this.labelShown(item);
    if (!lla) {
      item.pos = undefined;
      return;
    }
    const pos = C.Cartesian3.fromDegrees(lla[0], lla[1], lla[2], undefined, item.pos);
    item.pos = pos;
    if (item.point) item.point.position = pos;
    if (item.billboard) {
      item.billboard.position = pos;
      const heading =
        this.style.headingAt?.(item.feature, timeMs) ?? item.feature.properties.heading;
      if (heading != null && Number.isFinite(heading)) {
        item.billboard.alignedAxis = northAxis(pos);
        item.billboard.rotation = -heading * DEG;
      } else {
        item.billboard.alignedAxis = C.Cartesian3.ZERO;
        item.billboard.rotation = 0;
      }
    }
    if (item.label) item.label.position = pos;

    if (this.style.trail && timeMs - item.lastHistoryAt >= 4000) {
      const h = item.history;
      const last = h[h.length - 1];
      if (!last || last[1] !== lla[0] || last[2] !== lla[1] || last[3] !== lla[2]) {
        h.push([timeMs, lla[0], lla[1], lla[2]]);
        if (h.length > MAX_HISTORY) h.shift();
      }
      item.lastHistoryAt = timeMs;
    }
  }

  /** Advance dynamic features to mission time. Called every frame; throttled by style.tickMs. */
  tick(timeMs: number, force = false) {
    if (this.destroyed || !this._show) return;
    this.gateTiles(force);
    const cadence = this.style.tickMs ?? 1000;
    const jumped = Math.abs(timeMs - this.lastTime) > Math.max(cadence, 250) * 4;
    this.lastTime = timeMs;
    const due = force || jumped || cadence === 0 || timeMs - this.lastTick >= cadence;
    if (due) {
      this.lastTick = timeMs;
      if (this.style.position) {
        for (const item of this.items.values()) this.place(item, timeMs);
      }
    }
    this.occlude(force);
    this.updateSelectionFx(timeMs, due);
  }

  private lastOcclude = 0;

  /**
   * Depth testing is disabled on every marker so surface objects are never
   * swallowed by terrain; the price is that markers on the far side of the
   * planet would shine through it. This hides anything below the horizon.
   */
  private occlude(force: boolean) {
    const now = performance.now();
    if (!force && now - this.lastOcclude < 120) return;
    this.lastOcclude = now;
    const cam = this.viewer.scene.camera.positionWC;
    const occ = horizonOccluder(cam);
    for (const item of this.items.values()) {
      if (!item.pos) continue;
      // Polylines and ground fills are depth-tested by the globe itself.
      if (!item.point && !item.billboard && !item.label) continue;
      const visible = occ(item.pos);
      item.facing = visible;
      if (item.point && item.point.show !== visible) item.point.show = visible;
      if (item.billboard && item.billboard.show !== visible) item.billboard.show = visible;
      if (item.label) {
        const want = visible && this.labelShown(item);
        if (item.label.show !== want) item.label.show = want;
      }
      for (const l of item.lines) if (l.show !== visible) l.show = visible;
    }
    if (this.glow && this.selectedId) {
      const cur = this.items.get(this.selectedId);
      this.glow.show = !!cur?.pos && occ(cur.pos);
    }
  }

  private labelKey(item: Item): string {
    return `${this.layer}:${item.feature.properties.id}`;
  }

  private isPinned(item: Item): boolean {
    const id = item.feature.properties.id;
    return id === this.selectedId || id === this.hoverId;
  }

  /** Wanted by the layer and let through by the cross-layer budget. */
  private labelShown(item: Item): boolean {
    if (!this.labelVisible(item)) return false;
    return !this.labelMask || this.labelMask.has(this.labelKey(item));
  }

  /** Every label this layer wants on screen now, for the cross-layer budget. */
  collectLabels(out: LabelSlot[]): void {
    if (this.destroyed || !this._show || !this.style.label) return;
    const base = LAYER_LABEL_PRIORITY[this.layer] ?? 10;
    const offset = this.style.labelOffset ?? [14, -12];
    for (const item of this.items.values()) {
      if (!item.label || !item.pos || item.facing === false) continue;
      if (!this.labelVisible(item)) continue;
      const f = item.feature;
      const pinned = this.isPinned(item);
      const extra = (this.style.labelPriority?.(f) ?? 0) + (this.style.labelAlways?.(f) ? 5 : 0);
      out.push({ key: this.labelKey(item), pos: item.pos, text: item.label.text, priority: base + extra, pinned, offset });
    }
  }

  /** Apply the budget's verdict: labels whose key is not in `allowed` are hidden, not removed. */
  applyLabelMask(allowed: Set<string> | null): void {
    this.labelMask = allowed;
    if (this.destroyed) return;
    for (const item of this.items.values()) {
      if (!item.label) continue;
      const want = !!item.pos && item.facing !== false && this.labelShown(item);
      if (item.label.show !== want) item.label.show = want;
    }
  }

  private labelVisible(item: Item): boolean {
    const id = item.feature.properties.id;
    if (id === this.selectedId || id === this.hoverId) return true;
    if (!this.labelsEnabled) return false;
    if (this.style.labelAlways?.(item.feature)) return true;
    if (this.style.labelWhen && !this.style.labelWhen(item.feature, this.lastTime || Date.now())) return false;
    return this.items.size <= (this.style.labelMax ?? 60);
  }

  private refreshLabels() {
    for (const item of this.items.values()) this.syncLabel(item);
  }

  private syncLabel(item: Item) {
    const C = getCesium();
    const wanted = this.labelVisible(item) && !!this.style.label;
    if (!wanted) {
      if (item.label) {
        this.labels.remove(item.label);
        item.label = undefined;
      }
      return;
    }
    const text = this.style.label!(item.feature);
    if (!item.label) {
      item.label = this.labels.add({
        text,
        position: item.pos ?? new C.Cartesian3(),
        font: labelFontCss(),
        fillColor: cssColor(item.color),
        outlineColor: cssColor("#020305", 0.92),
        outlineWidth: 3,
        style: C.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new C.Cartesian2(...(this.style.labelOffset ?? [14, -12])),
        horizontalOrigin: C.HorizontalOrigin.LEFT,
        verticalOrigin: C.VerticalOrigin.CENTER,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        id: { layer: this.layer, id: item.feature.properties.id } satisfies PickId,
        show: !!item.pos && item.facing !== false && (!this.labelMask || this.isPinned(item) || this.labelMask.has(this.labelKey(item))),
      });
      if (item.pos) item.label.position = item.pos;
    } else {
      item.label.text = text;
      item.label.fillColor = cssColor(item.color);
    }
  }

  setHover(id: string | null) {
    if (this.hoverId === id) return;
    const prev = this.hoverId ? this.items.get(this.hoverId) : undefined;
    this.hoverId = id;
    if (prev) this.syncLabel(prev);
    const cur = id ? this.items.get(id) : undefined;
    if (cur) this.syncLabel(cur);
  }

  setSelected(id: string | null) {
    const C = getCesium();
    if (this.selectedId === id) return;
    const prev = this.selectedId ? this.items.get(this.selectedId) : undefined;
    this.selectedId = id;
    if (prev) this.syncLabel(prev);
    for (const l of this.selectedLines) this.polylines.remove(l);
    this.selectedLines = [];
    if (this.trailLine) {
      this.polylines.remove(this.trailLine);
      this.trailLine = null;
    }
    if (this.glow) {
      this.fx.remove(this.glow);
      this.glow = null;
    }
    const cur = id ? this.items.get(id) : undefined;
    if (!cur) return;
    this.syncLabel(cur);
    this.glow = this.fx.add({
      image: getGlow(cur.color, 64),
      width: 64,
      height: 64,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      position: cur.pos ?? C.Cartesian3.ZERO,
      show: !!cur.pos,
    });
    const t = this.currentTimeMs();
    const lines = this.style.selectedLines?.(cur.feature, t);
    if (lines) for (const l of lines) this.selectedLines.push(this.addLine(l));
    this.updateSelectionFx(t, true);
  }

  /** Rebuild the selected feature's orbit / trajectory lines (after time jumps). */
  refreshSelectedLines() {
    if (!this.selectedId) return;
    const cur = this.items.get(this.selectedId);
    if (!cur) return;
    for (const l of this.selectedLines) this.polylines.remove(l);
    this.selectedLines = [];
    const lines = this.style.selectedLines?.(cur.feature, this.currentTimeMs());
    if (lines) for (const l of lines) this.selectedLines.push(this.addLine(l));
  }

  private updateSelectionFx(timeMs: number, rebuildTrail: boolean) {
    const C = getCesium();
    if (!this.selectedId) return;
    const cur = this.items.get(this.selectedId);
    if (!cur) return;
    if (this.glow) {
      const pulse = 52 + 10 * Math.sin(performance.now() / 260);
      this.glow.width = pulse;
      this.glow.height = pulse;
      if (cur.pos) this.glow.position = cur.pos;
      else this.glow.show = false;
    }
    if (this.style.trail && rebuildTrail && cur.history.length > 1) {
      const flat: number[] = [];
      for (const h of cur.history) if (h[0] <= timeMs) flat.push(h[1], h[2], h[3]);
      if (cur.pos) {
        const carto = C.Cartographic.fromCartesian(cur.pos);
        flat.push(
          C.Math.toDegrees(carto.longitude),
          C.Math.toDegrees(carto.latitude),
          carto.height,
        );
      }
      if (flat.length >= 6) {
        const positions = C.Cartesian3.fromDegreesArrayHeights(flat);
        if (!this.trailLine) {
          this.trailLine = this.polylines.add({
            positions,
            width: 2,
            material: C.Material.fromType("PolylineGlow", {
              color: cssColor(cur.color, 0.9),
              glowPower: 0.25,
            }),
          });
        } else this.trailLine.positions = positions;
      }
    }
  }

  private removeItem(item: Item) {
    if (item.point) this.points.remove(item.point);
    if (item.billboard) this.billboards.remove(item.billboard);
    if (item.label) this.labels.remove(item.label);
    for (const l of item.lines) this.polylines.remove(l);
    if (item.ground) this.ground.remove(item.ground);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    // React unmounts the globe before the layer bridges; a destroyed viewer
    // has already released every collection below.
    if (this.viewer.isDestroyed()) {
      this.items.clear();
      this.tileLayers = [];
      return;
    }
    const p = this.viewer.scene.primitives;
    for (const c of [this.points, this.billboards, this.labels, this.polylines, this.fx]) {
      if (p.contains(c)) p.remove(c);
    }
    const g = this.viewer.scene.groundPrimitives;
    if (g.contains(this.ground)) g.remove(this.ground);
    if (this.overlayLayer) {
      this.viewer.imageryLayers.remove(this.overlayLayer, true);
      this.overlayLayer = null;
    }
    for (const t of this.tileLayers) removeOrdered(this.viewer, t.layer);
    this.tileLayers = [];
    this.items.clear();
  }
}

// WGS84 radii; positions are scaled to the unit sphere for the horizon test.
const INV_A = 1 / 6378137.0;
const INV_C = 1 / 6356752.3142451793;

/**
 * Horizon culling in ellipsoid-scaled space (the same test Cesium uses for
 * terrain tiles): returns a predicate telling whether a world position is on
 * the camera-facing side of the planet.
 */
export function horizonOccluder(camera: CesiumNS.Cartesian3): (p: CesiumNS.Cartesian3) => boolean {
  const cx = camera.x * INV_A;
  const cy = camera.y * INV_A;
  const cz = camera.z * INV_C;
  const vhMagnitudeSquared = cx * cx + cy * cy + cz * cz - 1;
  return (p) => {
    const vtx = p.x * INV_A - cx;
    const vty = p.y * INV_A - cy;
    const vtz = p.z * INV_C - cz;
    const vtDotVc = -(vtx * cx + vty * cy + vtz * cz);
    if (vhMagnitudeSquared < 0) return !(vtDotVc > 0);
    if (vtDotVc <= vhMagnitudeSquared) return true;
    const vtMagSq = vtx * vtx + vty * vty + vtz * vtz;
    return !((vtDotVc * vtDotVc) / vtMagSq > vhMagnitudeSquared);
  };
}

let northMatrix: CesiumNS.Matrix4 | undefined;

/** Unit vector pointing to local north at a world position. */
export function northAxis(pos: CesiumNS.Cartesian3): CesiumNS.Cartesian3 {
  const C = getCesium();
  northMatrix = C.Transforms.eastNorthUpToFixedFrame(pos, undefined, northMatrix);
  const col = C.Matrix4.getColumn(northMatrix, 1, new C.Cartesian4());
  const n = new C.Cartesian3(col.x, col.y, col.z);
  return C.Cartesian3.normalize(n, n);
}

/** A representative position for a non-point feature: label anchor and pick focus. */
export function anchorOf(f: LayerFeature): LonLatAlt | null {
  const a = f.properties.anchor;
  if (a && Number.isFinite(a[0]) && Number.isFinite(a[1])) return [a[0], a[1], 0];
  const g = f.geometry;
  const mid = (line: number[][]): LonLatAlt | null => {
    if (!Array.isArray(line)) return null;
    const c = line[Math.floor(line.length / 2)];
    return Array.isArray(c) ? [c[0], c[1], c[2] ?? 0] : null;
  };
  const bbox = (ring: number[][]) => {
    let w = Infinity;
    let s = Infinity;
    let e = -Infinity;
    let n = -Infinity;
    for (const c of ring) {
      if (!Array.isArray(c)) continue;
      if (c[0] < w) w = c[0];
      if (c[0] > e) e = c[0];
      if (c[1] < s) s = c[1];
      if (c[1] > n) n = c[1];
    }
    return Number.isFinite(w) ? { w, s, e, n } : null;
  };
  const centre = (ring: number[][]): LonLatAlt | null => {
    const b = bbox(ring);
    return b ? [(b.w + b.e) / 2, (b.s + b.n) / 2, 0] : null;
  };
  switch (g.type) {
    case "Point":
      return [g.coordinates[0], g.coordinates[1], g.coordinates[2] ?? 0];
    case "LineString":
      return mid(g.coordinates);
    case "MultiLineString": {
      let best: number[][] = [];
      for (const part of (g as MultiLineString).coordinates) if (Array.isArray(part) && part.length > best.length) best = part;
      return mid(best);
    }
    case "Polygon":
      return centre((g as Polygon).coordinates[0] ?? []);
    case "MultiPolygon": {
      let best: number[][] = [];
      let bestArea = -1;
      for (const poly of (g as MultiPolygon).coordinates) {
        const ring = poly[0] ?? [];
        const b = bbox(ring);
        if (!b) continue;
        const area = (b.e - b.w) * (b.n - b.s);
        if (area > bestArea) {
          bestArea = area;
          best = ring;
        }
      }
      return centre(best);
    }
    default:
      return null;
  }
}

/** GeoJSON rings -> Cesium polygon hierarchy (outer + holes), null when degenerate. */
function toHierarchy(rings: number[][][]): CesiumNS.PolygonHierarchy | null {
  const C = getCesium();
  const toPositions = (ring: number[][]) => {
    const flat: number[] = [];
    for (const c of ring) flat.push(c[0], c[1]);
    return C.Cartesian3.fromDegreesArray(flat);
  };
  const outer = rings[0];
  if (!outer || outer.length < 4) return null;
  const holes: CesiumNS.PolygonHierarchy[] = [];
  for (let i = 1; i < rings.length; i++) {
    if (rings[i].length >= 4) holes.push(new C.PolygonHierarchy(toPositions(rings[i])));
  }
  return new C.PolygonHierarchy(toPositions(outer), holes);
}
