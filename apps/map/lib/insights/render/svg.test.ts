// The serialiser's determinism rules, and the module boundary: nothing under
// lib/insights/render may import from the Next.js package, so the renderer
// runs in plain Node (vite-node scripts, the Actions runner) as well as in a
// route.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { el, f2, toSvg } from "./svg";
import type { Scene } from "./scene";

describe("f2", () => {
  it("rounds to 0.01 and prints the shortest form", () => {
    expect(f2(12)).toBe("12");
    expect(f2(12.5)).toBe("12.5");
    expect(f2(0.1 + 0.2)).toBe("0.3");
    expect(f2(1 / 3)).toBe("0.33");
    expect(f2(-0.001)).toBe("0");
    expect(f2(-0)).toBe("0");
    expect(f2(-12.345)).toBe("-12.34");
  });

  it("refuses a non-finite coordinate", () => {
    expect(() => f2(NaN)).toThrow();
    expect(() => f2(Infinity)).toThrow();
  });
});

describe("el", () => {
  it("emits attributes in insertion order, skips null and escapes text", () => {
    expect(el("rect", { y: 2, x: 1.005, fill: "#000", "fill-opacity": undefined, title: null })).toBe('<rect y="2" x="1" fill="#000"/>');
    expect(el("text", { "data-q": `a"b<c>&'` }, "x")).toBe('<text data-q="a&quot;b&lt;c&gt;&amp;&apos;">x</text>');
  });
});

describe("toSvg", () => {
  const scene: Scene = {
    width: 100,
    height: 50,
    idPrefix: "itest",
    title: "A & B",
    desc: "d",
    defs: [{ id: "grain", w: 4, h: 4, children: [{ type: "rect", x: 1, y: 1, w: 1, h: 1, fill: "#fff", fillOpacity: 0.05 }] }],
    nodes: [
      { type: "rect", x: 0, y: 0, w: 100, h: 50, fill: "#05070a" },
      { type: "circle", cx: 10, cy: 10, r: 5, fill: null, stroke: { color: "#c9d1d9", opacity: 1 }, strokeWidth: 1.5 },
      { type: "text", role: "label", text: "Austin", x: 20, y: 30, anchor: "middle", size: 19, weight: 700, fill: "#ffa458", width: 60, halo: { color: "#05070a", opacity: 0.85, width: 4 } },
    ],
  };

  it("writes one element per line with the halo under the fill and no per-text font-family", () => {
    const svg = toSvg(scene, { inline: false, canvas: "social" });
    expect(svg.split("\n")).toEqual([
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50" role="img" aria-labelledby="itest-t itest-d" font-family="Geist,system-ui,sans-serif">',
      '<title id="itest-t">A &amp; B</title>',
      '<desc id="itest-d">d</desc>',
      '<defs><pattern id="itest-grain" width="4" height="4" patternUnits="userSpaceOnUse"><rect x="1" y="1" width="1" height="1" fill="#fff" fill-opacity="0.05"/></pattern></defs>',
      '<rect x="0" y="0" width="100" height="50" fill="#05070a"/>',
      '<circle cx="10" cy="10" r="5" fill="none" stroke="#c9d1d9" stroke-width="1.5"/>',
      '<text x="20" y="30" font-size="19" font-weight="700" text-anchor="middle" fill="none" stroke="#05070a" stroke-opacity="0.85" stroke-width="4" stroke-linejoin="round">Austin</text>',
      '<text x="20" y="30" font-size="19" font-weight="700" text-anchor="middle" fill="#ffa458">Austin</text>',
      "</svg>",
      "",
    ]);
  });
});

describe("module boundary", () => {
  it("imports nothing from the Next.js package anywhere under lib/insights/render", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx|mts|js|mjs)$/.test(e.name)) files.push(p);
      }
    };
    walk(__dirname);
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) expect(fs.readFileSync(f, "utf8"), path.basename(f)).not.toMatch(/from\s+["']next\/|require\(["']next\/|import\(["']next\//);
  });
});
