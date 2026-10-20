// Rendered with react-dom/server, as components/hud/FrontDoor.test.tsx does:
// @testing-library/react and a DOM environment are not installed here.
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BreaksFile } from "@/lib/breaks";
import type { Coverage, Vitals } from "@/lib/fabric/emergence";
import { legendFor } from "@/lib/fabric/legend";
import { indexLegend, legendOfIndex } from "@/lib/globe/indexStyles";
import FieldLegend from "./FieldLegend";

const v = (value: number | null, coverage: Coverage, reason?: string): Vitals => ({
  total: value ?? 0,
  byLayer: {},
  density: null,
  value,
  heat: 0,
  coverage,
  ...(reason ? { reason } : {}),
  rank: 0,
  display: "",
});

const swatches = (html: string) => (html.match(/data-legend-swatch/g) ?? []).length;

describe("FieldLegend", () => {
  const vitals = new Map<string, Vitals>([
    ["county:48201", { ...v(1204, "complete"), heat: 1 }],
    ["county:48453", { ...v(90, "complete"), heat: Math.sqrt(90 / 1204) }],
    ["county:48029", v(null, "partial", "schools not loaded here: outside the loaded box")],
    ["county:48113", v(null, "none", "schools not loaded here: outside the loaded box")],
    ["county:48439", v(null, "none", "no area known for this unit, so no density")],
  ]);
  const legend = legendFor(vitals, "schools", "density", (id) => (id === "county:48201" ? "Harris County" : id));

  it("renders one swatch per entry, the units, the maximum unit's name, and the not-loaded count with its top reason", () => {
    const html = renderToStaticMarkup(<FieldLegend legend={legend} />);
    expect(swatches(html)).toBe(legend.entries.length);
    expect(html).toContain("per 1,000 km²");
    expect(html).toContain("scaled to Harris County, 1,204");
    expect(html).toContain("3 not loaded");
    expect(html).toContain("schools not loaded here: outside the loaded box");
    // No text under 12 px on a phone sheet.
    expect(html).not.toMatch(/text-\[(?:[0-9]|1[01])(?:\.\d+)?px\]/);
  });
  it("renders no not-loaded row when every unit is loaded", () => {
    const loaded = new Map([...vitals].filter(([, x]) => x.value != null));
    const l = legendFor(loaded, "schools", "density");
    const html = renderToStaticMarkup(<FieldLegend legend={l} />);
    expect(swatches(html)).toBe(l.entries.length);
    expect(l.entries.some((e) => e.kind === "not-loaded")).toBe(false);
    expect(html).not.toContain("not loaded");
  });
  it("renders honestly when nothing is in view", () => {
    const l = legendFor(new Map(), "all", "count");
    const html = renderToStaticMarkup(<FieldLegend legend={l} />);
    expect(swatches(html)).toBe(l.entries.length);
    expect(html).not.toContain("scaled to");
  });
});

// The index layers' key, with the universe and n of the committed breaks the bins were cut from.
// The expected strings are read from the breaks file on disk, not from the loader the legend uses.
const breaksOnDisk = (measure: string) => JSON.parse(readFileSync(path.resolve(__dirname, "../../data/breaks/health", `${measure}.json`), "utf8")) as BreaksFile;
const escaped = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

describe("FieldLegend for an index layer", () => {
  it("names the universe and n of the layer's committed breaks, and says tracts are binned on the county breaks", () => {
    for (const measure of ["DIABETES", "COLON_SCREEN"] as const) {
      const file = breaksOnDisk(measure);
      const html = renderToStaticMarkup(<FieldLegend legend={legendOfIndex("health", { placesMeasure: measure })} />);
      expect(html, measure).toContain(escaped(file.universe));
      expect(html, measure).toContain(`n=${file.n}`);
      expect(html, measure).toContain(escaped(`tracts binned on national county breaks (n=${file.n})`));
      expect(html, measure).toContain("crude");
      expect(html, measure).toContain("age-adjusted");
    }
  });

  it("labels the five bins with the committed break values, one swatch per entry", () => {
    const file = breaksOnDisk("DIABETES");
    const [a, b, c, d] = file.breaks;
    const legend = legendOfIndex("health", { placesMeasure: "DIABETES" });
    expect(legend.entries.filter((e) => e.kind === "class").map((e) => e.label)).toEqual([`under ${a} %`, `${a} to ${b} %`, `${b} to ${c} %`, `${c} to ${d} %`, `${d} % or more`]);
    const html = renderToStaticMarkup(<FieldLegend legend={legend} />);
    expect(swatches(html)).toBe(legend.entries.length);
    expect(html).not.toMatch(/text-\[(?:[0-9]|1[01])(?:\.\d+)?px\]/);
  });

  it("a layer with fixed publisher breaks has no scale line, and the plain PLACES key still says fifths", () => {
    expect(legendOfIndex("vulnerability").scale).toBeUndefined();
    const html = renderToStaticMarkup(<FieldLegend legend={legendOfIndex("vulnerability")} />);
    expect(html).not.toMatch(/\(n=\d/);
    expect(indexLegend("health").filter((e) => e.kind === "class")[0].label).toContain("lowest");
  });
});
