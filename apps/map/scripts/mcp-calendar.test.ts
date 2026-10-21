import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as ts from "typescript";
import { cadenceOf, RELEASE_CALENDAR } from "../lib/releases/calendar";
import { emitCalendar } from "./mcp-calendar.mjs";

// scripts/mcp-stdio.mjs hands world_context the release calendar the way app/api/mcp/route.ts does (0.7.0). lib/mcp
// compiles alone, and lib/releases/calendar.ts imports a type from "@/lib/provenance/sources", which tsc cannot resolve
// there, so the script emits that one file with TypeScript's transpileModule (no type-check, a type-only import is
// dropped) through emitCalendar. The script itself starts a server and runs tsc over lib/mcp, so it is not run here:
// these tests hold the step it adds, and read the script's source for the two lines that use it.
describe("scripts/mcp-calendar.mjs: the release calendar the stdio server passes to createServer", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "gev-mcp-cal-"));
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  const calendarTs = path.resolve(__dirname, "../lib/releases/calendar.ts");

  it("emits lib/releases/calendar.ts as a module that exports cadenceOf and imports nothing, so it runs beside the tsc emit of lib/mcp", async () => {
    const file = path.join(dir, "emitted.mjs");
    emitCalendar(ts, calendarTs, file);
    const text = await readFile(file, "utf8");
    expect(text).toContain("export function cadenceOf");
    expect(text, "an import left in the emit would not resolve beside .tmp-mcp").not.toMatch(/^\s*import\s/m);
  });

  it("its cadenceOf answers as the route's does, for every source in the calendar and for one the calendar has no entry for", async () => {
    const file = path.join(dir, "answers.mjs");
    emitCalendar(ts, calendarTs, file);
    const mod = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as { cadenceOf: (sourceId: string) => unknown };
    const ids = [...new Set(RELEASE_CALENDAR.map((e) => e.sourceId))];
    expect(ids.length).toBeGreaterThan(5);
    for (const id of ids) expect(mod.cadenceOf(id), id).toEqual(cadenceOf(id));
    expect(mod.cadenceOf("usdm")).toEqual({ kind: "weekly", precision: "official", source: "usdm" });
    expect(mod.cadenceOf("sec-edgar")).toBeNull();
  });

  it("is what mcp-stdio.mjs uses: it emits through emitCalendar and passes cadenceOf to createServer as releaseCadence", async () => {
    const script = await readFile(path.resolve(__dirname, "mcp-stdio.mjs"), "utf8");
    expect(script).toContain('from "./mcp-calendar.mjs"');
    expect(script).toContain("emitCalendar(ts, calendarSrc, calendarOut)");
    expect(script).toMatch(/createServer\(\{[^}]*releaseCadence: \(sourceId\) => cadenceOf\(sourceId\)/);
  });
});
