import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COMPUTED_METHOD } from "./estimates";
import { judgeSite, literalText, scanSource, type PublishedSite, type SourceScan } from "./estimatesSites";

// "published = relayed as-is; estimate = computed here" (types.ts), held where the entry is written. estimates.test.ts
// judges entries in replies it can fetch; this walks the source of apps/map/lib and apps/map/app and judges every
// provenance entry labelled `kind: "published"` by its method text, so a seventh computed-and-published entry cannot
// be added without a test going red, whether or not any fixture or route test reaches it. W5A (#87) found six by
// reading; W6A (this file) makes the reading a test.
//
// Round 2 (review of 7fdac06). The scanner decides entry or type by what follows the closing quote of "published":
// `,` or `}` is an entry, anything else a type member. It read only that first character, so an entry written as
// `kind: "published" as const,`, `kind: "published" satisfies Kind,` or as a last property with a trailing comment
// (`kind: "published" // note` then `}`) was filed as a type member, was never judged, and the loses-none check
// balanced (raw == entries + type members), so nothing saw it. The idiom is house style for other kinds
// (lib/globe/indexStyles.ts, lib/hazards/history.ts, lib/places/links.ts), none "published" today: latent, not live.
// Fixed in lex() (it reads past comments, `as` and `satisfies`), and the loses-none check no longer trusts the lexer's
// own classification: every type member it reports must also read as a type in the raw text. Planted cases for each
// form are below. Still not seen, and said so in docs/MCP.md: a spread, a kind held in a variable, a quoted key
// ("kind": "published"), a parenthesised or backticked value, a ternary, and a method written `"..." as const` (read as
// not a literal, so refused).
//
// Round 3 (review of aa34a59). One residual of the same class: `kind: "published" || "estimate",` and `&&` were filed
// as a type member by the lexer (it returned the `|` or `&`) and counted type-like by writtenPublished() below (it
// took any `|` or `&` for a union or an intersection), so entries 0 / type members 1 / misread null: balanced and
// unjudged, and tsc accepts both (the type stays "published"; eslint-config-next does not enable
// no-constant-binary-expression). Now `||` and `&&` are an expression: the lexer files an entry with kindIsExpression,
// judgeSite refuses it, and writtenPublished() counts `|` and `&` as a type position only when the next character is
// not the same. Refused on purpose, not judged: `as const` or `satisfies T` on the line after the value is a clean entry
// that writtenPublished() reads as the next interface member, so the file is refused (none in the tree). Shared with
// the forms above and not covered: `| 0`, `& 1` and a newline then `in obj` after the value read as types to both
// readings; tsc refuses them (reported by the round-2 reviewer; tsc is not run on them here).

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

  it("also flags a relayed method whose prose merely uses the word (a false positive: fail closed, and the reviewed list below is where it goes)", () => {
    // `counts?` and `changes?` are words a publisher's own description uses too; the rule cannot tell, so it refuses and a reviewer lists the entry
    for (const m of ["the station count the publisher lists, relayed as is", "the publisher changes this list each release; relayed as is"]) {
      expect(judgeSite(sitesIn(entry(JSON.stringify(m)))[0]), m).toMatch(/its method says it was computed here/);
    }
    // the one reviewed exception is such a case: BLS publishes the over-the-year percent change itself
    expect(COMPUTED_METHOD.test("changePct is BLS's published over-the-year percent change")).toBe(true);
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

describe("the scanner, on a published value followed by something other than a comma", () => {
  const COMPUTED = 'method: "sum of the rows by region"';
  /** One object literal, the property list given, in the shape the house style uses. */
  const wrap = (lines: string[]) => `export const a = provenance(source("zillow-zhvi"), {\n${lines.map((l) => `  ${l}`).join("\n")}\n});\n`;
  /** Exactly one entry, not filed as a type, and judged: the sum-of-rows method is a finding. */
  const judgedOnce = (src: string) => {
    const scan = scanSource(src, "planted.ts");
    expect(scan.typeMembers).toBe(0);
    expect(scan.sites).toHaveLength(1);
    expect(judgeSite(scan.sites[0])).toMatch(/its method says it was computed here: "sum of the rows/);
    return scan.sites[0];
  };

  it("kind: \"published\" as const, is an entry and is judged", () => {
    expect(judgedOnce(wrap(['kind: "published" as const,', `${COMPUTED},`]))).toMatchObject({ line: 2, sourceId: "zillow-zhvi", method: "sum of the rows by region" });
  });

  it("a last property with no comma and a trailing line comment is an entry and is judged", () => {
    expect(judgedOnce(wrap([`${COMPUTED},`, 'kind: "published" // note']))).toMatchObject({ line: 3, method: "sum of the rows by region" });
    // the comment's own comma, brace and quote do not move the object's edges
    expect(judgedOnce(wrap([`${COMPUTED},`, "kind: \"published\" // relayed, as-is } it's fine"]))).toMatchObject({ line: 3, method: "sum of the rows by region" });
  });

  it("kind: \"published\" satisfies Kind, is an entry and is judged", () => {
    judgedOnce(wrap(['kind: "published" satisfies Kind,', `${COMPUTED},`]));
    judgedOnce(wrap(['kind: "published" satisfies Pick<Provenance, "kind">,', `${COMPUTED},`]));
  });

  it("a block comment, or as const and satisfies together, between the value and the comma or brace", () => {
    judgedOnce(wrap(['kind: "published" /* relayed, not computed */,', `${COMPUTED},`]));
    judgedOnce(wrap([`${COMPUTED},`, 'kind: "published" /* last property } */']));
    judgedOnce(wrap(['kind: "published" as const satisfies Kind,', `${COMPUTED},`]));
    judgedOnce(wrap(['kind: "published" /* a */ // b\n  as const,', `${COMPUTED},`]));
  });

  it("the same forms in a type position are still types: a comment after a union or an interface member, a member named as", () => {
    for (const src of [
      'export interface P {\n  kind: "published" // relayed\n  method: string\n}',
      'export type K = { kind: "published" /* a */ | "estimate" };',
      'export interface P {\n  kind: "published"\n  as: string\n}',
      'export interface P {\n  kind: "published"; // relayed\n  method: string;\n}',
    ]) {
      const scan = scanSource(src, "planted.ts");
      expect(scan.sites, src).toEqual([]);
      expect(scan.typeMembers, src).toBe(1);
    }
  });
});

/**
 * `kind: "published"` written as code in one source text, and how many of those read as a type there: followed, past
 * whitespace and comments, by `|` or `&` (alone: `||` and `&&` are expressions) or `;`, or by the next member of an
 * interface on a later line. This does not use the lexer, so it can check the lexer's classification instead of
 * repeating it.
 */
function writtenPublished(src: string): { all: number; typeLike: number } {
  // a match on a comment line is not code
  const code = src.split("\n").filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join("\n");
  const re = /\bkind\s*:\s*["']published["']/g;
  let all = 0;
  let typeLike = 0;
  for (let m = re.exec(code); m; m = re.exec(code)) {
    all++;
    let k = m.index + m[0].length;
    let newline = false;
    while (k < code.length) {
      if (/\s/.test(code[k])) {
        if (code[k] === "\n") newline = true;
        k++;
      } else if (code.startsWith("//", k)) {
        const e = code.indexOf("\n", k);
        k = e < 0 ? code.length : e;
      } else if (code.startsWith("/*", k)) {
        const e = code.indexOf("*/", k + 2);
        k = e < 0 ? code.length : e + 2;
      } else break;
    }
    const ch = k < code.length ? code[k] : "";
    // `|` and `&` are a union and an intersection only alone; `||` and `&&` are expressions (tsc accepts them after a string)
    const typeOperator = (ch === "|" || ch === "&") && code[k + 1] !== ch;
    if (ch !== "" && (typeOperator || ch === ";" || (newline && /[A-Za-z_$]/.test(ch)))) typeLike++;
  }
  return { all, typeLike };
}

/** Why a scan of one file cannot be trusted, or null: a written `kind: "published"` it lost, or one it filed as a type that does not read as one. */
function misread(src: string, scan: SourceScan): string | null {
  const w = writtenPublished(src);
  if (w.all !== scan.sites.length + scan.typeMembers) return `${w.all} written, ${scan.sites.length} entries and ${scan.typeMembers} type members read`;
  if (scan.typeMembers !== w.typeLike) return `${scan.typeMembers} read as type members, but ${w.typeLike} sit where a type is written (after | & ; or as the next member)`;
  return null;
}

describe("the loses-none check does not trust the lexer's own classification", () => {
  it("a form filed as a type member that is not written like a type is refused, whatever the lexer made of it", () => {
    // what 7fdac06's lexer did with each of the first three, and aa34a59's with the last two: no entry, one type member,
    // and raw == entries + type members balanced. The scan is handed in, so this holds whatever the lexer does today.
    for (const line of ['kind: "published" as const,', 'kind: "published" satisfies Kind,', 'kind: "published" // note', 'kind: "published" || "estimate",', 'kind: "published" && "published",']) {
      const src = `export const a = provenance(source("x"), {\n  method: "sum of rows",\n  ${line}\n});`;
      expect(misread(src, { sites: [], typeMembers: 1 }), line).toMatch(/1 read as type members, but 0 sit where a type is written/);
    }
  });

  it("a form the lexer cannot place is filed as a type member and refused by the check, not passed", () => {
    // `||` and `&&` were on this list in the red commit 6ee0cfa; the lexer now reads them as entries, tested below
    for (const line of ['kind: "published".toString(),', 'kind: "published" + "",', 'kind: "published" ?? "x",', 'kind: "published"!,']) {
      const src = `export const a = provenance(source("x"), {\n  method: "sum of rows",\n  ${line}\n});`;
      const scan = scanSource(src, "planted.ts");
      expect(scan.sites, line).toEqual([]);
      expect(misread(src, scan), line).toMatch(/1 read as type members, but 0 sit where a type is written/);
    }
  });

  it("an entry and a type, read correctly, balance both ways", () => {
    for (const src of [
      'export interface P {\n  kind: "published" | "estimate";\n}\nexport const a = provenance(source("x"), { kind: "published" as const, method: "as published" });',
      'export interface P {\n  kind: "published" // relayed\n  method: string\n}\nexport const a = provenance(source("x"), {\n  method: "as published",\n  kind: "published" // note\n});',
    ]) {
      expect(misread(src, scanSource(src, "planted.ts"))).toBeNull();
    }
  });

  it("a written kind the lexer never saw is still counted as lost", () => {
    expect(misread('const a = { kind: "published", method: "x" };', { sites: [], typeMembers: 0 })).toMatch(/1 written, 0 entries and 0 type members read/);
  });
});

describe("a published value that continues as an expression, and the forms this check refuses on purpose", () => {
  /** An object literal with a clean method, so any refusal below comes from the kind alone. */
  const wrap = (lines: string[]) => `export const a = provenance(source("x"), {\n${lines.map((l) => `  ${l}`).join("\n")}\n});\n`;
  const CLEAN = 'method: "as published",';

  it("kind: \"published\" || \"estimate\", and && are entries whose kind is an expression, and judgeSite refuses them", () => {
    for (const line of ['kind: "published" || "estimate",', 'kind: "published" && "published",', 'kind: "published"||"estimate",', 'kind: "published" /* c */ && "published",']) {
      const src = wrap([CLEAN, line]);
      const scan = scanSource(src, "planted.ts");
      expect(scan.typeMembers, line).toBe(0);
      expect(scan.sites, line).toHaveLength(1);
      expect(scan.sites[0].kindIsExpression, line).toBe(true);
      expect(judgeSite(scan.sites[0]), line).toMatch(/its kind is an expression/);
      // both readings agree it is not a type: one entry, no type member, and nothing written like a type
      expect(misread(src, scan), line).toBeNull();
    }
  });

  it("a plain entry, as const and satisfies are not expressions; a union or an intersection is still a type", () => {
    for (const line of ['kind: "published",', 'kind: "published" as const,', 'kind: "published" satisfies Kind,']) {
      const [site, ...rest] = scanSource(wrap([CLEAN, line]), "planted.ts").sites;
      expect(rest, line).toEqual([]);
      expect(site.kindIsExpression, line).toBe(false);
      expect(judgeSite(site), line).toBeNull();
    }
    for (const src of ['export interface P {\n  kind: "published" | "estimate";\n}', 'export type K = { kind: "published"|"estimate" };', 'export type K = { kind: "published" & Tagged };', 'export type K = {\n  kind: "published"\n    | "estimate";\n};']) {
      const scan = scanSource(src, "planted.ts");
      expect(scan.sites, src).toEqual([]);
      expect(scan.typeMembers, src).toBe(1);
      expect(misread(src, scan), src).toBeNull();
    }
  });

  it("as const or satisfies on the line after the value is a clean entry that the raw-text check refuses (fail closed)", () => {
    for (const next of ["as const,", "satisfies Kind,"]) {
      const src = wrap(["kind: \"published\"", next, CLEAN]);
      const scan = scanSource(src, "planted.ts");
      expect(scan.typeMembers, next).toBe(0);
      expect(scan.sites, next).toHaveLength(1);
      expect(judgeSite(scan.sites[0]), next).toBeNull();
      // the raw text reads the next line's first word as the next interface member, so the two readings disagree and the file is refused
      expect(misread(src, scan), next).toMatch(/0 read as type members, but 1 sit where a type is written/);
    }
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

/** The walk's verdict on a list of entries: what it fails, and how many reviewed exceptions it let through. */
function verdict(list: PublishedSite[]): { found: string[]; reviewed: number } {
  const out = { found: [] as string[], reviewed: 0 };
  for (const s of list) {
    const why = judgeSite(s);
    if (!why) continue;
    if (RELAYED.some((r) => r.file === s.file && s.method !== null && s.method.startsWith(r.methodStartsWith))) out.reviewed++;
    else out.found.push(`${s.file}:${s.line}${s.sourceId ? ` (${s.sourceId})` : ""}: labelled published, but ${why}`);
  }
  return out;
}

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

  it("loses none to the lexer: every `kind: \"published\"` written as code is an entry or a type member, and every type member reads as a type", () => {
    const lost: string[] = [];
    for (const s of scans) {
      const why = misread(s.src, s);
      if (why) lost.push(`${s.file}: ${why}`);
    }
    expect(lost).toEqual([]);
  });

  it("no entry says its value was computed here, names inputs, or hides its method behind a variable", () => {
    const v = verdict(sites);
    expect(v.found).toEqual([]);
    expect(v.reviewed).toBe(RELAYED.length);
  });

  it("each reviewed exception still matches exactly one entry that the words flag", () => {
    for (const r of RELAYED) {
      const hit = sites.filter((s) => s.file === r.file && s.method !== null && s.method.startsWith(r.methodStartsWith));
      expect(hit.length, `${r.file}: "${r.methodStartsWith}" no longer matches one entry; delete the exception (${r.why})`).toBe(1);
      expect(COMPUTED_METHOD.test(hit[0].method as string), `${r.file}: the words no longer flag this entry; delete the exception`).toBe(true);
    }
  });

  /** The whole tree's entries with one file's source replaced by `src`. */
  const withFile = (file: string, src: string): PublishedSite[] => scans.flatMap((s) => (s.file === file ? scanSource(src, file).sites : s.sites));

  it("a seventh computed entry planted in a real file turns the walk red, and only that entry", () => {
    const real = scans.find((s) => s.file === "lib/releases/movers.ts");
    expect(real).toBeDefined();
    const planted = `${real!.src}\nexport const seventh = provenance(source("zillow-zhvi"), { kind: "published", method: "sum of the rows by region" });\n`;
    const v = verdict(withFile("lib/releases/movers.ts", planted));
    expect(v.found).toHaveLength(1);
    expect(v.found[0]).toMatch(/^lib\/releases\/movers\.ts:\d+ \(zillow-zhvi\): labelled published, but its method says it was computed here: "sum of the rows/);
    expect(v.reviewed).toBe(RELAYED.length);
  });

  it("relabelling the six entries W5A found back to published turns the walk red on exactly those six", () => {
    for (const [file, n] of [["lib/hazards/history.ts", 3], ["lib/releases/movers.ts", 3]] as const) {
      const real = scans.find((s) => s.file === file);
      expect(real, file).toBeDefined();
      // the three estimates in each file are the entries that were published and computed; any other `kind: "estimate"` would be counted here
      expect(real!.src.split('kind: "estimate"').length - 1, `${file}: estimates written`).toBe(n);
      const back = real!.src.split('kind: "estimate"').join('kind: "published"');
      const v = verdict(withFile(file, back));
      expect(v.found, file).toHaveLength(n);
    }
  });

  it("the estimates among those entries name their inputs, so the relabel above would also be caught by the inputs rule", () => {
    for (const file of ["lib/hazards/history.ts", "lib/releases/movers.ts"]) {
      const real = scans.find((s) => s.file === file)!;
      const back = scanSource(real.src.split('kind: "estimate"').join('kind: "published"'), file).sites;
      expect(back.filter((s) => s.hasInputs), file).toHaveLength(3);
    }
  });
});
