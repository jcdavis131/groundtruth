// The 2-D label placer. Every requested label goes beside its own bubble, or
// at the end of a leader when nothing beside it reads unambiguously, and the
// rules the verifier found broken in the render lane's first placer are hard
// constraints here, not costs:
//
//   - a label box never overlaps another label box, a keep-out rect
//     (reference-line labels, the legend, any frame text) or a leader, and it
//     stays inside `bounds`;
//   - a leader never crosses a label box other than the one it ends on, a
//     keep-out or another leader. The crossings the verifier measured were
//     40-64 px leaders, so capping leader length would not have caught them;
//     the test is geometric and runs both ways: each new leader against every
//     placed box, each new box against every placed leader;
//   - a label without a leader must be unambiguous: the bubble edge nearest its
//     box is its own, by `margin` px over the next nearest, or it needs a
//     leader. In a dense cluster, where bubbles overlap, that forces leaders;
//     that is the point;
//   - a leadered box never covers part of another labelled bubble, and its
//     leader never passes through one, where either would read as belonging
//     to that bubble; the one exception is a bubble that covers this one's
//     centre, which no leader can get out of without crossing;
//   - a leader starts on a visible part of its own bubble: its bubble end
//     lies `clear` px outside every other bubble's disc. Bubbles overlap, and
//     a leader ending inside another disc reads as pointing at that bubble
//     (the first renders ended Orlando's leader inside Dallas, which covers
//     Orlando's centre) or, under a bubble drawn over its own, is hidden.
//     Leaders run straight out from the centre, so one that starts outside a
//     bubble covering that centre never re-enters it (the disc is convex).
//     A label with no visible start in any direction is dropped as "no room".
//
// What is left is ranked by cost: a box over an unlabelled bubble costs more
// than any leader; a leader costs a fixed price plus its length, plus a
// little for each unlabelled bubble it passes through; then a fixed
// preference among sides (right, left, the four diagonals, above, below,
// then the same sides slid flush to one end).
//
// Greedy, in request order. The caller ranks the requests; `required` ids
// (the subject) are placed first, against nothing but the bubbles and the
// keep-outs, and one that still finds no position throws rather than leave the
// chart without its subject. Past `max` placed labels the rest are dropped as
// "cap"; a label with no valid position is dropped as "no room". Placed and
// dropped together are exactly the requests.
//
// Deterministic: candidates come in a fixed order and the first of equal cost
// wins; directions are unit vectors built from Math.sqrt, which IEEE 754
// rounds correctly, rather than Math.cos and Math.sin, which it does not
// pin down; distances use Math.sqrt rather than Math.hypot for the same reason.

import type { Box } from "./frame";

export interface Circle {
  id: string;
  cx: number;
  cy: number;
  r: number;
}

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** A label to place: the id of its bubble and the size of its box, padding included. */
export interface LabelRequest {
  id: string;
  w: number;
  h: number;
}

export interface PlaceOptions {
  /** Every label box lies inside this box. */
  bounds: Box;
  /** Boxes no label box or leader may touch. */
  keepOut: Box[];
  /** At most this many labels are placed, required ones included. */
  max: number;
  /** Ids placed first and never dropped; no position for one throws. */
  required: string[];
  /** Px between a bubble's edge and the box of its unleadered label. */
  gap: number;
  /** Px by which every other bubble's edge must be farther from an unleadered box than its own. */
  margin: number;
  /** Px kept clear between two label boxes. */
  separation: number;
  /** Px by which a leader's bubble end must lie outside every other bubble's disc. */
  clear: number;
  /** Leader lengths to try, px, shortest first. */
  rings: number[];
}

export type DropReason = "cap" | "no room";

export interface PlacedLabel {
  id: string;
  box: Box;
  /** The side of its bubble the box sits on: -1 left, 0 centred above or below, 1 right. Text anchors on that side. */
  side: -1 | 0 | 1;
  /** From the bubble's edge to the box's nearest point; null when the box sits beside the bubble. */
  leader: Segment | null;
}

export interface Placement {
  placed: PlacedLabel[];
  dropped: Array<{ id: string; reason: DropReason }>;
}

// Costs. Any valid unleadered position beats any leader; a box over an
// unlabelled bubble costs more than the longest leader any canvas tries; a
// leader through an unlabelled bubble costs a little.
const OVER_BUBBLE = 1000;
const LEADER = 40;
const THROUGH_BUBBLE = 40;
const SIDE_STEP = 2;

