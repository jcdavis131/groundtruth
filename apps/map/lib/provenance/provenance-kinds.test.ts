import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COMPUTED_METHOD } from "./estimates";
import { judgeSite, literalText, scanSource, type PublishedSite } from "./estimatesSites";

// "published = relayed as-is; estimate = computed here" (types.ts), held where the entry is written. estimates.test.ts
// judges entries in replies it can fetch; this walks the source of apps/map/lib and apps/map/app and judges every
// provenance entry labelled `kind: "published"` by its method text, so a seventh computed-and-published entry cannot
// be added without a test going red, whether or not any fixture or route test reaches it. W5A (#87) found six by
// reading; W6A (this file) makes the reading a test.

const MAP = fileURLToPath(new URL("../../", import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "__fixtures__" || e.name === "node_modules" ? [] : sources(p);
    return /\.(ts|tsx|mjs)$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : [];
  });
}

/** Published entries in a planted source text; the text is what a file under lib/ would hold. */
const sitesIn = (src: string): PublishedSite[] => scanSource(src, "planted.ts").sites;

describe("the scanner, on planted source", () => {
  const entry = (method: string) => `import { provenance, source } from "@/lib/provenance/types";\nexport const a = provenance(source("fema-openfema"), {\n  kind: "published",\n  method: ${method},\n});\n`;

  it("finds a published entry whose method says it computed, with its line and source id", () => {
    const [site, ...rest] = sitesIn(entry('"per year: distinct disasterNumber by the year of declarationDate"'));
    expect(rest).toEqual([]);
    expect(site).toMatchObject({ file: "planted.ts", line: 3, sourceId: "fema-openfema", method: "per year: distinct disasterNumber by the year of declarationDate", methodIsDynamic: false, hasInputs: false });
    expect(judgeSite(site)).toMatch(/its method says it was computed here: "per year/);
  });

  it("reads each word the rule names, and lets a relayed method through", () => {
    for (const m of ["computed from the rows", "aggregate of the rows", "sum of the rows", "count of the rows", "per year", "change from last month", "derived from the rows", "changePct = (a - b) / b"]) {
      const [site] = sitesIn(entry(JSON.stringify(m)));
      expect(judgeSite(site), m).not.toBeNull();
    }
    for (const m of ["county names and FIPS the export joins to (lib/places/data/counties.json, TIGERweb ACS2023)", "baked by scripts/bake-cms-hospitals.mjs; a key shared by two hospitals is never attached", "observationNormals, day of year: percentiles (5th to 95th) of approved daily-mean discharge (00060) for the calendar day"]) {
      const [site] = sitesIn(entry(JSON.stringify(m)));
      expect(judgeSite(site), m).toBeNull();
    }
  });

  it("an entry with no method, or an estimate or a snapshot that says it computed, is not a finding", () => {
    expect(judgeSite(sitesIn('const a = provenance(source("fred"), { kind: "published", seriesId: "MORTGAGE30US" });')[0])).toBeNull();
    expect(sitesIn('const a = provenance(source("x"), { kind: "estimate", method: "sum of rows" });')).toEqual([]);
    expect(sitesIn('const a = provenance(source("x"), { kind: "snapshot", method: "count of rows" });')).toEqual([]);
  });

  it("an entry that names inputs is a finding even with a clean method", () => {
    const [site] = sitesIn('provenance(source("x"), { kind: "published", method: "as published", inputs: [{ sourceId: "x", retrievedAt: "t" }] });');
    expect(site.hasInputs).toBe(true);
    expect(judgeSite(site)).toMatch(/names inputs/);
  });

  it("a method that is not a literal is refused, because its words cannot be read", () => {
    for (const m of ["PRICES.meta.method", "describe(table)", "`${a}` + b"]) {
      const [site] = sitesIn(entry(m));
      expect(site.methodIsDynamic, m).toBe(true);
      expect(judgeSite(site), m).toMatch(/not a literal/);
    }
  });

  it("reads a template or a joined method by its text, not by what is inside ${...}", () => {
    expect(literalText("`reports per year where ${Math.round(MAX * 100)} % or more`")).toBe("reports per year where  % or more");
    expect(literalText('"a" + \'b\' + `c ${x + `${y}`}`')).toBe("abc ");
    expect(judgeSite(sitesIn(entry("`baked from ${files.length} files, ${count} of them`"))[0])).toBeNull();
    expect(judgeSite(sitesIn(entry("`reports per year where ${Math.round(MAX * 100)} %`"))[0])).toMatch(/per year/);
    expect(judgeSite(sitesIn(entry('"sum of " + "the rows"'))[0])).toMatch(/sum/);
  });

  it("a brace, a quote, a regex or a comment before the entry cannot hide it or move its edges", () => {
    const src = [
      "// kind: \"published\" in a comment is not an entry",
      "/* nor is kind: \"published\" in a block comment { */",
      'const text = "}{ kind: \\"published\\" ,";',
      "const re = /[\"'{}`]/g;",
      "const t = `a } ${ { b: 1 }.b } kind: \"published\" ${ `nested ${ 1 }` }`;",
      "const apos = 'it\\'s';",
      "export const p = provenance(source('noaa-spc'), {",
      "  seriesId: 'x, y',",
      "  kind: 'published',",
      "  method: 'distinct tornadoes per year naming the county',",
      "  notes: ['a } b, c'],",
      "});",
    ].join("\n");
    const { sites, typeMembers } = scanSource(src, "planted.ts");
    expect(typeMembers).toBe(0);
    expect(sites).toHaveLength(1);
    expect(sites[0]).toMatchObject({ line: 9, sourceId: "noaa-spc", method: "distinct tornadoes per year naming the county" });
    expect(judgeSite(sites[0])).not.toBeNull();
  });

  it("a union or an interface member is a type, not an entry", () => {
    const { sites, typeMembers } = scanSource('export interface P {\n  kind: "published" | "estimate";\n}\nexport interface Q {\n  kind: "published";\n  method: string;\n}', "planted.ts");
    expect(sites).toEqual([]);
    expect(typeMembers).toBe(2);
  });

  it("finds an entry in a list, in a call, after another entry, and says which of two is the computed one", () => {
    const src = 'export const l = [provenance(source("a"), { kind: "published", method: "as published" }), provenance(source("b"), { kind: "published", method: "sum of rows" })];';
    const sites = sitesIn(src);
    expect(sites.map((s) => s.sourceId)).toEqual(["a", "b"]);
    expect(sites.map((s) => judgeSite(s) === null)).toEqual([true, false]);
  });
});

/**
 * Published entries that the words flag and that are right. Each is read, not guessed: the entry relays a figure the
 * publisher computed. An entry here must still match one site and still be flagged by the words; otherwise it is
 * stale and fails, so the list cannot outlive its reason.
 */
const RELAYED: Array<{ file: string; methodStartsWith: string; why: string }> = [
  {
    file: "lib/releases/movers.ts",
    methodStartsWith: "changePct is BLS's published over-the-year percent change",
    why: "BLS publishes the over-the-year percent change; the movers row relays it as changePct and sets before and changeAbs to null because nothing is computed here",
  },
];

describe("every provenance entry labelled published under apps/map/lib and apps/map/app", () => {
  const files = ["lib", "app"].flatMap((d) => sources(path.join(MAP, d)));
  const rel = (f: string) => path.relative(MAP, f).split(path.sep).join("/");
  const scans = files.map((f) => ({ file: rel(f), src: readFileSync(f, "utf8") })).map(({ file, src }) => ({ file, src, ...scanSource(src, file) }));
  const sites = scans.flatMap((s) => s.sites);

  it("sees the tree, not nothing (a floor, not a count to maintain)", () => {
    expect(files.length).toBeGreaterThan(500);
    expect(sites.length).toBeGreaterThan(140);
    // the entries that still carry a literal method (the TIGERweb join, BLS's own change, the CMS join, USGS's normals) were read
    expect(sites.filter((s) => s.method !== null).length).toBeGreaterThanOrEqual(3);
  });

  it("loses none to the lexer: every `kind: \"published\"` written as code is an entry or a type member", () => {
    const lost: string[] = [];
    for (const s of scans) {
      // a match on a comment line is not code
      const code = s.src.split("\n").filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join("\n");
      const raw = (code.match(/\bkind\s*:\s*["']published["']/g) ?? []).length;
      if (raw !== s.sites.length + s.typeMembers) lost.push(`${s.file}: ${raw} written, ${s.sites.length} entries and ${s.typeMembers} type members read`);
    }
    expect(lost).toEqual([]);
  });

  it("no entry says its value was computed here, names inputs, or hides its method behind a variable", () => {
    const reviewed = new Set<PublishedSite>();
    const found: string[] = [];
    for (const s of sites) {
      const why = judgeSite(s);
      if (!why) continue;
      const ok = RELAYED.find((r) => r.file === s.file && s.method !== null && s.method.startsWith(r.methodStartsWith));
      if (ok) reviewed.add(s);
      else found.push(`${s.file}:${s.line}${s.sourceId ? ` (${s.sourceId})` : ""}: labelled published, but ${why}`);
    }
    expect(found).toEqual([]);
    expect(reviewed.size).toBe(RELAYED.length);
  });

  it("each reviewed exception still matches exactly one entry that the words flag", () => {
    for (const r of RELAYED) {
      const hit = sites.filter((s) => s.file === r.file && s.method !== null && s.method.startsWith(r.methodStartsWith));
      expect(hit.length, `${r.file}: "${r.methodStartsWith}" no longer matches one entry; delete the exception (${r.why})`).toBe(1);
      expect(COMPUTED_METHOD.test(hit[0].method as string), `${r.file}: the words no longer flag this entry; delete the exception`).toBe(true);
    }
  });

  it("a computed entry planted in a real file is found there", () => {
    const real = scans.find((s) => s.file === "lib/releases/movers.ts");
    expect(real).toBeDefined();
    const planted = `${real!.src}\nexport const seventh = provenance(source("zillow-zhvi"), { kind: "published", method: "sum of the rows by region" });\n`;
    const after = scanSource(planted, "lib/releases/movers.ts").sites;
    expect(after.length).toBe(real!.sites.length + 1);
    const last = after[after.length - 1];
    expect(last.sourceId).toBe("zillow-zhvi");
    expect(judgeSite(last)).toMatch(/says it was computed here/);
  });
});
