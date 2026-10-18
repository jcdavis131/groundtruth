// The label placer on the flagship fixture (real QCEW rows), on every canvas
// in both themes: label boxes never meet, no leader crosses a label, every
// leader starts on a visible part of its own bubble (inside no other disc),
// an unleadered label's nearest bubble edge is its own, keep-outs are left
// alone, the subject is always placed, every requested label is accounted
// for as placed or dropped, and no two labels read the same. Then the placer
// on its own, on real bubble geometry from the same layout: a keep-out on the
// subject's first choice moves it, a bubble whose centre lies inside another
// is led from the visible part of its edge or dropped, the cap drops from the bottom of the ranking, and a subject with nowhere to
// go throws rather than vanish.

import { describe, expect, it } from "vitest";
import FIXTURE from "./fixtures/flagship-qcew-2019-2023.json";
import { CANVASES, CANVAS_IDS } from "./canvas";
import { LABEL_CAP, RINGS, displayLabels, layoutBubble, requestedLabels, type BubbleLayout } from "./charts/bubble";
import { textBox, type Box } from "./frame";
import { boxInside, boxesOverlap, circleOverlapsBox, edgeDistance, placeLabels, segmentHitsBox, segmentHitsCircle, segmentsCross, startVisible, type Circle, type PlaceOptions } from "./place";
import { textNodes } from "./scene";
import { parseChartSpec, type BubbleSpec } from "./spec";
import { THEMES } from "./tokens";

const SPEC = parseChartSpec(FIXTURE) as BubbleSpec;
const SUBJECT = "C1242";
/** The same chart with both zero lines labelled, so reference-line keep-outs sit inside the plot. */
const REFERENCED: BubbleSpec = {
  ...SPEC,
  x: { ...SPEC.x, reference: [{ value: 0, label: "No change" }] },
  y: { ...SPEC.y, reference: [{ value: 0, label: "No change" }] },
};

const shrink = (b: Box, by: number): Box => ({ x: b.x + by, y: b.y + by, w: b.w - 2 * by, h: b.h - 2 * by });
const circles = (L: BubbleLayout): Circle[] => L.marks.map((m) => ({ id: m.id, cx: m.cx, cy: m.cy, r: m.r }));

describe.each(CANVAS_IDS)("%s canvas", (id) => {
  describe.each(THEMES)("%s", (theme) => {
    const L = layoutBubble(SPEC, id, theme);
    const mark = new Map(L.marks.map((m) => [m.id, m]));

    it("places the subject (Austin, C1242)", () => {
      expect(L.placed.map((p) => p.id)).toContain(SUBJECT);
      expect(L.placed[0].id).toBe(SUBJECT);
    });

    it("accounts for every requested label exactly once, as placed or dropped", () => {
      const placed = L.placed.map((p) => p.id);
      const dropped = L.dropped.map((d) => d.id);
      expect([...placed, ...dropped].sort()).toEqual([...L.requested].sort());
      expect(new Set([...placed, ...dropped]).size).toBe(L.requested.length);
      expect(L.requested).toEqual(requestedLabels(L.frame.spec as BubbleSpec));
      expect(placed.length).toBeLessThanOrEqual(LABEL_CAP[id]);
    });

    it("never lets two label boxes intersect, and keeps every box inside the plot", () => {
      for (let i = 0; i < L.placed.length; i++) {
        expect(boxInside(L.placed[i].box, L.frame.plot), L.placed[i].id).toBe(true);
        for (let j = i + 1; j < L.placed.length; j++) expect(boxesOverlap(L.placed[i].box, L.placed[j].box), `${L.placed[i].id} / ${L.placed[j].id}`).toBe(false);
      }
    });

    it("never lets a leader touch another label's box, enter its own, or cross another leader", () => {
      const leadered = L.placed.filter((p) => p.leader);
      for (const p of leadered) {
        const leader = p.leader as NonNullable<typeof p.leader>;
        expect(segmentHitsBox(leader, shrink(p.box, 0.01)), `${p.id} enters its own box`).toBe(false);
        for (const q of L.placed) if (q.id !== p.id) expect(segmentHitsBox(leader, q.box), `${p.id} leader / ${q.id} box`).toBe(false);
        for (const q of leadered) if (q.id !== p.id) expect(segmentsCross(leader, q.leader as NonNullable<typeof q.leader>), `${p.id} / ${q.id} leaders`).toBe(false);
      }
    });

    it("gives every unleadered label a box whose nearest bubble edge is its own", () => {
      for (const p of L.placed.filter((q) => !q.leader)) {
        const own = edgeDistance(p.box, mark.get(p.id) as Circle);
        for (const m of L.marks) if (m.id !== p.id) expect(edgeDistance(p.box, m), `${L.text[p.id]} is nearer ${m.id}`).toBeGreaterThan(own);
      }
    });

    it("starts each leader on its own bubble's edge and never runs it through, or a box over, another labelled bubble", () => {
      const labelled = new Set(L.placed.map((p) => p.id));
      for (const p of L.placed) {
        const own = mark.get(p.id) as Circle;
        for (const m of L.marks) {
          if (m.id === p.id || !labelled.has(m.id)) continue;
          expect(circleOverlapsBox(m, p.box), `${p.id} box over ${m.id}`).toBe(false);
          const covers = (own.cx - m.cx) ** 2 + (own.cy - m.cy) ** 2 < m.r ** 2;
          if (p.leader && !covers) expect(segmentHitsCircle(p.leader, m), `${p.id} leader through ${m.id}`).toBe(false);
        }
        if (p.leader) expect(Math.sqrt((p.leader.x1 - own.cx) ** 2 + (p.leader.y1 - own.cy) ** 2)).toBeCloseTo(own.r, 9);
      }
    });

    it("starts every leader on a visible part of its own bubble: inside no other disc, least of all a larger one drawn over it", () => {
      const order = new Map(L.marks.map((m, i) => [m.id, i]));
      const clear = 2 * Math.max(CANVASES[id].scale, 0.5);
      for (const p of L.placed) {
        if (!p.leader) continue;
        const own = mark.get(p.id) as Circle;
        for (const m of L.marks) {
          if (m.id === p.id) continue;
          const d = Math.sqrt((p.leader.x1 - m.cx) ** 2 + (p.leader.y1 - m.cy) ** 2);
          const largerOver = m.r > own.r && (order.get(m.id) as number) > (order.get(p.id) as number);
          expect(largerOver && d < m.r, `${L.text[p.id]} leader ends under the larger ${m.id}, drawn over it`).toBe(false);
          expect(d, `${L.text[p.id]} leader starts inside ${m.id}`).toBeGreaterThanOrEqual(m.r + clear);
        }
      }
    });

    it("draws no two labels with the same text", () => {
      const texts = L.placed.map((p) => L.text[p.id]);
      expect(new Set(texts).size).toBe(texts.length);
      const drawn = textNodes(L.nodes)
        .filter((t) => t.role === "label")
        .map((t) => t.text);
      expect(new Set(drawn).size).toBe(drawn.length);
    });
  });
});

