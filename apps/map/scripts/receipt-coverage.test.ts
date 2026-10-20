import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { WORLD_FIXTURES } from "../lib/cite/worldItems";
import { RECEIPT_BAR, coverageOf, runReceiptCoverage, share, totalOf, type CoverageItem } from "../lib/provenance/receiptCoverage";

// scripts/receipt-coverage.mjs is a thin wrapper over runReceiptCoverage; these drive it the way the script does,
// on planted facts files (written to a temp dir, never into lib/mcp/__fixtures__) and on the twelve recorded fixtures.

const APP = fileURLToPath(new URL("..", import.meta.url));
const SCRIPT = path.join(APP, "scripts", "receipt-coverage.mjs");

const item = (n: number, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  fact: `fact ${n}`,
  value: n,
  sourceId: "epa-npl-status",
  publisher: "U.S. EPA",
  upstreamUrl: "https://www.epa.gov/superfund",
  upstreamRecordUrl: `https://services.arcgis.com/x/FeatureServer/0/query?where=ID%3D${n}`,
  retrievedAt: "2026-10-16T10:02:13.295Z",
  link: "https://example.test/api",
  ...over,
});

/** Three valued lines, the third without upstreamRecordUrl; one null line with its note; one about-eye line. */
const PLANTED_A = [
  item(1),
  item(2),
  item(3, { upstreamRecordUrl: undefined, note: "no record-level URL: the publisher has none" }),
  item(4, { value: null, note: "withheld by the publisher", upstreamRecordUrl: undefined }),
  item(5, { kind: "about-eye", sourceId: "eye-catalog", upstreamRecordUrl: undefined }),
];
const PLANTED_B = [item(6), item(7)];

