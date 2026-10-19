// The policy record for notable people (SEC Form 3/4/5 reporting owners):
// docs/PEOPLE.md quotes Cam's 2026-10-01 decision verbatim and tags every
// guardrail and open decision as their words or a proposed default, every
// [Cam <date>] tag carries a date they decided something on (the C table), and
// the retired institutions-only phrases stay out of the policy docs and UI copy.
// The athlete exception (Cam 2026-10-18, C5) is checked the same way: its quote,
// its status line and the tags on A1-A10 and AD1-AD5, and rule A5a (Cam 2026-10-19, C6): birthplaces
// are joined by ids, never by name. The athlete record's field
// allowlist and never-list are checked by data/athletes/validate.test.mjs.
// RETIRED grows with each change that ships people behaviour.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");

const C1 = "form 4 insiders should be counted as notable people construct associated with the specific business construct, etc.";
const TAG = /\[(?:Cam \d{4}-\d{2}-\d{2}|proposed)\]/g;
const CAM_TAG = /\[Cam (\d{4}-\d{2}-\d{2})\]/g;

// The dates Cam decided something about people or parcels, as recorded in
// the C table. A [Cam <date>] tag anywhere in docs/PEOPLE.md must carry one of
// them; a new decision adds a C row and its date here.
const CAM_DATES = ["2026-09-25", "2026-09-27", "2026-10-01", "2026-10-18", "2026-10-19"];

// Cam's choice on 2026-10-18, word for word.
const C5 = "Map + models, scoped";
// Cam's approval of rule A5a on 2026-10-19, word for word.
const C6 = "go ahead with A5a";

/** The dates of every [Cam <date>] tag in a text. */
function camDates(text: string): string[] {
  return [...text.matchAll(CAM_TAG)].map((m) => m[1]);
}

const RETIRED = ["no insider or officer names"];

const POLICY_FILES = [
  "README.md",
  "CONTRIBUTING.md",
  ...readdirSync(path.join(root, "docs"))
    .filter((f) => f.endsWith(".md"))
    .map((f) => `docs/${f}`),
  "components/hud/AboutDialog.tsx",
];

// Table rows whose first cell is <prefix><n>, keyed by n.
function rows(text: string, prefix: string): Map<number, string[]> {
  const out = new Map<number, string[]>();
  const re = new RegExp(`^\\|\\s*${prefix}(\\d{1,2})\\s*\\|`);
  for (const line of text.split("\n")) {
    const m = line.match(re);
    if (!m) continue;
    const n = Number(m[1]);
    out.set(n, [...(out.get(n) ?? []), line]);
  }
  return out;
}

/** What is wrong with the tags of rows <prefix>1 to <prefix><count>, one message each; empty when nothing is. */
function tagProblems(text: string, prefix: string, count: number, allowed: RegExp): string[] {
  const found = rows(text, prefix);
  const out: string[] = [];
  const have = [...found.keys()].sort((a, b) => a - b).join(",");
  const want = Array.from({ length: count }, (_, i) => i + 1).join(",");
  if (have !== want) out.push(`${prefix} rows are ${have || "none"}, not ${want}`);
  for (const [n, lines] of found) {
    if (lines.length !== 1) {
      out.push(`${prefix}${n} appears in more than one table row`);
      continue;
    }
    const tags = lines[0].match(TAG) ?? [];
    if (tags.length !== 1) {
      out.push(`${prefix}${n} must carry exactly one [Cam YYYY-MM-DD] or [proposed] tag`);
      continue;
    }
    if (!allowed.test(tags[0])) out.push(`${prefix}${n}: ${tags[0]} is not allowed here`);
    for (const d of camDates(tags[0])) {
      if (!CAM_DATES.includes(d)) out.push(`${prefix}${n}: [Cam ${d}] is not a date in the C table`);
    }
  }
  return out;
}

const CAM_OR_PROPOSED = /^\[(?:Cam \d{4}-\d{2}-\d{2}|proposed)\]$/;

