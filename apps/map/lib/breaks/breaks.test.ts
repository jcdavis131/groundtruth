// The committed breaks/1 files (apps/map/data/breaks): 40 CDC PLACES county measures and the four place
// exports. Every file validates against breaks.schema.json (with the repo's own schema evaluator,
// data/schema/validate.mjs) and against the rules a schema cannot say; its provenance matches the
// committed input it was computed from; its breaks are recomputed here with code that is not the
// script's and not the app's; and scripts/export-breaks.mjs regenerates every file byte for byte.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { PLACE_EXPORTS } from "@/lib/catalog/placeExport";
import { countyMeasureUrl, PLACES_MEASURES, type PlacesMeasure } from "@/lib/civic/places";
import { buildAll } from "../../scripts/export-breaks.mjs";
import { PLACE_EXPORT_BREAKS, placesBreaks, scaleOf, tractCaveat, type BreaksFile, type BreaksPage } from "./index";

const APP = path.resolve(__dirname, "../..");
const DIR = path.join(APP, "data/breaks");
const REPO = path.resolve(APP, "../..");

type SchemaProblem = { code: string; path: string; message: string };
let schemaErrors: (value: unknown, schema: unknown) => SchemaProblem[];

beforeAll(async () => {
  // The evaluator lives at the repo root; a runtime path keeps vite from bundling it.
  const href = pathToFileURL(path.join(REPO, "data/schema/validate.mjs")).href;
  const mod = (await import(/* @vite-ignore */ href)) as { schemaErrors: typeof schemaErrors };
  schemaErrors = mod.schemaErrors;
});

const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, "utf8")) as T;
const sha256 = (file: string): string => createHash("sha256").update(readFileSync(file)).digest("hex");
const schema = () => readJson<unknown>(path.join(DIR, "breaks.schema.json"));
const load = (rel: string): BreaksFile => readJson<BreaksFile>(path.join(DIR, rel));

/** The place exports: the committed file each is computed from, and the one headline measure its breaks file carries. */
const EXPORTS: Record<string, { file: string; feature: string; year: number | null }> = {
  "npl-status": { file: "lib/catalog/data/npl-county.json", feature: "npl_active", year: 2025 },
  "ust-releases-county": { file: "lib/catalog/data/ust-releases-county.json", feature: "ust_release_count", year: null },
  "ust-facilities-county": { file: "lib/catalog/data/ust-facilities-county.json", feature: "ust_facility_count", year: null },
  "fuds-properties": { file: "lib/catalog/data/fuds-county.json", feature: "fuds_properties", year: null },
};
const PLACES = Object.keys(PLACES_MEASURES) as PlacesMeasure[];
const EXPECTED = [...PLACES.map((m) => `health/${m}.json`), ...Object.entries(EXPORTS).map(([layer, e]) => `${layer}/${e.feature}.json`)].sort();

/** Every breaks file on disk as "<layer>/<measure>.json"; the inputs folder holds inputs, not breaks. */
function breaksFiles(): string[] {
  if (!existsSync(DIR)) return [];
  const out: string[] = [];
  for (const d of readdirSync(DIR, { withFileTypes: true })) {
    if (!d.isDirectory() || d.name === "inputs") continue;
    for (const f of readdirSync(path.join(DIR, d.name))) if (f.endsWith(".json")) out.push(`${d.name}/${f}`);
  }
  return out.sort();
}

/** The schema's problems plus the rules JSON Schema cannot say. */
function problemsOf(file: unknown): string[] {
  const out = schemaErrors(file, schema()).map((e) => `${e.path} ${e.code}: ${e.message}`);
  const f = file as Partial<BreaksFile>;
  if (Array.isArray(f.breaks)) for (let i = 1; i < f.breaks.length; i++) if (!(f.breaks[i] > f.breaks[i - 1])) out.push(`breaks are not strictly increasing at ${i}`);
  if (!(typeof f.n === "number" && f.n > 0)) out.push("n must be above 0");
  if (f.source) {
    const one = typeof f.source.sha256 === "string";
    const paged = Array.isArray(f.source.pages);
    if (one === paged) out.push("source needs exactly one of sha256 (one fetched body) and pages (a paginated source)");
  }
  return out;
}

