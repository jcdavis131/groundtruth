// The chart spec's contract: invariants that fail at validation, the four
// pinned formats, and a published JSON Schema that cannot drift from zod.
//
// After an intentional schema change, regenerate the published copy with:
//   UPDATE_INSIGHTS_SCHEMA=1 npx vitest run lib/insights/render/spec.test.ts
// mirroring UPDATE_BRIEF_GOLDEN=1. The diff on
// public/insights-chart.schema.json is then the review of the contract.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { signedPct } from "@/lib/brief/format";
import { SOURCES } from "@/lib/provenance/sources";
import FIXTURE from "./fixtures/qcew-metro-job-growth-2019-2023.json";
import { ChartSpec, FORMATS, canonicalJson, canonicalSpec, parseChartSpec, type BubbleSpec } from "./spec";

const SCHEMA = path.resolve(__dirname, "../../../public/insights-chart.schema.json");

/** A deep copy of the fixture to break one rule on. */
function fixture(): BubbleSpec {
  return JSON.parse(JSON.stringify(FIXTURE)) as BubbleSpec;
}

function issues(input: unknown): string[] {
  const r = ChartSpec.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => i.message);
}

describe("ChartSpec", () => {
  it("accepts the committed QCEW fixture", () => {
    expect(issues(FIXTURE)).toEqual([]);
  });

  it("rejects a subject that is not a datum id", () => {
    const s = fixture();
    s.subject = "C9999";
    expect(issues(s)).toContain('subject "C9999" is not a datum id');
  });

  it("rejects an estimate without a method, missing or blank", () => {
    const missing = fixture();
    delete missing.provenance["change-total-covered"].method;
    expect(issues(missing)).toContain('estimate "change-total-covered" has no method');
    const blank = fixture();
    blank.provenance["growth"].method = "   ";
    expect(issues(blank)).toContain('estimate "growth" has no method');
  });

  it("rejects a headline the tightest canvas cannot set, at validation and naming the canvas", () => {
    const s = fixture();
    // 120 characters: inside the schema's coarse cap, over the measured capacity.
    s.headline = "White-Collar and Blue-Collar Industry Job Growth in the 150 Largest US Metro Areas, 2019 to 2023, Ranked by Covered Jobs";
    expect(s.headline.length).toBe(120);
    const found = issues(s);
    expect(found).toContain("headline does not fit the og canvas: even at 34 px, the smallest size on its 46/40/34 px ladder, it needs more than 5 lines of 470 px or has a word wider than 470 px; shorten it");
    expect(found).toContain("headline does not fit the social canvas: even at 46 px, the smallest size on its 60/52/46 px ladder, it needs more than 3 lines of 952 px or has a word wider than 952 px; shorten it");
    expect(() => parseChartSpec(s)).toThrow(/headline does not fit the og canvas/);
  });

  it("rejects duplicate datum ids", () => {
    const s = fixture();
    s.data[1] = { ...s.data[1], id: s.data[0].id };
    expect(issues(s)).toContain(`duplicate datum id "${s.data[0].id}"`);
  });

  it("rejects any format outside pct, signedPct, num and usd, on every axis and on size", () => {
    expect([...FORMATS]).toEqual(["pct", "signedPct", "num", "usd"]);
    for (const bad of ["ratio", "index", "percent", "usd0", ""]) {
      for (const where of ["x", "y", "size"] as const) {
        const s = fixture() as unknown as Record<string, Record<string, unknown>>;
        s[where].format = bad;
        const r = ChartSpec.safeParse(s);
        expect(r.success, `${where}.format = "${bad}"`).toBe(false);
        expect(r.error?.issues.some((i) => i.path.join(".") === `${where}.format`)).toBe(true);
      }
    }
    for (const ok of FORMATS) {
      const s = fixture();
      s.size.format = ok;
      expect(issues(s)).toEqual([]);
    }
  });

  it("rejects a cited provenance key that does not exist, and a record nothing cites", () => {
    const s = fixture();
    s.data[0].provenance = [...s.data[0].provenance, "qcew-2024-10"];
    expect(issues(s)).toContain(`datum "${s.data[0].id}" cites unknown provenance "qcew-2024-10"`);
    const orphan = fixture();
    for (const d of orphan.data) d.provenance = d.provenance.filter((k) => k !== "qcew-2019-1011");
    expect(issues(orphan)).toContain('provenance "qcew-2019-1011" is not cited by any datum');
  });

  it("rejects label ids that are not data, subject notes without a subject, a reversed domain and unknown keys", () => {
    const labels = fixture();
    labels.labels = { ids: ["C1242", "C0000"] };
    expect(issues(labels)).toContain('label id "C0000" is not a datum id');
    const notes = fixture();
    delete notes.subject;
    expect(issues(notes)).toContain("subjectNotes without a subject");
    const domain = fixture();
    domain.x.domain = [40, -20];
    expect(issues(domain)).toContain("axis domain must run low to high");
    const extra = { ...fixture(), theme: "dark" };
    expect(ChartSpec.safeParse(extra).success).toBe(false);
  });

  it("keeps a published zero distinct from a null", () => {
    const s = parseChartSpec(FIXTURE) as BubbleSpec;
    expect(s.data.filter((d) => d.x === null || d.y === null).length).toBe(36);
    // Ann Arbor's finance and professional services jobs were 6,206 + 28,243 in 2019 and
    // 6,132 + 28,317 in 2023: the same 34,449, a real 0.0% that must plot, not vanish.
    const annArbor = s.data.find((d) => d.id === "C1146");
    expect(annArbor?.x).toBe(0);
    expect(annArbor?.y).not.toBeNull();
  });
});

