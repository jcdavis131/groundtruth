// Two boundaries around the people data (docs/PEOPLE.md):
//
// T1  What is stored. The committed bundle, the class overrides and every
//     fixture are walked: no address, mailing, phone, signature, footnote,
//     remarks or former-name key, and no value shaped like a US street line,
//     a PO box, a care-of line, a suite, a state and ZIP, or a phone number.
//     Keys match exactly, so "businesses", "stateFips" and "zips" pass.
//     And no individual's name carries one of EDGAR's disambiguators: a
//     5-digit run (a ZIP code), a 19xx or 20xx year standing alone (a birth
//     year), a "/XX" suffix (a state) or a state named in parentheses.
// T9  Who can read it. A static scan of every import in the app: nothing
//     imports lib/people/data; no client module, nothing under components/
//     (but the people client), and none of the map, place, parcel and fabric
//     modules imports lib/people; lib/people takes only lib/fabric/parties
//     from the fabric, and lib/fabric/parties imports nothing.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const rel = (abs: string) => path.relative(root, abs).split(path.sep).join("/");

// ---------------------------------------------------------------- T1

const FORBIDDEN_KEYS = new Set([
  "street1",
  "street2",
  "city",
  "state",
  "zip",
  "zipcode",
  "address",
  "mailing",
  "phone",
  "signature",
  "footnote",
  "remarks",
  "formerNames",
  "nonUSAddress",
]);

const STATES =
  "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR VI GU AS MP";
const SUFFIX =
  "st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|way|ct|court|pl|place|pkwy|parkway|hwy|highway|cir|circle|ter|terrace|sq|square|plz|plaza|loop|trl|trail|pike|row";
