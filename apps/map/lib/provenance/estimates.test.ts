import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/catalog/route";
import { PLACE_EXPORTS } from "@/lib/catalog/placeExport";
import { WORLD_FIXTURES } from "../cite/worldItems";
import { COMPUTED_METHOD, computedAsPublished, estimatesWithoutInputs, scanProvenance } from "./estimates";
import type { Provenance, ProvenanceInput } from "./types";

// "published = relayed as-is; estimate = computed here" (types.ts) as a rule a test can fail: an entry labelled
// published must not say it was computed here, and an estimate names the inputs it was computed from. The cases
// below plant a violation and show it is found. Two walks then use the rule, and they are not equal evidence: the
// place-export walk is live (each of the four replies has one labelled aggregate, judged through the real route);
// the world_context fixture walk is a forward guard, because the recorded routes' provenance entries are trimmed to
// {source, upstreamUrl?, retrievedAt} and none carries a kind, so it judges 0 labelled entries today (the test pins that).

const entry = (over: Partial<Provenance>): Provenance => ({
  source: { id: "epa-npl-status", name: "NPL", publisher: "U.S. EPA", url: "https://www.epa.gov/superfund", license: "public domain" },
  retrievedAt: "2026-10-16T10:02:13.295Z",
  kind: "published",
  ...over,
});

const input: ProvenanceInput = { sourceId: "epa-npl-status", upstreamRecordUrl: "https://services.arcgis.com/x/FeatureServer/0", retrievedAt: "2026-10-16T10:02:13.295Z" };

describe("the rule, on planted entries", () => {
  it("finds a published entry whose method says it was computed here, at its path in the reply", () => {
    const reply = { data: {}, provenance: [entry({ kind: "estimate", method: "county aggregate computed by the export script", inputs: [input] }), entry({ method: "county aggregate computed by the export script from the NPL" })] };
    const found = computedAsPublished(reply);
    expect(found).toHaveLength(1);
    expect(found[0].path).toBe("provenance[1]");
    expect(found[0].sourceId).toBe("epa-npl-status");
    expect(found[0].why).toMatch(/published, but its method says it was computed/);
  });

  it("catches each word the rule names, whole words only", () => {
    for (const w of ["computed", "aggregate", "sum", "count", "derived", "sums", "counts", "aggregated"]) {
      expect(computedAsPublished([entry({ method: `the ${w} of the rows` })]), w).toHaveLength(1);
    }
    // the TIGERweb entry placeExport serves is published and its method says "county" and "counties.json": neither is "count"
    for (const m of ["county names and FIPS the export joins to (lib/places/data/counties.json, TIGERweb ACS2023)", "a summary table", "the country file", "discount rate as published", "accountable"]) {
      expect(COMPUTED_METHOD.test(m), m).toBe(false);
      expect(computedAsPublished([entry({ method: m })]), m).toEqual([]);
    }
  });

  it("reads a per-period figure and a change as computed, in words or as a mover row names them; exchange and unchanged are not change", () => {
    for (const m of ["per year: distinct disasterNumber by the year of declarationDate", "reports per year where CZ_TYPE = C", "counted per month", "per calendar quarter", "changeAbs = after - before", "changePct = (after - before) / before * 100", "percent change over the year", "the change from last month"]) {
      expect(COMPUTED_METHOD.test(m), m).toBe(true);
      expect(computedAsPublished([entry({ method: m })]), m).toHaveLength(1);
    }
    for (const m of ["exchange rate as published", "unchanged since the last release", "a perfect year", "per se", "interchange file"]) {
      expect(COMPUTED_METHOD.test(m), m).toBe(false);
      expect(computedAsPublished([entry({ method: m })]), m).toEqual([]);
    }
  });

  it("finds a published entry that names inputs, and lets an estimate name them", () => {
    expect(computedAsPublished([entry({ inputs: [input] })])).toHaveLength(1);
    expect(computedAsPublished([entry({ kind: "estimate", method: "sum of rows", inputs: [input] })])).toEqual([]);
    expect(computedAsPublished([entry({ kind: "snapshot", method: "distinct hex codes in one query" })])).toEqual([]);
  });

  it("finds an estimate with no inputs, and not one that names them", () => {
    const found = estimatesWithoutInputs([entry({ kind: "estimate", method: "x / y" }), entry({ kind: "estimate", method: "x / y", inputs: [] }), entry({ kind: "estimate", method: "x / y", inputs: [input] }), entry({})]);
    expect(found.map((f) => f.path)).toEqual(["provenance[0]", "provenance[1]"]);
  });

  it("counts the entries it judged, so a clean walk can be told from a walk that found nothing", () => {
    const scan = scanProvenance({ a: [{ source: { id: "x" }, retrievedAt: "t" }, { source: { id: "y" }, retrievedAt: "t", kind: "estimate" }], b: { source: { id: "z" } }, c: "text", d: null });
    expect(scan).toEqual({ entries: 2, labelled: 1, findings: [] });
  });
});