/** Nearest rank, the stated rule: sorted[min(n-1, floor(q*n))]. */
const nearestRank = (sorted: number[], q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

interface PlacesInput {
  schema: string;
  layer: string;
  measure: string;
  source: { url: string; retrievedAt: string; lastModified: string | null; sha256: string; rows: number };
  values: Array<[string, number | null]>;
}

interface ExportJson {
  meta: { features: string[]; years: number[] | null; zero_vs_missing: string; source: { layer: string; fetchedAt: string; serviceDataLastEdit?: string; pages: BreaksPage[] } };
  places: string[];
  value: unknown[];
  nullPlaces: Record<string, string>;
}

/** One value per county of the committed county table, from the export file alone: null, 0 from a complete census, or the cell. */
function exportCells(layer: string): { cells: Array<number | null>; json: ExportJson } {
  const e = EXPORTS[layer];
  const json = readJson<ExportJson>(path.join(APP, e.file));
  const counties = readJson<{ rows: Array<{ geoid: string }> }>(path.join(APP, "lib/places/data/counties.json")).rows.map((r) => r.geoid);
  const at = new Map(json.places.map((g, i) => [g, i] as const));
  const fi = json.meta.features.indexOf(e.feature);
  const yi = e.year == null || !json.meta.years ? -1 : json.meta.years.indexOf(e.year);
  expect(fi, `${layer} feature ${e.feature}`).toBeGreaterThanOrEqual(0);
  const cells = counties.map((g) => {
    if (g in json.nullPlaces) return null;
    const i = at.get(g);
    if (i === undefined) {
      if (json.meta.zero_vs_missing !== "complete-census") throw new Error(`${layer}: county ${g} has no row and the export is not a complete census`);
      return 0;
    }
    return yi >= 0 ? (json.value[i] as Array<Array<number | null>>)[yi][fi] : (json.value[i] as Array<number | null>)[fi];
  });
  return { cells, json };
}

describe("the committed breaks/1 files", () => {
  it("are exactly the 40 PLACES county measures and the four place exports", () => {
    expect(Object.keys(EXPORTS).sort()).toEqual([...PLACE_EXPORTS].sort());
    expect(PLACES).toHaveLength(40);
    expect(breaksFiles()).toEqual(EXPECTED);
  });

  it("validate against breaks.schema.json: breaks strictly increasing, n above 0, one source form", () => {
    for (const rel of EXPECTED) expect(problemsOf(load(rel)), rel).toEqual([]);
  });

  it("name their own layer and measure, and carry four breaks (PLACES) or one to four (counts)", () => {
    for (const rel of EXPECTED) {
      const [layer, name] = rel.replace(/\.json$/, "").split("/");
      const f = load(rel);
      expect([f.layer, f.measure], rel).toEqual([layer, name]);
      if (layer === "health") {
        expect(f.breaks, rel).toHaveLength(4);
        expect(f.method, rel).toBe("quintile-nearest-rank");
        expect(f.valueType, rel).toContain("age-adjusted");
      } else {
        expect(f.breaks.length, rel).toBeGreaterThanOrEqual(1);
        expect(f.method, rel).toBe("zero-bin-quartile-nearest-rank");
      }
    }
  });

  it("PLACES: cite the CDC query, and the committed input is the body that was fetched", () => {
    for (const m of PLACES) {
      const f = load(`health/${m}.json`);
      const inputPath = `data/breaks/inputs/health/${m}.json`;
      expect(f.source.url, m).toBe(countyMeasureUrl(m));
      expect(f.input.path, m).toBe(inputPath);
      expect(f.input.sha256, m).toBe(sha256(path.join(APP, inputPath)));
      const input = readJson<PlacesInput>(path.join(APP, inputPath));
      expect(input.schema).toBe("breaks-input/1");
      // The breaks file repeats the input's fetch record: the url, time, last-modified and sha256 of the fetched body.
      expect(f.source, m).toEqual({ url: input.source.url, retrievedAt: input.source.retrievedAt, lastModified: input.source.lastModified, sha256: input.source.sha256 });
      expect(input.source.sha256, m).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("PLACES: breaks, n and nNull recompute from the committed county values with code of its own", () => {
    for (const m of PLACES) {
      const f = load(`health/${m}.json`);
      const input = readJson<PlacesInput>(path.join(APP, f.input.path));
      const published = input.values.map((v) => v[1]).filter((x): x is number => x != null).sort((a, b) => a - b);
      expect(f.breaks, m).toEqual([0.2, 0.4, 0.6, 0.8].map((q) => nearestRank(published, q)));
      expect(f.n, m).toBe(published.length);
      expect(f.nNull, m).toBe(input.values.length - published.length);
      // CDC's county rows for the measure are the measure list's count less the one national row.
      expect(f.n + f.nNull, m).toBe(PLACES_MEASURES[m].rows - 1);
    }
  });

  it("place exports: cite the publisher layer and every fetched page, and the committed export is the input", () => {
    for (const [layer, e] of Object.entries(EXPORTS)) {
      const f = load(`${layer}/${e.feature}.json`);
      const json = readJson<ExportJson>(path.join(APP, e.file));
      expect(f.input, layer).toEqual({ path: e.file, sha256: sha256(path.join(APP, e.file)) });
      expect(f.source.url, layer).toBe(json.meta.source.layer);
      expect(f.source.retrievedAt, layer).toBe(json.meta.source.fetchedAt);
      expect(f.source.lastModified, layer).toBe(json.meta.source.serviceDataLastEdit ?? null);
      expect(f.source.pages, layer).toEqual(json.meta.source.pages);
      expect(f.source.sha256, layer).toBeUndefined();
      for (const p of f.source.pages ?? []) expect(p.sha256, layer).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("place exports: breaks, n and nNull recompute from the export with code of its own (0 is its own bin)", () => {
    for (const [layer, e] of Object.entries(EXPORTS)) {
      const f = load(`${layer}/${e.feature}.json`);
      const { cells } = exportCells(layer);
      const valued = cells.filter((x): x is number => x != null);
      const positive = valued.filter((x) => x > 0).sort((a, b) => a - b);
      const expected = [...new Set([positive[0], nearestRank(positive, 0.25), nearestRank(positive, 0.5), nearestRank(positive, 0.75)])];
      expect(f.breaks, layer).toEqual(expected);
      expect(f.n, layer).toBe(valued.length);
      expect(f.nNull, layer).toBe(cells.length - valued.length);
      expect(f.n + f.nNull, layer).toBe(cells.length);
    }
  });

  it("regenerate byte for byte from the committed inputs (the script's --offline rule)", () => {
    const built = buildAll(APP);
    expect([...built.keys()].sort()).toEqual(EXPECTED.map((r) => `data/breaks/${r}`).sort());
    for (const [rel, bytes] of built) expect(readFileSync(path.join(APP, rel), "utf8"), rel).toBe(bytes);
  });

  it("are what the loader serves, for the layer, the route and the legend", () => {
    for (const m of PLACES) expect(placesBreaks(m), m).toEqual(load(`health/${m}.json`));
    for (const [layer, e] of Object.entries(EXPORTS)) expect(PLACE_EXPORT_BREAKS[layer], layer).toEqual(load(`${layer}/${e.feature}.json`));
  });
});

describe("the check has teeth", () => {
  const cases: Array<[string, (f: Record<string, unknown>) => void]> = [
    ["no n", (f) => void delete f.n],
    ["n of 0", (f) => void (f.n = 0)],
    ["equal neighbouring breaks", (f) => void (f.breaks = [8, 8, 9, 10])],
    ["falling breaks", (f) => void (f.breaks = [9, 8, 10, 11])],
    ["no breaks", (f) => void (f.breaks = [])],
    ["no universe", (f) => void delete f.universe],
    ["an empty universe", (f) => void (f.universe = "")],
    ["no source", (f) => void delete f.source],
    ["no retrievedAt", (f) => void delete (f.source as Record<string, unknown>).retrievedAt],
    ["a sha256 that is not a sha256", (f) => void ((f.source as Record<string, unknown>).sha256 = "abc")],
    ["neither sha256 nor pages", (f) => void delete (f.source as Record<string, unknown>).sha256],
    ["both sha256 and pages", (f) => void ((f.source as Record<string, unknown>).pages = [{ url: "https://example.org/a", sha256: "0".repeat(64), lastModified: null, rows: 1 }])],
    ["no input", (f) => void delete f.input],
    ["no method", (f) => void delete f.method],
    ["an unknown method", (f) => void (f.method = "terciles")],
    ["a wrong schema tag", (f) => void (f.schema = "breaks/2")],
    ["an unknown field", (f) => void (f.guess = 1)],
  ];
  for (const [name, mutate] of cases) {
    it(`rejects a file with ${name}`, () => {
      const f = structuredClone(load("health/DIABETES.json")) as unknown as Record<string, unknown>;
      mutate(f);
      expect(problemsOf(f).length).toBeGreaterThan(0);
    });
  }
  it("accepts the unmutated file", () => {
    expect(problemsOf(load("health/DIABETES.json"))).toEqual([]);
  });
});

describe("the legend's universe and n come from the file", () => {
  it("scaleOf reads the file's universe and n, and refuses a file without them", () => {
    const f = load("health/DIABETES.json");
    expect(scaleOf(f)).toEqual({ universe: f.universe, n: f.n });
    expect(() => scaleOf({ ...f, n: undefined } as unknown as BreaksFile)).toThrow(/\bn\b/);
    expect(() => scaleOf({ ...f, n: 0 })).toThrow(/\bn\b/);
    expect(() => scaleOf({ ...f, universe: "" })).toThrow(/universe/);
  });
  it("the tract caveat states n and that tracts are crude against age-adjusted county breaks", () => {
    const f = load("health/DIABETES.json");
    const text = tractCaveat(f);
    expect(text.startsWith(`tracts binned on national county breaks (n=${f.n})`)).toBe(true);
    expect(text).toContain("crude");
    expect(text).toContain(f.valueType);
    expect(() => tractCaveat({ ...f, n: undefined } as unknown as BreaksFile)).toThrow();
  });
});
