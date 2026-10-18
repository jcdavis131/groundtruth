"use client";
// Animated particle-flow renderer for the wind and ocean-current layers.
//
// A transparent canvas sits over the Cesium container (pointer-events: none).
// Particles live in lon/lat, are advected through the layer's vector grid
// each frame, and are re-projected to screen space — so camera moves are
// handled for free and trails smear-correctly (the canvas is cleared, not
// faded, on camera motion). Wind particles are coloured by speed; current
// particles by sea-surface temperature with brightness by speed (the reel
// look). Satisfies LayerRendererLike so LayerHost drives it like any layer.

import type * as CesiumNS from "cesium";
import { getCesium } from "./cesium";
import {
  cellLonLat,
  currentColor,
  liveCells,
  sampleFlow,
  speedOf,
  windColor,
  type FlowGrid,
} from "./flowField";
import type { LayerRendererLike } from "./rendererTypes";
import type { LayerCollection, LayerFeature, LayerId } from "@/lib/layers/types";
import type { TileHealth } from "./tiles";

export type FlowColorMode = "wind" | "current";

interface Particle {
  lon: number;
  lat: number;
  age: number;
  maxAge: number;
  stagnant: number;
}

const PX_PER_MS_WIND = 4; // 10 m/s wind -> 40 px/s on screen
const PX_PER_MS_CURRENT = 90; // 0.5 m/s current -> 45 px/s on screen
const FADE_ALPHA = 0.94; // trail persistence per frame
const MAX_AGE = 160; // frames before a particle is recycled
const STAGNANT_FRAMES = 90; // still frames before recycling

export class FlowRenderer implements LayerRendererLike {
  readonly layer: LayerId;
  readonly colorMode: FlowColorMode;
  onTileHealth?: (h: TileHealth) => void;

  private readonly viewer: CesiumNS.Viewer;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly ro: ResizeObserver;
  private readonly reducedMotion: boolean;
  private readonly pxPerMs: number;

  private grid: FlowGrid | null = null;
  private oceanCells: number[] = [];
  private particles: Particle[] = [];
  private _show = true;
  private destroyed = false;
  private lastFrame = 0;
  private lastCamKey = "";
  private scratchC3: CesiumNS.Cartesian3 | null = null;
  private scratchC2: CesiumNS.Cartesian2 | null = null;
  private scratchN: CesiumNS.Cartesian3 | null = null;
  private scratchD: CesiumNS.Cartesian3 | null = null;

  constructor(viewer: CesiumNS.Viewer, layer: LayerId, colorMode: FlowColorMode) {
    this.viewer = viewer;
    this.layer = layer;
    this.colorMode = colorMode;
    this.pxPerMs = colorMode === "wind" ? PX_PER_MS_WIND : PX_PER_MS_CURRENT;
    this.reducedMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.cssText =
      "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:5;";
    viewer.container.appendChild(canvas);
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("flow layer: 2d canvas context unavailable");
    this.ctx = ctx;

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(viewer.container);
    this.resize();
  }

  get show() {
    return this._show;
  }
  set show(v: boolean) {
    this._show = v;
    this.canvas.style.display = v ? "" : "none";
    if (!v) this.clear();
  }

  /** Particle layers draw no pickable features. */
  get size() {
    return 0;
  }

  setLabelsEnabled(): void {
    // Particles carry no labels.
  }
  setTileAlpha(): void {
    // No imagery tiles.
  }
  collectLabels(): void {
    // No labels to arbitrate.
  }
  applyLabelMask(): void {
    // No labels to mask.
  }
  refreshSelectedLines(): void {
    // Nothing selectable.
  }
  restyle(): void {
    // No styled features to restyle.
  }
  setHover(): void {
    // Nothing hoverable.
  }
  setSelected(): void {
    // Nothing selectable.
  }
  getFeature(): LayerFeature | undefined {
    return undefined;
  }
  getPosition(): CesiumNS.Cartesian3 | undefined {
    return undefined;
  }
  features(): Iterable<LayerFeature> {
    return [];
  }

  /** New grid data from the layer fetch: rebuild the field and the particles. */
  update(_collection: LayerCollection, meta?: Record<string, unknown>): void {
    const grid = meta?.grid as FlowGrid | undefined;
    if (!grid || !Array.isArray(grid.u) || !Array.isArray(grid.v)) return;
    this.grid = grid;
    this.oceanCells = this.colorMode === "current" ? liveCells(grid) : [];
    this.seedParticles();
    this.clear();
    if (this.reducedMotion) this.drawStaticFrame();
  }