describe.each(CANVAS_IDS)("keep-outs on the %s canvas", (id) => {
  const L = layoutBubble(REFERENCED, id, "dark");
  const legend = L.frame.runs.filter((r) => r.node.role === "legend").map((r) => textBox(r.node));
  const reference = L.frame.keepOut;

  it("has legend and reference-line keep-outs to respect, the reference ones inside the plot", () => {
    expect(legend.length).toBeGreaterThan(0);
    expect(reference.length).toBe(2);
    for (const k of reference) expect(boxesOverlap(k, L.frame.plot)).toBe(true);
    for (const k of [...legend, ...reference]) expect(L.keepOut).toContainEqual(k);
  });

  it("leaves every legend run and reference-line label untouched by label boxes and leaders", () => {
    for (const p of L.placed) {
      for (const k of [...legend, ...reference]) {
        expect(boxesOverlap(p.box, k), `${p.id} box`).toBe(false);
        if (p.leader) expect(segmentHitsBox(p.leader, k), `${p.id} leader`).toBe(false);
      }
    }
    expect(L.placed[0].id).toBe(SUBJECT);
  });
});

describe("label policy", () => {
  it("ranks the subject, the named peers, the extremes, then the largest |size|", () => {
    const names = displayLabels(SPEC.data);
    expect(requestedLabels(SPEC).map((id) => names[id])).toEqual([
      "Austin",
      // labels.ids, the four plotted metros that beat Austin on either axis, by |size|
      "Huntsville",
      "Cape Coral",
      "Palm Bay",
      "Tallahassee",
      // extremes: highest x is Austin and highest y is Huntsville, already in
      "Spartanburg",
      "Ann Arbor",
      // topBySize 16, less those already in
      "Dallas",
      "Phoenix",
      "Houston",
      "Miami",
      "Riverside",
      "Tampa",
      "Orlando",
      "Raleigh",
      "Las Vegas",
      "Salt Lake City",
      "San Antonio",
      "Pittsburgh",
      "Indianapolis",
      "Jacksonville",
      "Los Angeles",
    ]);
  });

  it("qualifies a short label two rows share, plotted or not, and leaves the rest alone", () => {
    const names = displayLabels(SPEC.data);
    expect(SPEC.data.filter((d) => d.label === "Springfield").map((d) => d.id)).toEqual(["C4414", "C4418"]);
    expect(SPEC.data.filter((d) => d.label === "Portland").map((d) => d.id)).toEqual(["C3886", "C3890"]);
    expect([names.C4414, names.C4418, names.C3886, names.C3890]).toEqual(["Springfield, MA", "Springfield, MO", "Portland, ME", "Portland, OR"]);
    expect(names.C1242).toBe("Austin");
    expect(new Set(Object.values(names)).size).toBe(SPEC.data.length);
  });

  it("draws the qualified label when a shared name is labelled", () => {
    const s: BubbleSpec = { ...SPEC, labels: { ...SPEC.labels, ids: ["C4414"] } };
    const L = layoutBubble(s, "social", "dark");
    expect(L.placed.map((p) => p.id)).toContain("C4414");
    const drawn = textNodes(L.nodes).filter((t) => t.role === "label").map((t) => t.text);
    expect(drawn).toContain("Springfield, MA");
    expect(drawn).not.toContain("Springfield");
  });

  it("drops a named label whose row is not plotted, as not plotted", () => {
    // Springfield, MO: goods-producing growth withheld, so there is no bubble to label.
    const s: BubbleSpec = { ...SPEC, labels: { ...SPEC.labels, ids: ["C4418"] } };
    const L = layoutBubble(s, "social", "dark");
    expect(L.requested).toContain("C4418");
    expect(L.dropped).toContainEqual({ id: "C4418", reason: "not plotted" });
  });
});