describe("docs/PEOPLE.md", () => {
  const people = read("docs/PEOPLE.md");

  it("quotes Cam's 2026-10-01 decision verbatim, tagged as his", () => {
    expect(people).toContain(C1);
    const quote = people.split("\n").find((l) => l.includes(C1) && l.startsWith(">"));
    expect(quote).toBeDefined();
    expect(quote).toContain("[Cam 2026-10-01]");
  });

  it("tags Cam's own words C1-C6 with their name and date", () => {
    expect(tagProblems(people, "C", 6,/^\[Cam \d{4}-\d{2}-\d{2}\]$/)).toEqual([]);
    expect(rows(people, "C").get(1)![0]).toContain(C1);
  });

  it("records exactly Cam's decision dates in the C table", () => {
    const dates = [...rows(people, "C").values()].flatMap((lines) => camDates(lines[0]));
    expect([...new Set(dates)].sort()).toEqual(CAM_DATES);
  });

  it("tags each guardrail G1-G16 as Cam's words or a proposed default", () => {
    expect(tagProblems(people, "G", 16, CAM_OR_PROPOSED)).toEqual([]);
  });

  it("tags each open decision D1-D9 as Cam's words or a proposed default", () => {
    expect(tagProblems(people, "D", 9, CAM_OR_PROPOSED)).toEqual([]);
  });

  it("dates every [Cam <date>] tag in the file with a date from the C table", () => {
    const dates = camDates(people);
    expect(dates.length).toBeGreaterThan(0);
    expect(dates.filter((d) => !CAM_DATES.includes(d))).toEqual([]);
  });

  it("refuses a [Cam <date>] tag on a date Cam decided nothing", () => {
    const table = "| G1 | a rule | [Cam 2026-09-26] | x |\n| G2 | a rule | [proposed] | x |";
    expect(tagProblems(table, "G", 2, CAM_OR_PROPOSED)).toEqual(["G1: [Cam 2026-09-26] is not a date in the C table"]);
    expect(tagProblems(table.replace("2026-09-26", "2026-09-27"), "G", 2, CAM_OR_PROPOSED)).toEqual([]);
    expect(camDates("as decided **[Cam 2026-10-02]**, and [Cam 2026-10-01]")).toEqual(["2026-10-02", "2026-10-01"]);
  });

  it("says nothing returns a reporting owner's name yet", () => {
    expect(people).toMatch(/Status, 2026-10-01: policy only/);
  });
});

describe("docs/PEOPLE.md, Athletes", () => {
  const people = read("docs/PEOPLE.md");
  const athletes = people.split("\n## Athletes\n")[1]?.split("\n## ")[0] ?? "";

  it("has an Athletes section that says nothing carries an athlete yet", () => {
    expect(athletes).not.toBe("");
    expect(athletes).toMatch(/Status, 2026-10-18: policy only/);
  });

  it("quotes Cam's 2026-10-18 choice verbatim, tagged as theirs, in the C table and the section", () => {
    const quote = athletes.split("\n").find((l) => l.startsWith(">") && l.includes(`"${C5}"`));
    expect(quote).toBeDefined();
    expect(quote).toContain("[Cam 2026-10-18]");
    expect(rows(people, "C").get(5)![0]).toContain(`"${C5}"`);
  });

  it("tags each athlete guardrail A1-A10 as Cam's words or a proposed default", () => {
    expect(tagProblems(athletes, "A", 10, CAM_OR_PROPOSED)).toEqual([]);
  });

  it("carries A5a, Cam's 2026-10-19 rule that birthplaces are joined by ids, tagged as theirs", () => {
    const a5a = athletes.split("\n").filter((l) => /^\|\s*A5a\s*\|/.test(l));
    expect(a5a).toHaveLength(1);
    expect(a5a[0].match(TAG)).toEqual(["[Cam 2026-10-19]"]);
    for (const id of ["P19", "P131", "P774", "P590", "P1566", "P569"]) expect(a5a[0]).toContain(id);
    expect(rows(people, "C").get(6)![0]).toContain(`"${C6}"`);
  });

  it("never says a birthplace is joined by name", () => {
    expect(people).not.toMatch(/joined to a city record by name/);
    expect(people).not.toMatch(/by name, then region, then country/);
  });

  it("tags each athlete open decision AD1-AD5 as Cam's words or a proposed default", () => {
    expect(tagProblems(athletes, "AD", 5, CAM_OR_PROPOSED)).toEqual([]);
  });

  it("keeps the never-list in Cam's words and points at the record check", () => {
    for (const never of ["birth date", "age", "address", "family", "contact details"]) expect(athletes).toContain(never);
    expect(athletes).toContain("data/athletes/allowlist.json");
    expect(athletes).toContain("data/athletes/validate.test.mjs");
  });
});

describe("policy docs point at docs/PEOPLE.md", () => {
  it("CONTRIBUTING ground rule 1 and the README's Ethics section link it", () => {
    expect(read("CONTRIBUTING.md")).toContain("[docs/PEOPLE.md](docs/PEOPLE.md)");
    const ethics = read("README.md").split("## Ethics guardrails")[1] ?? "";
    expect(ethics).toContain("[docs/PEOPLE.md](docs/PEOPLE.md)");
  });

  it("docs/COMPANIES.md carries the decision in its own section", () => {
    const companies = read("docs/COMPANIES.md");
    expect(companies).toContain("## People linked to a company (Cam, 2026-10-01)");
    expect(companies).toContain(C1);
    expect(companies).toContain("[docs/PEOPLE.md](PEOPLE.md)");
  });

  it("docs/PLACES.md line 5 keeps insiders off places and sends them to a company's dossier", () => {
    const line5 = read("docs/PLACES.md").split("\n")[4];
    expect(line5).toContain("no insider appears anywhere in this surface");
    expect(line5).toContain("reached from a company's dossier, never from a place");
  });
});

describe("retired policy phrases", () => {
  it.each(POLICY_FILES)("%s carries none", (file) => {
    const text = read(file).toLowerCase();
    for (const phrase of RETIRED) expect(text, `${file} still says "${phrase}"`).not.toContain(phrase);
  });
});
