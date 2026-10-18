// Label discipline: a screen-space budget and a collision pass for every
// globe label, across layers.
//
// Each layer decides which of its features deserve a label (hover, selection,
// small layers, "always" features). Left alone, several layers at once flood a
// phone: weather readings, venues, places and constructs pile on top of each
// other and run off the right edge. This pass sees every candidate at once, in
// screen space, and keeps the most important ones that fit: inside the frame,
// clear of the HUD, clear of each other, within a budget that scales with the
// screen. A label that cannot fit is dropped whole, never squashed or clipped.
// Pure, so the rules are tested without a globe.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LabelCandidate {
  /** Unique across layers, e.g. "weather:KCRP". */
  key: string;
  /** Anchor in CSS pixels (the feature's screen position). */
  x: number;
  y: number;
  /** Label text; its box is estimated from the length. */
  text: string;
  /** Higher is placed first. */
  priority: number;
  /** Pixel offset of the label's left-centre from the anchor (the renderer's default is [14, -12]). */
  offset?: [number, number];
  /** Selected / hovered: always placed if it fits the frame, even over the budget. */
  pinned?: boolean;
}

export interface PlaceOptions {
  width: number;
  height: number;
  /** Screen regions covered by HUD chrome; a label may not overlap them. */
  blocked?: Rect[];
  /** Maximum labels; pinned ones may exceed it. */
  budget?: number;
  /** Clearance kept from the frame edge and between labels, px. */
  margin?: number;
  /** Average glyph advance of the label face at 11 px, px. */
  charPx?: number;
  lineH?: number;
}

/** Glyph advance of Geist Mono at 11 px (0.6 em), rounded up so estimates err wide. */
export const LABEL_CHAR_PX = 6.7;
export const LABEL_LINE_H = 15;
const DEFAULT_OFFSET: [number, number] = [14, -12];

/** How many labels a screen of this size carries: about one per 24,000 px², 6 to 36. */
export function labelBudget(width: number, height: number): number {
  return Math.max(6, Math.min(36, Math.round((width * height) / 24_000)));
}

/** The box a label occupies for a candidate (left-centre origin at anchor + offset). */
export function labelBox(c: Pick<LabelCandidate, "x" | "y" | "text" | "offset">, charPx = LABEL_CHAR_PX, lineH = LABEL_LINE_H): Rect {
  const [ox, oy] = c.offset ?? DEFAULT_OFFSET;
  const w = Math.ceil(c.text.length * charPx) + 6; // + the 3 px outline on each side
  return { x: c.x + ox - 3, y: c.y + oy - lineH / 2, w, h: lineH };
}

export function overlaps(a: Rect, b: Rect, pad = 0): boolean {
  return a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
}

function inside(r: Rect, width: number, height: number, margin: number): boolean {
  return r.x >= margin && r.y >= margin && r.x + r.w <= width - margin && r.y + r.h <= height - margin;
}

/**
 * The keys of the labels to show. Greedy by priority (ties: nearer the
 * centre of the frame first, then key, so the result is stable frame to
 * frame): a candidate is kept when its whole box is inside the frame, off the
 * HUD, clear of every label already kept, and the budget has room. Pinned
 * candidates (selection, hover) skip the budget but not the frame, since a
 * clipped label is worse than none.
 */
export function placeLabels(cands: LabelCandidate[], opts: PlaceOptions): Set<string> {
  const { width, height } = opts;
  const margin = opts.margin ?? 4;
  const budget = opts.budget ?? labelBudget(width, height);
  const blocked = opts.blocked ?? [];
  const cx = width / 2;
  const cy = height / 2;
  const sorted = [...cands].sort(
    (a, b) =>
      Number(!!b.pinned) - Number(!!a.pinned) ||
      b.priority - a.priority ||
      Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy) ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );
  const kept: Rect[] = [];
  const out = new Set<string>();
  let used = 0;
  for (const c of sorted) {
    if (!Number.isFinite(c.x) || !Number.isFinite(c.y)) continue;
    if (!c.pinned && used >= budget) continue;
    const box = labelBox(c, opts.charPx, opts.lineH);
    if (!inside(box, width, height, margin)) continue;
    if (blocked.some((r) => overlaps(box, r))) continue;
    if (kept.some((r) => overlaps(box, r, margin))) continue;
    kept.push(box);
    out.add(c.key);
    if (!c.pinned) used++;
  }
  return out;
}

/**
 * Priority of a layer's labels when the frame is crowded: the selection's
 * world first (constructs, live warnings), then things people navigate by,
 * then dense readouts (weather, venues) that are most useful on hover.
 */
export const LAYER_LABEL_PRIORITY: Record<string, number> = {
  constructs: 60,
  alerts: 55,
  hazards: 52,
  field: 50,
  wildfire: 48,
  earthquakes: 45,
  launches: 42,
  water: 40,
  trade: 38,
  flood: 36,
  groundwater: 34,
  turbidity: 32,
  companies: 30,
  wetlands: 30,
  publiclands: 30,
  historic: 29,
  heritage: 22,
  impaired: 28,
  pfas: 28,
  parcels: 10,
  zoning: 29,
  envpermits: 27,
  contaminants: 26,
  ust: 20,
  riskindex: 19,
  health: 18,
  schools: 21,
  hospitals: 22,
  vulnerability: 18,
  broadband: 18,
  housing: 18,
  wildfirerisk: 18,
  tribal: 22,
  permits: 25,
  licences: 21,
  banks: 28,
  spending: 26,
  realestate: 26,
  commerce: 24,
  occupations: 22,
  cameras: 20,
  ships: 18,
  aircraft: 18,
  satellites: 16,
  sports: 14,
  weather: 12,
  // Infrastructure and geohazards: navigable things first, dense lines last.
  airports: 26,
  plants: 24,
  dams: 22,
  faults: 20,
  landslides: 12,
  plss: 10,
  transmission: 8,
  pipelines: 8,
  rail: 6,
  airquality: 16,
  events: 14,
  fires: 8,
  traffic: 4,
  // Picture layers draw no globe labels of their own (their values open in the ground dossier).
  relief: 2,
  slope: 2,
  contours: 2,
  soils: 2,
  firehazard: 2,
  landslidesusc: 2,
  landcover: 2,
  sealevel: 2,
  crithab: 2,
  wayback: 2,
  topo: 2,
  hydro: 2,
  naip: 2,
  geology: 2,
};