const dir = mkdtempSync(path.join(tmpdir(), "receipt-coverage-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const write = (name: string, facts: unknown[]): string => {
  const p = path.join(dir, name);
  writeFileSync(p, JSON.stringify({ facts }));
  return p;
};
const A = write("a.json", PLANTED_A);
const B = write("b.json", PLANTED_B);

describe("what counts as covered", () => {
  it("a valued line with no upstreamRecordUrl is uncovered, and null and about-eye lines are listed apart", () => {
    const c = coverageOf("a.json", PLANTED_A as unknown as CoverageItem[]);
    expect(c).toMatchObject({ valued: 3, covered: 2, aboutEye: 1, nulls: 1 });
    expect(c.uncovered).toEqual([{ sourceId: "epa-npl-status", fact: "fact 3" }]);
  });

  it("each of the three fields is needed, and the record URL must be https", () => {
    for (const over of [{ publisher: undefined }, { publisher: "  " }, { upstreamRecordUrl: "" }, { upstreamRecordUrl: "http://services.arcgis.com/x" }, { retrievedAt: undefined }, { retrievedAt: "" }]) {
      const c = coverageOf("x", [item(1, over)] as unknown as CoverageItem[]);
      expect(c, JSON.stringify(over)).toMatchObject({ valued: 1, covered: 0 });
    }
    expect(coverageOf("x", [item(1)] as unknown as CoverageItem[])).toMatchObject({ valued: 1, covered: 1 });
  });

  it("the total is the sum of the rows, and a share is n over N to one decimal", () => {
    const rows = [coverageOf("a", PLANTED_A as unknown as CoverageItem[]), coverageOf("b", PLANTED_B as unknown as CoverageItem[])];
    const t = totalOf(rows);
    expect(t).toMatchObject({ file: "total", valued: 5, covered: 4, aboutEye: 1, nulls: 1 });
    expect(t.uncovered).toHaveLength(1);
    expect(share(t)).toBe("80.0%");
    expect(share({ covered: 0, valued: 0 })).toBe("n/a");
  });
});

describe("runReceiptCoverage", () => {
  it("prints n/N per file and a total that is their sum", async () => {
    const r = await runReceiptCoverage([A, B]);
    expect(r.code).toBe(0);
    expect(r.rows.map((x) => `${x.file} ${x.covered}/${x.valued}`)).toEqual(["a.json 2/3", "b.json 2/2"]);
    expect(r.total).toMatchObject({ covered: 4, valued: 5 });
    expect(r.text).toMatch(/a\.json\s+2\/3\s+66\.7%/);
    expect(r.text).toMatch(/b\.json\s+2\/2\s+100\.0%/);
    expect(r.text).toMatch(/total\s+4\/5\s+80\.0%/);
    expect(r.text).toContain("epa-npl-status");
    expect(r.text).not.toContain("fact 3 ");
    expect((await runReceiptCoverage(["--list", A])).text).toContain("a.json | epa-npl-status | fact 3");
  });

  it("reports and exits 0 whatever the number is, until --min is given", async () => {
    const r = await runReceiptCoverage([A]);
    expect(r.code).toBe(0);
    expect(r.text).toContain(`bar ${RECEIPT_BAR}%`);
    expect(r.text).toMatch(/66\.7% is below it; reporting only/);
  });

  it("--min exits 1 when the total share is below it, and 0 when it is not", async () => {
    expect((await runReceiptCoverage(["--min", "100", A])).code).toBe(1);
    expect((await runReceiptCoverage(["--min=70", A])).code).toBe(1);
    expect((await runReceiptCoverage(["--min", "66", A])).code).toBe(0);
    expect((await runReceiptCoverage(["--min", "100", B])).code).toBe(0);
    expect((await runReceiptCoverage(["--min", "100", A])).text).toMatch(/gate: total 66\.7% is below --min 100: exit 1/);
  });

  it("a bad flag, a missing --min value or a file that cannot be read is exit 2", async () => {
    expect((await runReceiptCoverage(["--nope"])).code).toBe(2);
    expect((await runReceiptCoverage(["--min"])).code).toBe(2);
    expect((await runReceiptCoverage(["--min", "abc", A])).code).toBe(2);
    expect((await runReceiptCoverage(["--min", "101", A])).code).toBe(2);
    expect((await runReceiptCoverage([path.join(dir, "missing.json")])).code).toBe(2);
  });

  it("reads all twelve recorded fixtures by default, with the same loader cite-check uses", async () => {
    const files = readdirSync(WORLD_FIXTURES).filter((f) => f.endsWith(".json")).sort();
    expect(files).toHaveLength(12);
    const r = await runReceiptCoverage([]);
    expect(r.code).toBe(0);
    expect(r.rows.map((x) => x.file)).toEqual(files);
    expect(r.total.covered).toBe(r.rows.reduce((n, x) => n + x.covered, 0));
    expect(r.total.valued).toBe(r.rows.reduce((n, x) => n + x.valued, 0));
    expect(r.total.valued).toBeGreaterThan(200);
    for (const x of r.rows) expect(r.text).toContain(`${x.file}`);
    expect(r.total.uncovered).toHaveLength(r.total.valued - r.total.covered);
  });
});

describe("the script", () => {
  const run = (...args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: APP, encoding: "utf8", timeout: 100_000 });

  it("prints the table and exits 0 on a fixture below any bar, exits 1 with --min 100, and exits 2 on a bad flag", () => {
    const plain = run(A);
    expect(plain.status).toBe(0);
    expect(plain.stdout).toMatch(/a\.json\s+2\/3\s+66\.7%/);
    const gated = run("--min", "100", A);
    expect(gated.status).toBe(1);
    expect(gated.stdout).toMatch(/gate: total 66\.7% is below --min 100: exit 1/);
    expect(run("--min", "60", A).status).toBe(0);
    expect(run("--nope").status).toBe(2);
  }, 120_000);

  it("prints the same total as the library on the twelve fixtures", async () => {
    const r = await runReceiptCoverage([]);
    const out = run();
    expect(out.status).toBe(0);
    expect(out.stdout).toMatch(new RegExp(`total\\s+${r.total.covered}/${r.total.valued}\\s+${share(r.total).replace(".", "\\.")}`));
  }, 120_000);
});

describe("the number in docs/MCP.md", () => {
  it("is the newest dated heading under Receipt coverage and equals what the script prints", async () => {
    const md = readFileSync(path.join(APP, "docs", "MCP.md"), "utf8");
    const section = md.split(/^## /m).find((s) => s.startsWith("Receipt coverage"));
    expect(section, "docs/MCP.md has a 'Receipt coverage' section").toBeTruthy();
    const m = section!.match(/^### (\d{4}-\d{2}-\d{2}): (\d+) of (\d+) valued lines \((\d+\.\d)%\)/m);
    expect(m, "a dated heading '### YYYY-MM-DD: n of N valued lines (xx.x%)'").toBeTruthy();
    const r = await runReceiptCoverage([]);
    expect([Number(m![2]), Number(m![3]), `${m![4]}%`]).toEqual([r.total.covered, r.total.valued, share(r.total)]);
    expect(section).toMatch(/reporting only/);
  });
});
