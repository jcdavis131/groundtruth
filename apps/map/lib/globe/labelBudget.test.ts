import { describe, expect, it } from "vitest";
import { labelBox, labelBudget, overlaps, placeLabels, type LabelCandidate } from "./labelBudget";

const c = (key: string, x: number, y: number, text: string, priority = 10, extra: Partial<LabelCandidate> = {}): LabelCandidate => ({ key, x, y, text, priority, ...extra });

describe("label budget", () => {
  it("scales with the screen and stays within bounds", () => {
    expect(labelBudget(390, 844)).toBe(14);
    expect(labelBudget(1440, 900)).toBe(36);
    expect(labelBudget(200, 200)).toBe(6);
  });

  it("estimates a box from the text at the default offset", () => {
    const b = labelBox(c("a", 100, 100, "ABCDEFGHIJ"));
    expect(b.x).toBe(111);
    expect(b.w).toBe(Math.ceil(10 * 6.7) + 6);
    expect(b.y + b.h / 2).toBe(88);
  });

  it("keeps the higher priority of two colliding labels", () => {
    const out = placeLabels([c("weather:1", 100, 200, "31 °C · drizzle", 12), c("constructs:here", 104, 202, "Here · 24 constructs", 60)], { width: 390, height: 844 });
    expect([...out]).toEqual(["constructs:here"]);
  });

  it("drops a label that would run off the right edge instead of clipping it", () => {
    const out = placeLabels([c("x", 330, 300, "CONGRESSIONAL DISTRICT · TX-27")], { width: 390, height: 844 });
    expect(out.size).toBe(0);
    // The same label further left fits.
    expect(placeLabels([c("x", 40, 300, "CONGRESSIONAL DISTRICT · TX-27")], { width: 390, height: 844 }).has("x")).toBe(true);
  });

  it("keeps labels off the HUD", () => {
    const out = placeLabels([c("a", 100, 70, "Sports venue")], { width: 390, height: 844, blocked: [{ x: 0, y: 0, w: 390, h: 60 }] });
    expect(out.size).toBe(0);
  });

  it("respects the budget, but a pinned (selected) label still gets through", () => {
    const many = Array.from({ length: 40 }, (_, i) => c(`n${i}`, 20, 30 + i * 20, `L${i}`, 10));
    const pinned = c("sel", 200, 400, "Selected", 1, { pinned: true });
    const out = placeLabels([...many, pinned], { width: 390, height: 844, budget: 5 });
    expect(out.has("sel")).toBe(true);
    expect(out.size).toBe(6);
  });

  it("never lets two kept labels overlap, whatever the input", () => {
    // A dense cluster like a phone view of weather + sports + places.
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const cands = Array.from({ length: 300 }, (_, i) => c(`k${i}`, rnd() * 390, rnd() * 844, "x".repeat(4 + Math.floor(rnd() * 20)), Math.floor(rnd() * 60)));
    const out = placeLabels(cands, { width: 390, height: 844 });
    const boxes = cands.filter((x) => out.has(x.key)).map((x) => labelBox(x));
    expect(boxes.length).toBeGreaterThan(3);
    expect(boxes.length).toBeLessThanOrEqual(labelBudget(390, 844));
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w).toBeLessThanOrEqual(390);
      for (let j = i + 1; j < boxes.length; j++) expect(overlaps(b, boxes[j])).toBe(false);
    }
  });

  it("is stable: the same input gives the same set", () => {
    const cands = [c("a", 100, 100, "Alpha", 10), c("b", 110, 104, "Bravo", 10), c("c", 300, 600, "Charlie", 10)];
    expect([...placeLabels(cands, { width: 390, height: 844 })]).toEqual([...placeLabels([...cands].reverse(), { width: 390, height: 844 })]);
  });

  it("skips anchors that did not project", () => {
    expect(placeLabels([c("a", Number.NaN, 10, "A")], { width: 390, height: 844 }).size).toBe(0);
  });
});