describe("placeLabels on the flagship's bubbles", () => {
  const L = layoutBubble(SPEC, "social", "dark");
  const bubbles = circles(L);
  const austin = L.placed.find((p) => p.id === SUBJECT) as BubbleLayout["placed"][number];
  const opts: PlaceOptions = { bounds: L.frame.plot, keepOut: [], max: 30, required: [SUBJECT], gap: 3, margin: 4, separation: 1, clear: 2, rings: [16, 28, 42] };
  const req = { id: SUBJECT, w: austin.box.w, h: austin.box.h };

  it("moves the subject off a keep-out laid over its first choice", () => {
    const first = placeLabels([req], bubbles, opts).placed[0];
    expect(first.box).toEqual(austin.box);
    const moved = placeLabels([req], bubbles, { ...opts, keepOut: [first.box] }).placed[0];
    expect(boxesOverlap(moved.box, first.box)).toBe(false);
    expect(boxInside(moved.box, L.frame.plot)).toBe(true);
  });

  it("throws when the subject has nowhere to go, rather than drop it", () => {
    expect(() => placeLabels([req], bubbles, { ...opts, keepOut: [L.frame.plot] })).toThrow(/required label "C1242"/);
  });

  it("leads a bubble whose centre lies inside another's from the visible part of its edge, or drops it", () => {
    // Orlando's centre lies inside Dallas's disc; only an arc of its edge, facing away from Dallas, shows.
    const m = new Map(L.marks.map((x) => [x.id, x]));
    const dallas = m.get("C1910") as Circle;
    const orlando = m.get("C3674") as Circle;
    expect((orlando.cx - dallas.cx) ** 2 + (orlando.cy - dallas.cy) ** 2).toBeLessThan(dallas.r ** 2);
    const req = { id: "C3674", w: 82, h: 23 };
    const full = { ...opts, required: [], keepOut: L.keepOut, rings: [...RINGS] };
    // Alone on the plot it is placed, with a leader that starts outside Dallas.
    const alone = placeLabels([req], bubbles, full).placed[0];
    const lead = alone.leader as NonNullable<typeof alone.leader>;
    expect(lead).not.toBeNull();
    expect(startVisible(lead.x1, lead.y1, orlando, bubbles, opts.clear)).toBe(true);
    expect(Math.sqrt((lead.x1 - dallas.cx) ** 2 + (lead.y1 - dallas.cy) ** 2)).toBeGreaterThanOrEqual(dallas.r + opts.clear);
    // With no clearance rule (a clearance of minus the plot's width) the same request is led from inside Dallas.
    const blind = placeLabels([req], bubbles, { ...full, clear: -L.frame.plot.w }).placed[0];
    const start = blind.leader as NonNullable<typeof blind.leader>;
    expect(Math.sqrt((start.x1 - dallas.cx) ** 2 + (start.y1 - dallas.cy) ** 2)).toBeLessThan(dallas.r);
    // Among the flagship's other labels every visible start is blocked, so it is dropped, not led from inside Dallas.
    expect(L.placed.map((p) => p.id)).not.toContain("C3674");
    expect(L.dropped).toContainEqual({ id: "C3674", reason: "no room" });
  });

  it("caps from the bottom of the ranking and still places a required label listed last", () => {
    const ids = L.requested.filter((x) => x !== SUBJECT).slice(0, 5);
    const reqs = [...ids, SUBJECT].map((x) => {
      const p = L.placed.find((q) => q.id === x) as BubbleLayout["placed"][number];
      return { id: x, w: p.box.w, h: p.box.h };
    });
    const out = placeLabels(reqs, bubbles, { ...opts, max: 3 });
    expect(out.placed.map((p) => p.id)).toEqual([SUBJECT, ids[0], ids[1]]);
    expect(out.dropped).toEqual(ids.slice(2).map((x) => ({ id: x, reason: "cap" })));
  });

  it("refuses a request without a bubble and a request made twice", () => {
    expect(() => placeLabels([{ id: "C0000", w: 10, h: 10 }], bubbles, { ...opts, required: [] })).toThrow(/no bubble/);
    expect(() => placeLabels([req, req], bubbles, opts)).toThrow(/twice/);
  });
});