  destroy(): void {
    this.destroyed = true;
    this.ro.disconnect();
    this.canvas.remove();
    this.particles = [];
    this.grid = null;
  }

  /** Per-frame advance, called from CesiumGlobe's scene.preUpdate. */
  tick(): void {
    if (this.destroyed || !this._show || !this.grid) return;
    const camera = this.viewer.camera;
    // Camera motion smears trails: clear instead of fading that frame.
    // (Applies under reduced-motion too, so the static frame never lies.)
    const camKey = [
      camera.position.x.toFixed(0),
      camera.position.y.toFixed(0),
      camera.position.z.toFixed(0),
      camera.heading.toFixed(4),
      camera.pitch.toFixed(4),
    ].join(",");
    const moved = this.lastCamKey !== "" && this.lastCamKey !== camKey;
    this.lastCamKey = camKey;
    if (moved) {
      this.clear();
      return;
    }
    if (this.reducedMotion) return;
    const now = performance.now();
    const dt = this.lastFrame ? Math.min(0.1, (now - this.lastFrame) / 1000) : 1 / 60;
    this.lastFrame = now;
    const C = getCesium();
    const scene = this.viewer.scene;
    const grid = this.grid;
    if (!grid) return;

    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return;

    // Screen scale at the view centre: project two points 1° apart.
    const center = this.projectCenter(C, scene, w, h);
    if (!center) return;
    const pxPerDegLon = Math.max(1e-6, center.pxPerDegLon);
    const pxPerDegLat = Math.max(1e-6, center.pxPerDegLat);

    const ctx = this.ctx;
    ctx.globalCompositeOperation = "destination-in";
    ctx.fillStyle = `rgba(0,0,0,${FADE_ALPHA})`;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "source-over";
    ctx.lineWidth = 1.3;
    ctx.lineCap = "round";

    const camPos = camera.positionWC;
    for (const p of this.particles) {
      const s = sampleFlow(grid, p.lon, p.lat);
      if (!s) {
        this.respawn(p);
        continue;
      }
      const speed = speedOf(s);
      if (speed < 0.05) {
        if (++p.stagnant > STAGNANT_FRAMES) this.respawn(p);
        continue;
      }
      p.stagnant = 0;
      const px = speed * this.pxPerMs * dt; // screen px to travel this frame
      const dLon = ((s.u / Math.max(1e-6, speed)) * px) / pxPerDegLon;
      const dLat = ((s.v / Math.max(1e-6, speed)) * px) / pxPerDegLat;
      // Near the poles pxPerDeg collapses and degree steps explode: recycle
      // the particle instead of drawing a screen-spanning streak.
      if (Math.abs(dLon) > 2 || Math.abs(dLat) > 2) {
        this.respawn(p);
        continue;
      }
      const prevLon = p.lon;
      const prevLat = p.lat;
      p.lon = ((((p.lon + dLon + 180) % 360) + 360) % 360) - 180;
      p.lat = p.lat + dLat;
      if (Math.abs(p.lat) > 88) {
        this.respawn(p);
        continue;
      }
      const a = this.toScreen(C, scene, camPos, prevLon, prevLat);
      const b = this.toScreen(C, scene, camPos, p.lon, p.lat);
      if (!a || !b) continue;
      const { rgb, alpha } =
        this.colorMode === "wind" ? windColor(speed) : currentColor(s.sst, speed);
      ctx.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      if (++p.age > p.maxAge) this.respawn(p);
    }
  }

  // ---- internals ---------------------------------------------------------

  private resize(): void {
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    const w = this.viewer.container.clientWidth;
    const h = this.viewer.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.seedParticles();
  }