const VALUE_SHAPES: Array<[string, RegExp]> = [
  ["street line", new RegExp(`\\b\\d{1,6}\\s+(?:[NSEW]\\.?\\s+)?(?:[A-Za-z0-9.'-]+\\s+){0,3}(?:${SUFFIX})\\b`, "i")],
  ["PO box", /\bp\.?\s?o\.?\s*box\b/i],
  ["care-of line", /(?:^|\s)c\/o\b/i],
  ["suite or floor", /\b(?:suite|ste\.?)\s*#?\d|\b\d+(?:st|nd|rd|th)\s+floor\b|\bfloor\s+\d/i],
  ["state and ZIP", new RegExp(`\\b(?:${STATES.split(" ").join("|")})\\s+\\d{5}(?:-\\d{4})?\\b`)],
  ["phone number", /(?:^|[^\d-])\(?\d{3}\)?[-. ]\d{3}[-. ]\d{4}(?![\d-])/],
];

function shapeOf(value: string): string | null {
  for (const [label, re] of VALUE_SHAPES) if (re.test(value)) return label;
  return null;
}

/** Every forbidden key and address-shaped value in a parsed JSON tree, as "path: what". */
function leaks(tree: unknown, at = "$"): string[] {
  const out: string[] = [];
  const walk = (v: unknown, p: string) => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}[${i}]`));
    else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        if (FORBIDDEN_KEYS.has(k)) out.push(`${p}.${k}: forbidden key`);
        walk(x, `${p}.${k}`);
      }
    } else if (typeof v === "string") {
      const shape = shapeOf(v);
      if (shape) out.push(`${p}: ${shape}`);
    }
  };
  walk(tree, at);
  return out;
}

// EDGAR tells same-named filers apart with a token after the name. On an
// individual it is a location or a date about the person, so the builder
// drops it (scripts/people_classify.py, individual_name); entity and business
// names keep theirs ("EXAMPLE CORP /DE/").
const US_STATE_NAMES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware", "Florida", "Georgia",
  "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland",
  "Massachusetts", "Michigan", "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire",
  "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon", "Pennsylvania",
  "Rhode Island", "South Carolina", "South Dakota", "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington",
  "West Virginia", "Wisconsin", "Wyoming", "District of Columbia", "Puerto Rico", "Guam", "American Samoa",
  "U.S. Virgin Islands", "Virgin Islands", "Northern Mariana Islands",
];
const NAME_TOKEN_SHAPES: Array<[string, RegExp]> = [
  ["a 5-digit run", /\d{5}/],
  ["a 19xx or 20xx year", /(?<![A-Za-z0-9])(?:19|20)\d{2}(?![A-Za-z0-9])/],
  ["a /XX suffix", /\/\s*(?:[A-Za-z]{2,3}\s*\/?)?\s*$/],
  [
    "a state in parentheses",
    new RegExp(`\\(\\s*(?:${US_STATE_NAMES.map((s) => s.replace(/\./g, "\\.").replace(/ /g, "\\s+")).join("|")})\\s*\\)`, "i"),
  ],
];

function nameTokenOf(name: string): string | null {
  for (const [label, re] of NAME_TOKEN_SHAPES) if (re.test(name)) return label;
  return null;
}

/** Individual (class "i") rows whose name carries a disambiguator, as "issuer[row] owner: what" (never the name). */
function individualNameLeaks(bundle: { issuers?: Record<string, unknown[][]> }): string[] {
  const out: string[] = [];
  for (const [issuer, rows] of Object.entries(bundle.issuers ?? {})) {
    rows.forEach((r, i) => {
      if (r[2] !== "i" || typeof r[1] !== "string") return;
      const shape = nameTokenOf(r[1]);
      if (shape) out.push(`${issuer}[${i}] owner ${String(r[0])}: ${shape}`);
    });
  }
  return out;
}

function jsonFiles(dir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names.filter((f) => f.endsWith(".json")).map((f) => path.join(dir, f));
}

describe("T1: no address, signature, footnote or remarks in the people data", () => {
  it("catches each shape it is meant to catch", () => {
    for (const v of [
      "123 Main Street",
      "4500 N. Example Ave",
      "77 W Wacker Dr",
      "PO Box 12",
      "P.O. Box 7",
      "c/o Example Services LLC",
      "Suite 400",
      "Ste. 12",
      "22nd Floor",
      "CA 95014",
      "NY 10017-1234",
      "(212) 555-0100",
      "212-555-0100",
    ]) {
      expect(shapeOf(v), v).not.toBeNull();
    }
    expect(leaks({ issuers: { x: [{ street1: "x" }] } })).toEqual(["$.issuers.x[0].street1: forbidden key"]);
    expect(leaks({ owner: { remarks: null, formerNames: [] } })).toHaveLength(2);
  });

  it("passes what the bundle legitimately holds", () => {
    for (const v of [
      "Chief Executive Officer",
      "EVP & Chief Operating Officer",
      "SVP, Region 5",
      "2026-06-01",
      "0001184190-24-000123",
      "4/A",
      "Member of 10% owner group",
      "Other (see filing)",
      "[removed from this fixture: a director]",
      "lib/companies/data/raw/company_tickers_exchange.json",
      "owner addresses, signatures, footnotes, remarks, FILE_NUMBER, AFF10B5ONE, transactions and holdings",
    ]) {
      expect(shapeOf(v), v).toBeNull();
    }
    expect(leaks({ businesses: 1, stateFips: "06", zips: [], counts: { cities: 2 } })).toEqual([]);
  });

  const files = [...jsonFiles(path.join(__dirname, "data")), ...jsonFiles(path.join(__dirname, "fixtures"))];

  it("walks the committed bundle and every fixture", () => {
    const names = files.map(rel);
    expect(names).toContain("lib/people/data/insiders.json");
    expect(names).toContain("lib/people/fixtures/insiders.fixture.json");
  });

  it.each(files.map((f) => [rel(f), f]))("%s holds none", (_name, file) => {
    expect(leaks(JSON.parse(readFileSync(file, "utf8")))).toEqual([]);
  });

  it("catches each disambiguator on an individual's name, and only an individual's", () => {
    for (const v of [
      "PLACEHOLDER JANE 12345",
      "PLACEHOLDER JANE (12345-1234)",
      "PLACEHOLDER JANE 123451234",
      "Placeholder Jane 1962",
      "Placeholder Jane (2001)",
      "PLACEHOLDER JOHN A /WI",
      "PLACEHOLDER JOHN J/NY",
      "PLACEHOLDER JOHN /DE/",
      "PLACEHOLDER JOHN J /ADV",
      "PLACEHOLDER JOHN/ FA",
      "PLACEHOLDER JOHN G/",
      "Placeholder Jane (Michigan)",
      "Placeholder Jane (new  york)",
    ]) {
      expect(nameTokenOf(v), v).not.toBeNull();
    }
    for (const v of [
      "Placeholder Jane N/A",
      "Placeholder Workers/ABCD",
      "Placeholder Jane (NMN)",
      "Placeholder Jane (CA)",
      "Placeholder 19 Jane",
      "Placeholder 1850 Jane",
      "Placeholder Jane 1234",
      "PLACEHOLDER JANE1962",
      "Placeholder Jane III",
      "PLACEHOLDER JANE A.",
      "[removed from this fixture: an officer and director]",
    ]) {
      expect(nameTokenOf(v), v).toBeNull();
    }
    const bundle = {
      issuers: {
        "0009100001": [
          [9000001, "PLACEHOLDER JOHN /NY", "i", 1],
          [9000002, "EXAMPLE CORP /DE/", "e", 4],
          [9000003, "EXAMPLE 2020 HOLDINGS CORP /DE/", "b", 4],
          [9000004, null, "v", 4],
          [9000005, "Placeholder Jane 1962", "i", 2],
        ],
      },
    };
    expect(individualNameLeaks(bundle)).toEqual([
      "0009100001[0] owner 9000001: a /XX suffix",
      "0009100001[4] owner 9000005: a 19xx or 20xx year",
    ]);
  });

  const bundles = files.filter((f) => /insiders(?:\.fixture)?\.json$/.test(f));

  it("checks the names in the committed bundle and the fixture", () => {
    expect(bundles.map(rel).sort()).toEqual(["lib/people/data/insiders.json", "lib/people/fixtures/insiders.fixture.json"]);
  });

  it.each(bundles.map((f) => [rel(f), f]))("%s: no individual's name carries a disambiguator", (_name, file) => {
    const bundle = JSON.parse(readFileSync(file, "utf8")) as { issuers: Record<string, unknown[][]> };
    expect(Object.values(bundle.issuers).some((rows) => rows.some((r) => r[2] === "i"))).toBe(true);
    expect(individualNameLeaks(bundle)).toEqual([]);
  });

  it("the fixture names nobody: every name is a removal marker", () => {
    const fx = JSON.parse(readFileSync(path.join(__dirname, "fixtures", "insiders.fixture.json"), "utf8")) as {
      issuers: Record<string, Array<[number, string | null, string]>>;
    };
    const names = Object.values(fx.issuers).flatMap((rows) => rows.map((r) => r[1]));
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) expect(n === null || /^\[removed from this fixture: [^\]]+\]$/.test(n), String(n)).toBe(true);
    // Placeholder CIKs sit above EDGAR's assigned range, so none resolves to a real filer.
    for (const [issuer, rows] of Object.entries(fx.issuers)) {
      expect(Number(issuer)).toBeGreaterThanOrEqual(9_000_000);
      for (const r of rows) expect(r[0]).toBeGreaterThanOrEqual(9_000_000);
    }
  });
});

// ---------------------------------------------------------------- T9

const SCAN_DIRS = ["app", "components", "lib", "scripts"];
const SOURCE_EXT = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;

function sourceFiles(dir: string, out: string[] = []): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (SOURCE_EXT.test(name)) out.push(full);
  }
  return out;
}

const SPECIFIER_RES = [
  /\b(?:import|export)\s+(?:type\s+)?[^'"`;]*?\bfrom\s*["']([^"']+)["']/g,
  /\bimport\s*["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
];