const H = Math.SQRT1_2;
const C22 = Math.sqrt(2 + Math.SQRT2) / 2;
const S22 = Math.sqrt(2 - Math.SQRT2) / 2;

/** Sixteen unit vectors, clockwise from east in SVG space (y down). */
const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [C22, S22],
  [H, H],
  [S22, C22],
  [0, 1],
  [-S22, C22],
  [-H, H],
  [-C22, S22],
  [-1, 0],
  [-C22, -S22],
  [-H, -H],
  [-S22, -C22],
  [0, -1],
  [S22, -C22],
  [H, -H],
  [C22, -S22],
];

/**
 * A candidate position: an index into DIRS and, straight right, left, up or
 * down, how the box sits along that side: 0 centred on the axis, -1 or 1
 * flush to one side of it (above or below a right-hand label, left or right
 * of one overhead). Diagonals put the box's corner on the point and do not slide.
 */
type Pos = readonly [dir: number, slide: -1 | 0 | 1];

function withSlides(dirs: number[]): Pos[] {
  const centred = dirs.map((k): Pos => [k, 0]);
  const slid = dirs.filter((k) => k % 4 === 0).flatMap((k): Pos[] => [[k, -1], [k, 1]]);
  return [...centred, ...slid];
}

/** Unleadered positions in order of preference: right, left, up-right, down-right, up-left, down-left, above, below, then the slid ones. */
const BESIDE = withSlides([0, 8, 14, 2, 10, 6, 12, 4]);
/** Leader positions in order of preference: the same eight directions, the eight between them, then the slid ones. */
const AROUND = withSlides([0, 8, 14, 2, 10, 6, 12, 4, 15, 1, 9, 7, 13, 3, 11, 5]);

/** Distance from a point to a box; 0 inside it. */
export function distToBox(px: number, py: number, b: Box): number {
  const dx = Math.max(b.x - px, 0, px - (b.x + b.w));
  const dy = Math.max(b.y - py, 0, py - (b.y + b.h));
  return Math.sqrt(dx * dx + dy * dy);
}

/** Distance from a box to a bubble's edge; 0 when they touch or overlap. */
export function edgeDistance(b: Box, c: Circle): number {
  return Math.max(0, distToBox(c.cx, c.cy, b) - c.r);
}

/** Whether two boxes overlap, or come closer than `sep` px. Boxes that only touch do not overlap at sep 0. */
export function boxesOverlap(a: Box, b: Box, sep = 0): boolean {
  return a.x - sep < b.x + b.w && b.x - sep < a.x + a.w && a.y - sep < b.y + b.h && b.y - sep < a.y + a.h;
}

/** Whether box a lies inside box b. */
export function boxInside(a: Box, b: Box): boolean {
  return a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
}

/** Whether a bubble's disc and a box share any area. */
export function circleOverlapsBox(c: Circle, b: Box): boolean {
  return distToBox(c.cx, c.cy, b) < c.r;
}

/** Whether a segment touches a closed box (Liang-Barsky clipping). */
export function segmentHitsBox(s: Segment, b: Box): boolean {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const p = [-dx, dx, -dy, dy];
  const q = [s.x1 - b.x, b.x + b.w - s.x1, s.y1 - b.y, b.y + b.h - s.y1];
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false;
      continue;
    }
    const t = q[i] / p[i];
    if (p[i] < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
  }
  return true;
}

function orient(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function onSegment(s: Segment, px: number, py: number): boolean {
  return px >= Math.min(s.x1, s.x2) && px <= Math.max(s.x1, s.x2) && py >= Math.min(s.y1, s.y2) && py <= Math.max(s.y1, s.y2);
}

/** Whether two segments cross or touch. */
export function segmentsCross(a: Segment, b: Segment): boolean {
  const d1 = orient(b.x1, b.y1, b.x2, b.y2, a.x1, a.y1);
  const d2 = orient(b.x1, b.y1, b.x2, b.y2, a.x2, a.y2);
  const d3 = orient(a.x1, a.y1, a.x2, a.y2, b.x1, b.y1);
  const d4 = orient(a.x1, a.y1, a.x2, a.y2, b.x2, b.y2);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return (d1 === 0 && onSegment(b, a.x1, a.y1)) || (d2 === 0 && onSegment(b, a.x2, a.y2)) || (d3 === 0 && onSegment(a, b.x1, b.y1)) || (d4 === 0 && onSegment(a, b.x2, b.y2));
}

/** Whether a segment passes through a bubble's disc. */
export function segmentHitsCircle(s: Segment, c: Circle): boolean {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((c.cx - s.x1) * dx + (c.cy - s.y1) * dy) / len2));
  const ex = s.x1 + t * dx - c.cx;
  const ey = s.y1 + t * dy - c.cy;
  return Math.sqrt(ex * ex + ey * ey) < c.r;
}

