// Ratchet: a record URL or query that asks an ArcGIS layer for outFields=* returns every field the publisher
// holds, including ones the item withholds (a private dam's name, a water system's name). New code names its
// fields. The count of wildcard sites in source (tests and recorded fixtures excluded) may fall and never rise.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** Wildcard outFields sites in apps/map/lib and apps/map/app source on 2026-10-20: fabric/fetch.ts (`outFields: "*"`) and world.ts's `arcgisRecord` default (`outFields = "*"`, used by the NRI, SVI and hospital record URLs). Lower it when one goes; never raise it. */
const BASELINE = 2;
const BASELINE_DATE = "2026-10-20";

const MAP = fileURLToPath(new URL("../../", import.meta.url));
const WILDCARD = /outFields\s*[=:]\s*["'`]?\*/g;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "__fixtures__" || e.name === "node_modules" ? [] : sources(p);
    return /\.(ts|tsx|mjs)$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : [];
  });
}

describe(`outFields=* ratchet (baseline ${BASELINE} on ${BASELINE_DATE})`, () => {
  it("does not rise above the committed baseline", () => {
    const hits = ["lib", "app"].flatMap((d) => sources(path.join(MAP, d))).flatMap((f) => (readFileSync(f, "utf8").match(WILDCARD) ?? []).map(() => path.relative(MAP, f)));
    expect(hits.length, `wildcard outFields in: ${hits.join(", ")}`).toBeLessThanOrEqual(BASELINE);
  });
});
