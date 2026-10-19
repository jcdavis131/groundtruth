// The policy record for notable people (SEC Form 3/4/5 reporting owners):
// docs/PEOPLE.md quotes Cam's 2026-10-01 decision verbatim and tags every
// guardrail and open decision as his words or a proposed default, every
// [Cam <date>] tag carries a date he decided something on (the C table), and
// the retired institutions-only phrases stay out of the policy docs and UI copy.
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
const CAM_DATES = ["2026-09-25", "2026-09-27", "2026-10-01"];

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

  it("tags Cam's own words C1-C4 with his name and date", () => {
    expect(tagProblems(people, "C", 4, /^\[Cam \d{4}-\d{2}-\d{2}\]$/)).toEqual([]);
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