/** Import specifiers in a module's source. */
function specifiers(src: string): string[] {
  const out = new Set<string>();
  for (const re of SPECIFIER_RES) for (const m of src.matchAll(re)) out.add(m[1]);
  return [...out];
}

/** A specifier as a repo-relative path without extension, or null for a package. */
function resolveSpecifier(fromFile: string, spec: string): string | null {
  let abs: string;
  if (spec.startsWith("@/")) abs = path.join(root, spec.slice(2));
  else if (spec.startsWith("./") || spec.startsWith("../")) abs = path.resolve(path.dirname(fromFile), spec);
  else return null;
  return rel(abs).replace(/\.(?:ts|tsx|js|jsx|mjs|cjs)$/, "").replace(/\/index$/, "");
}

const inPeople = (t: string) => t === "lib/people" || t.startsWith("lib/people/");
const isTest = (f: string) => /\.test\.(?:ts|tsx)$/.test(f);
const isClient = (src: string) => /^\s*["']use client["'];?\s*$/m.test(src);

/** The only lib/people module a client module may import: the fetcher for /api/fabric?op=party (M6a). */
const PEOPLE_CLIENT = "lib/people/client";

const NO_PEOPLE_DIRS = ["lib/layers", "lib/globe", "lib/places", "lib/parcels", "lib/permits", "lib/zoning", "lib/land", "lib/brief"];
const NO_PEOPLE_FABRIC = ["graph", "join", "emergence", "strata", "compare", "catalog"].map((m) => `lib/fabric/${m}`);

interface Module {
  file: string;
  src: string;
  targets: string[];
}

// This file is left out: its parser cases are written as imports of lib/people.
const modules: Module[] = SCAN_DIRS.flatMap((d) => sourceFiles(path.join(root, d)))
  .filter((abs) => path.resolve(abs) !== path.resolve(__filename))
  .map((abs) => {
    const src = readFileSync(abs, "utf8");
    const targets = specifiers(src)
      .map((s) => resolveSpecifier(abs, s))
      .filter((t): t is string => t != null);
    return { file: rel(abs), src, targets };
  });

describe("T9: the people store stays on the server", () => {
  it("reads import specifiers in every form", () => {
    const src = [
      'import { a } from "@/lib/people/store";',
      "import {\n  b,\n  c,\n} from '../people/store';",
      'import type { D } from "./store";',
      'export { e } from "@/lib/people/api";',
      'import "@/lib/people/side-effect";',
      'const f = await import("@/lib/people/data/insiders.json");',
      'const g = require("../people/data/insiders.json");',
    ].join("\n");
    expect(specifiers(src).sort()).toEqual(
      [
        "@/lib/people/store",
        "../people/store",
        "./store",
        "@/lib/people/api",
        "@/lib/people/side-effect",
        "@/lib/people/data/insiders.json",
        "../people/data/insiders.json",
      ].sort(),
    );
    expect(resolveSpecifier(path.join(root, "lib/brief/x.ts"), "../people/store")).toBe("lib/people/store");
    expect(resolveSpecifier(path.join(root, "lib/brief/x.ts"), "react")).toBeNull();
  });

  it("scans the app", () => {
    expect(modules.length).toBeGreaterThan(300);
    expect(modules.some((m) => m.file === "lib/people/store.ts")).toBe(true);
    expect(modules.filter((m) => isClient(m.src)).length).toBeGreaterThan(20);
  });

  it("nothing imports lib/people/data", () => {
    const bad = modules.flatMap((m) => m.targets.filter((t) => t.startsWith("lib/people/data")).map((t) => `${m.file} -> ${t}`));
    expect(bad).toEqual([]);
  });

  it("only the store names the bundle file, outside tests", () => {
    const bad = modules.filter((m) => !isTest(m.file) && m.file !== "lib/people/store.ts" && /insiders(?:\.fixture)?\.json/.test(m.src)).map((m) => m.file);
    expect(bad).toEqual([]);
  });

  it("no client module and nothing under components/ imports lib/people, but the people client", () => {
    const bad = modules
      .filter((m) => m.file.startsWith("components/") || isClient(m.src))
      .flatMap((m) => m.targets.filter((t) => inPeople(t) && t !== PEOPLE_CLIENT).map((t) => `${m.file} -> ${t}`));
    expect(bad).toEqual([]);
  });

  it("the people client, when it exists, imports neither the store, the hook nor the data", () => {
    const client = modules.find((m) => m.file.replace(/\.tsx?$/, "") === PEOPLE_CLIENT);
    const bad = (client?.targets ?? []).filter((t) => inPeople(t));
    expect(bad).toEqual([]);
  });

  it("the map, place, parcel and place-fabric modules do not import lib/people", () => {
    const fenced = (f: string) => {
      const bare = f.replace(SOURCE_EXT, "");
      return NO_PEOPLE_DIRS.some((d) => f.startsWith(`${d}/`)) || NO_PEOPLE_FABRIC.includes(bare);
    };
    const bad = modules.filter((m) => fenced(m.file)).flatMap((m) => m.targets.filter(inPeople).map((t) => `${m.file} -> ${t}`));
    expect(bad).toEqual([]);
  });

  it("lib/people takes only lib/fabric/parties from the fabric", () => {
    const bad = modules
      .filter((m) => m.file.startsWith("lib/people/"))
      .flatMap((m) => m.targets.filter((t) => t.startsWith("lib/fabric/") && t !== "lib/fabric/parties").map((t) => `${m.file} -> ${t}`));
    expect(bad).toEqual([]);
  });

  it("lib/fabric/parties imports nothing", () => {
    const parties = modules.find((m) => m.file === "lib/fabric/parties.ts")!;
    expect(parties).toBeDefined();
    expect(specifiers(parties.src)).toEqual([]);
  });
});