  private clear(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w && h) this.ctx.clearRect(0, 0, w, h);
  }

  private particleCount(): number {
    const small = typeof window !== "undefined" && window.innerWidth < 768;
    return small ? 850 : 2000;
  }

  private seedParticles(): void {
    const n = this.particleCount();
    this.particles = Array.from({ length: n }, () => this.makeParticle());
  }

  private makeParticle(): Particle {
    const p: Particle = { lon: 0, lat: 0, age: 0, maxAge: 0, stagnant: 0 };
    this.respawn(p);
    p.age = Math.floor(Math.random() * p.maxAge);
    return p;
  }

  private respawn(p: Particle): void {
    if (this.colorMode === "current" && this.oceanCells.length > 0 && this.grid) {
      const cell = this.oceanCells[Math.floor(Math.random() * this.oceanCells.length)];
      const [lon, lat] = cellLonLat(this.grid, cell);
      const { dlat, dlon } = this.grid.grid;
      p.lon = lon + (Math.random() - 0.5) * dlon;
      p.lat = Math.max(-84, Math.min(84, lat + (Math.random() - 0.5) * dlat));
    } else {
      p.lon = Math.random() * 360 - 180;
      p.lat = (Math.random() * 2 - 1) * 84;
    }
    p.age = 0;
    p.stagnant = 0;
    p.maxAge = 60 + Math.floor(Math.random() * (MAX_AGE - 60));
  }

  /** Screen position of a lon/lat, or null when behind the globe. */
  private toScreen(
    C: ReturnType<typeof getCesium>,
    scene: CesiumNS.Scene,
    camPos: CesiumNS.Cartesian3,
    lon: number,
    lat: number,
  ): { x: number; y: number } | null {
    this.scratchC3 ??= new C.Cartesian3();
    this.scratchC2 ??= new C.Cartesian2();
    const pos = C.Cartesian3.fromDegrees(lon, lat, 20000, C.Ellipsoid.WGS84, this.scratchC3);
    // Far-side cull: skip when the surface normal points away from the camera.
    this.scratchN ??= new C.Cartesian3();
    this.scratchD ??= new C.Cartesian3();
    const normal = C.Ellipsoid.WGS84.geodeticSurfaceNormal(pos, this.scratchN);
    const toCam = C.Cartesian3.subtract(camPos, pos, this.scratchD);
    if (C.Cartesian3.dot(normal, toCam) <= 0) return null;
    const win = C.SceneTransforms.worldToWindowCoordinates(scene, pos, this.scratchC2);
    if (!win) return null;
    return { x: win.x, y: win.y };
  }

  /** View-centre lon/lat plus the local px-per-degree scale. */
  private projectCenter(
    C: ReturnType<typeof getCesium>,
    scene: CesiumNS.Scene,
    w: number,
    h: number,
  ): { pxPerDegLon: number; pxPerDegLat: number } | null {
    this.scratchC2 ??= new C.Cartesian2();
    const camPos = this.viewer.camera.positionWC;
    const c2 = this.scratchC2;
    c2.x = w / 2;
    c2.y = h / 2;
    const picked = this.viewer.camera.pickEllipsoid(c2, C.Ellipsoid.WGS84);
    if (!picked) return null;
    const carto = C.Ellipsoid.WGS84.cartesianToCartographic(picked);
    const lon = (carto.longitude * 180) / Math.PI;
    const lat = (carto.latitude * 180) / Math.PI;
    const a = this.toScreen(C, scene, camPos, lon, lat);
    const b = this.toScreen(C, scene, camPos, lon + 1, lat);
    const d = this.toScreen(C, scene, camPos, lon, Math.min(88, lat + 1));
    if (!a || !b || !d) return null;
    return {
      pxPerDegLon: Math.hypot(b.x - a.x, b.y - a.y),
      pxPerDegLat: Math.hypot(d.x - a.x, d.y - a.y),
    };
  }

  /** Reduced-motion: one static scatter of coloured dots, no animation. */
  private drawStaticFrame(): void {
    if (!this.grid) return;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    const C = getCesium();
    const scene = this.viewer.scene;
    const camPos = this.viewer.camera.positionWC;
    const ctx = this.ctx;
    this.clear();
    for (const p of this.particles) {
      const s = sampleFlow(this.grid, p.lon, p.lat);
      if (!s) continue;
      const pt = this.toScreen(C, scene, camPos, p.lon, p.lat);
      if (!pt) continue;
      const speed = speedOf(s);
      const { rgb, alpha } =
        this.colorMode === "wind" ? windColor(speed) : currentColor(s.sst, speed);
      ctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha.toFixed(3)})`;
      ctx.fillRect(pt.x, pt.y, 2, 2);
    }
  }
}