const sign = (v: number): -1 | 0 | 1 => (v > 1e-9 ? 1 : v < -1e-9 ? -1 : 0);

/**
 * The box for a position at distance d from the bubble's centre: the box's
 * point nearest the centre is centre + d·u. Straight right, left, up or down
 * the box is centred on that axis or slid flush to one side of it; on a
 * diagonal its near corner is the point.
 */
function boxToward(c: Circle, pos: Pos, d: number, w: number, h: number): { box: Box; side: -1 | 0 | 1; px: number; py: number } {
  const u = DIRS[pos[0]];
  const slide = pos[1];
  const px = c.cx + u[0] * d;
  const py = c.cy + u[1] * d;
  const sx = sign(u[0]);
  const sy = sign(u[1]);
  const x = sx === 1 ? px : sx === -1 ? px - w : px - w / 2 + (slide * w) / 2;
  const y = sy === 1 ? py : sy === -1 ? py - h : py - h / 2 + (slide * h) / 2;
  return { box: { x, y, w, h }, side: sx !== 0 ? sx : slide, px, py };
}

interface State {
  bubbles: Circle[];
  /** Ids of every requested label, placed yet or not. */
  labelled: Set<string>;
  boxes: Box[];
  leaders: Segment[];
  opts: PlaceOptions;
}

/** Whether a box may go here at all: inside the bounds, clear of keep-outs, other labels and every leader. */
function boxFree(box: Box, st: State): boolean {
  if (!boxInside(box, st.opts.bounds)) return false;
  for (const k of st.opts.keepOut) if (boxesOverlap(box, k)) return false;
  for (const b of st.boxes) if (boxesOverlap(box, b, st.opts.separation)) return false;
  for (const l of st.leaders) if (segmentHitsBox(l, box)) return false;
  return true;
}

/** Whether a leader may go here: clear of every placed box, every keep-out and every other leader. */
function leaderFree(leader: Segment, st: State): boolean {
  for (const b of st.boxes) if (segmentHitsBox(leader, b)) return false;
  for (const k of st.opts.keepOut) if (segmentHitsBox(leader, k)) return false;
  for (const l of st.leaders) if (segmentsCross(leader, l)) return false;
  return true;
}

/** An unleadered box reads as its bubble's only when every other bubble's edge is `margin` px farther away. */
function unambiguous(box: Box, own: Circle, st: State): boolean {
  const mine = edgeDistance(box, own);
  for (const c of st.bubbles) if (c.id !== own.id && edgeDistance(box, c) < mine + st.opts.margin) return false;
  return true;
}

/** Whether a box covers part of another labelled bubble, where it would read as that bubble's label. */
function overLabelled(box: Box, own: Circle, st: State): boolean {
  for (const c of st.bubbles) if (c.id !== own.id && st.labelled.has(c.id) && circleOverlapsBox(c, box)) return true;
  return false;
}

/** Whether a leader passes through another labelled bubble, unless that bubble covers this one's centre and no leader could avoid it. */
function throughLabelled(leader: Segment, own: Circle, st: State): boolean {
  for (const c of st.bubbles) {
    if (c.id === own.id || !st.labelled.has(c.id) || !segmentHitsCircle(leader, c)) continue;
    const dx = own.cx - c.cx;
    const dy = own.cy - c.cy;
    if (dx * dx + dy * dy >= c.r * c.r) return true;
  }
  return false;
}