describe("the QCEW fixture", () => {
  const s = parseChartSpec(FIXTURE) as BubbleSpec;

  it("is the 150-metro universe with 114 plotted rows and real BLS sources", () => {
    expect(s.data.length).toBe(150);
    expect(s.data.filter((d) => d.x !== null && d.y !== null).length).toBe(114);
    expect(s.data.every((d) => d.size !== null && Number.isInteger(d.size))).toBe(true);
    for (const p of Object.values(s.provenance)) {
      expect(p.source).toEqual(SOURCES["bls-qcew"]);
      if (p.kind === "published") expect(p.upstreamUrl).toMatch(/^https:\/\/data\.bls\.gov\/cew\/data\/api\/(2019|2023)\/a\/industry\/(10|1011|1012|1013|1023|1024)\.csv$/);
    }
    expect(Object.keys(s.provenance).filter((k) => s.provenance[k].kind === "published").length).toBe(12);
  });

  it("prints the subject's values exactly as lib/brief/format.ts would", () => {
    const austin = s.data.find((d) => d.id === s.subject);
    expect(austin?.fullLabel).toBe("Austin-Round Rock-San Marcos, TX");
    expect(s.subjectNotes).toEqual([`${signedPct(austin?.x)} / ${signedPct(austin?.y)}`]);
  });
});

describe("canonicalJson", () => {
  it("sorts keys at every depth and drops undefined", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: undefined } })).toBe('{"a":{"d":[3,{"y":2,"z":1}]},"b":1}');
  });
});

describe("canonicalSpec", () => {
  it("makes input order irrelevant", () => {
    const s = parseChartSpec(FIXTURE) as BubbleSpec;
    const shuffled: BubbleSpec = {
      ...s,
      data: [...s.data].reverse().map((d) => ({ ...d, provenance: [...d.provenance].reverse() })),
      provenance: Object.fromEntries(Object.entries(s.provenance).reverse()),
    };
    expect(canonicalJson(canonicalSpec(shuffled))).toBe(canonicalJson(canonicalSpec(s)));
    expect(JSON.stringify(canonicalSpec(shuffled))).toBe(JSON.stringify(canonicalSpec(s)));
  });
});

describe("public/insights-chart.schema.json", () => {
  it("equals z.toJSONSchema(ChartSpec)", () => {
    const schema = z.toJSONSchema(ChartSpec);
    const text = JSON.stringify(schema, null, 2) + "\n";
    if (process.env.UPDATE_INSIGHTS_SCHEMA === "1") {
      fs.writeFileSync(SCHEMA, text);
      return;
    }
    expect(fs.existsSync(SCHEMA), "run UPDATE_INSIGHTS_SCHEMA=1 npx vitest run lib/insights/render/spec.test.ts").toBe(true);
    const published = fs.readFileSync(SCHEMA, "utf8");
    expect(JSON.parse(published)).toEqual(schema);
    expect(published, "the chart spec schema changed; run UPDATE_INSIGHTS_SCHEMA=1 npx vitest run lib/insights/render/spec.test.ts").toBe(text);
  });

  it("publishes exactly the four formats", () => {
    const text = JSON.stringify(z.toJSONSchema(ChartSpec));
    expect(text).toContain('"enum":["pct","signedPct","num","usd"]');
    expect(text).not.toContain("ratio");
  });
});