describe("the recorded world_context fixtures", () => {
  const files = readdirSync(WORLD_FIXTURES).filter((f) => f.endsWith(".json")).sort();

  it("covers all twelve", () => {
    expect(files).toHaveLength(12);
  });

  for (const f of files) {
    it(`${f}: forward guard, no entry in its recorded routes is labelled published and computed`, () => {
      const fx: unknown = JSON.parse(readFileSync(path.join(WORLD_FIXTURES, f), "utf8"));
      const scan = scanProvenance(fx);
      expect(scan.findings).toEqual([]);
      expect(scan.entries, "the walk saw provenance-shaped entries").toBeGreaterThan(0);
      // Pinned to 0 on purpose: the recorded fixtures carry no `kind` today, so this walk judges nothing and cannot fail.
      // A fixture re-recorded with labelled entries fails this line, which is the prompt to look at what it now labels.
      expect(scan.labelled, `${f} now has labelled entries (of ${scan.entries}): the walk judges them, so look at them and update this pin`).toBe(0);
    });
  }

  it("a computed entry planted in a fixture's recorded route is found, deep in the file", () => {
    const fx = JSON.parse(readFileSync(path.join(WORLD_FIXTURES, "mobile_01097.json"), "utf8")) as { routes: Record<string, { body: { provenance?: Array<Record<string, unknown>> } }> };
    const route = Object.values(fx.routes).find((r) => (r.body.provenance?.length ?? 0) > 0);
    expect(route).toBeTruthy();
    const first = route!.body.provenance![0];
    first.kind = "published";
    first.method = "sum of the rows in the box";
    const found = computedAsPublished(fx);
    expect(found).toHaveLength(1);
    expect(found[0].path).toMatch(/\.body\.provenance\[0\]$/);
  });
});

describe("the place-export replies", () => {
  for (const id of PLACE_EXPORTS) {
    it(`${id}: the county aggregate is an estimate that names its inputs, and nothing in the reply is published and computed`, async () => {
      const res = await GET(new NextRequest(`http://localhost/api/catalog?op=place-export&collection=${id}`));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { provenance: Provenance[] };
      const scan = scanProvenance(body);
      expect(scan.entries).toBe(2);
      expect(scan.findings).toEqual([]);
      expect(estimatesWithoutInputs(body.provenance)).toEqual([]);
      const est = body.provenance.filter((p) => p.kind === "estimate");
      expect(est).toHaveLength(1);
      expect(est[0].inputs?.length).toBe(2);

      // The reviewer's mutation: label the aggregate published and the rule fails the reply; drop its inputs and the other half does.
      const relabelled = structuredClone(body);
      relabelled.provenance.find((p) => p.kind === "estimate")!.kind = "published";
      expect(computedAsPublished(relabelled)).toHaveLength(1);
      const stripped = structuredClone(body);
      delete stripped.provenance.find((p) => p.kind === "estimate")!.inputs;
      expect(estimatesWithoutInputs(stripped.provenance)).toHaveLength(1);
    });
  }
});

describe("docs/MCP.md says what the fixture walk judges", () => {
  const md = readFileSync(fileURLToPath(new URL("../../docs/MCP.md", import.meta.url)), "utf8");
  const enforced = md.split(/^## /m).find((x) => x.startsWith("Estimates and their inputs"))?.split("\n\n").find((p) => p.startsWith("Enforced by"));

  it("the 'Enforced by' paragraph gives the fixtures' own counts and calls the fixture half a forward guard, not a finding of none", () => {
    expect(enforced, "docs/MCP.md has an 'Enforced by' paragraph under 'Estimates and their inputs'").toBeTruthy();
    let entries = 0;
    let labelled = 0;
    for (const f of readdirSync(WORLD_FIXTURES).filter((x) => x.endsWith(".json"))) {
      const scan = scanProvenance(JSON.parse(readFileSync(path.join(WORLD_FIXTURES, f), "utf8")));
      entries += scan.entries;
      labelled += scan.labelled;
    }
    expect(enforced).toContain(`hold ${entries} provenance-shaped entries and ${labelled} of them carry a \`kind\``);
    expect(enforced).toContain(`judges ${labelled} labelled entries today`);
    expect(enforced).toContain("forward guard");
    // the old wording read as a measurement: "walks every provenance entry in the twelve recorded fixtures ... finds none"
    expect(enforced).not.toMatch(/walks every provenance entry in the twelve/);
  });
});