/** Whether a leader's bubble end is a visible point of its own bubble: `clear` px outside every other bubble's disc. */
export function startVisible(x: number, y: number, own: Circle, bubbles: Circle[], clear: number): boolean {
  for (const c of bubbles) {
    if (c.id === own.id) continue;
    const dx = x - c.cx;
    const dy = y - c.cy;
    const lim = c.r + clear;
    if (lim > 0 && dx * dx + dy * dy < lim * lim) return false;
  }
  return true;
}

function overCost(box: Box, own: Circle, st: State): number {
  let n = 0;
  for (const c of st.bubbles) if (c.id !== own.id && circleOverlapsBox(c, box)) n++;
  return n * OVER_BUBBLE;
}

function throughCost(leader: Segment, own: Circle, st: State): number {
  let n = 0;
  for (const c of st.bubbles) if (c.id !== own.id && segmentHitsCircle(leader, c)) n++;
  return n * THROUGH_BUBBLE;
}

/** The cheapest valid position for one label, the first of equal cost winning; null when none is valid. */
function best(req: LabelRequest, own: Circle, st: State): PlacedLabel | null {
  let found: PlacedLabel | null = null;
  let low = Infinity;
  for (let rank = 0; rank < BESIDE.length; rank++) {
    const { box, side } = boxToward(own, BESIDE[rank], own.r + st.opts.gap, req.w, req.h);
    if (!boxFree(box, st) || !unambiguous(box, own, st)) continue;
    const cost = overCost(box, own, st) + rank * SIDE_STEP;
    if (cost < low) {
      low = cost;
      found = { id: req.id, box, side, leader: null };
    }
  }
  // A leader's bubble end depends only on its direction, so the directions
  // whose end another bubble covers are ruled out once, for every ring.
  const visible = AROUND.map(([k]) => startVisible(own.cx + DIRS[k][0] * own.r, own.cy + DIRS[k][1] * own.r, own, st.bubbles, st.opts.clear));
  for (const ring of st.opts.rings) {
    for (let rank = 0; rank < AROUND.length; rank++) {
      if (!visible[rank]) continue;
      const u = DIRS[AROUND[rank][0]];
      const { box, side, px, py } = boxToward(own, AROUND[rank], own.r + ring, req.w, req.h);
      const leader: Segment = { x1: own.cx + u[0] * own.r, y1: own.cy + u[1] * own.r, x2: px, y2: py };
      if (!boxFree(box, st) || !leaderFree(leader, st) || overLabelled(box, own, st) || throughLabelled(leader, own, st)) continue;
      const cost = overCost(box, own, st) + LEADER + ring + throughCost(leader, own, st) + (rank * SIDE_STEP) / 4;
      if (cost < low) {
        low = cost;
        found = { id: req.id, box, side, leader };
      }
    }
  }
  return found;
}

/** Place labels for `requests` (highest priority first) among `bubbles`. Pure and deterministic. */
export function placeLabels(requests: LabelRequest[], bubbles: Circle[], opts: PlaceOptions): Placement {
  const byId = new Map<string, Circle>();
  for (const b of bubbles) {
    if (byId.has(b.id)) throw new Error(`two bubbles share the id "${b.id}"`);
    byId.set(b.id, b);
  }
  const seen = new Set<string>();
  for (const r of requests) {
    if (seen.has(r.id)) throw new Error(`label "${r.id}" is requested twice`);
    if (!byId.has(r.id)) throw new Error(`label "${r.id}" has no bubble`);
    seen.add(r.id);
  }
  const required = new Set(opts.required);
  for (const id of required) if (!seen.has(id)) throw new Error(`required label "${id}" is not requested`);
  const order = [...requests.filter((r) => required.has(r.id)), ...requests.filter((r) => !required.has(r.id))];

  const st: State = { bubbles, labelled: seen, boxes: [], leaders: [], opts };
  const placed: PlacedLabel[] = [];
  const dropped: Placement["dropped"] = [];
  for (const req of order) {
    const must = required.has(req.id);
    if (!must && placed.length >= opts.max) {
      dropped.push({ id: req.id, reason: "cap" });
      continue;
    }
    const p = best(req, byId.get(req.id) as Circle, st);
    if (!p) {
      if (must) throw new Error(`no position for the required label "${req.id}"`);
      dropped.push({ id: req.id, reason: "no room" });
      continue;
    }
    placed.push(p);
    st.boxes.push(p.box);
    if (p.leader) st.leaders.push(p.leader);
  }
  return { placed, dropped };
}
