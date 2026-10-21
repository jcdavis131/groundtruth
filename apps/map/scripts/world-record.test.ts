import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { prov } from "./world-record-trim.mjs";

// scripts/world-record.mjs records a world_context run's route replies into lib/mcp/__fixtures__/world/*.json, each
// trimmed to what lib/mcp/world.ts reads. The recorder fetches, so it is not run here; the step that decides what a
// route's provenance entries keep is world-record-trim.mjs, and this runs it on planted entries. lib/mcp/world.ts reads
// the CMS rating's publishedAt from the entry's period ("dataset modified YYYY-MM-DD"), so a recording that dropped the
// period could never show it.
//
// What this does not show: the twelve fixtures committed under lib/mcp/__fixtures__/world were recorded before the
// recorder kept the period and none of their provenance entries has one; they carry it only after the next recording
// (a recording asks the live site, so none is made here).

/** A provenance entry as /api/infra?op=hospitals sends the CMS one: every field, so the planted entry shows what is kept and what is not. */
const PLANTED = {
  source: { id: "cms-provider-data", publisher: "Centers for Medicare & Medicaid Services", url: "https://data.cms.gov/provider-data/dataset/xubh-q36u", licenseId: "planted-field-the-recorder-drops" },
  kind: "published",
  seriesId: "planted series",
  upstreamUrl: "https://data.cms.gov/provider-data/api/1/datastore/query/xubh-q36u/0",
  period: "dataset modified 2026-07-22",
  retrievedAt: "2026-10-17T00:00:00.000Z",
  method: "planted method",
  notes: ["planted note"],
};

describe("scripts/world-record-trim.mjs: what the recorder keeps of a route's provenance", () => {
  it("keeps the entry's period beside its source (id, publisher, url), upstream url and retrieval time, and drops the rest", () => {
    expect(prov([PLANTED])).toEqual([
      {
        source: { id: PLANTED.source.id, publisher: PLANTED.source.publisher, url: PLANTED.source.url },
        upstreamUrl: PLANTED.upstreamUrl,
        period: PLANTED.period,
        retrievedAt: PLANTED.retrievedAt,
      },
    ]);
  });

  it("an entry that states no period is recorded without a period key: absent, never null or an empty string", () => {
    const [kept] = prov([{ ...PLANTED, period: undefined }]);
    expect(Object.keys(kept)).not.toContain("period");
    expect(Object.keys(kept).sort()).toEqual(["retrievedAt", "source", "upstreamUrl"]);
  });

  it("a body whose provenance is not a list is passed through as it came", () => {
    expect(prov(undefined)).toBeUndefined();
    expect(prov("not a list")).toBe("not a list");
  });

  it("the recorder reduces provenance through this module and defines no reducer of its own", () => {
    const recorder = readFileSync(path.resolve(__dirname, "world-record.mjs"), "utf8");
    expect(recorder).toContain('from "./world-record-trim.mjs"');
    expect(recorder).toMatch(/prov\(body\.provenance\)/);
    expect(recorder, "a private copy of the reducer would leave this test judging a function the recorder does not use").not.toMatch(/^const prov\b/m);
  });
});
