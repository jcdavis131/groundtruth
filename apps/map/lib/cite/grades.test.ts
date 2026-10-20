import { describe, expect, it } from "vitest";
import { byUrl, compare, inTableFacts, recordReturned } from "./grades";
import type { PublisherReply } from "./types";

// A reconciled-plan file (writeups/jev-2026-10-18/eval-v3/regrade/grades.json) is {result: [{id, g1: {facts: [...]}}]}.
// inTableFacts keeps the upstream_publisher facts whose link is on a host in lib/cite/hosts.ts; nothing else is measured.
const OPENFEMA = "https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries?$filter=disasterNumber eq 4332";
const NID = "https://geospatial.sec.usace.army.mil/dls/rest/services/NID/National_Inventory_of_Dams_Public_Service/FeatureServer/0/query?where=NIDID%3D'TX01087'&f=json";
const grades = {
  result: [
    {
      id: "P01",
      g1: {
        facts: [
          { fact: "a", link: OPENFEMA, citeType: "upstream_publisher", upstreamConfirmed: true, wrong: false },
          { fact: "b", link: OPENFEMA, citeType: "upstream_publisher", upstreamConfirmed: false, wrong: true },
          { fact: "c", link: "https://en.wikipedia.org/wiki/Dam", citeType: "upstream_publisher", upstreamConfirmed: true, wrong: false },
          { fact: "d", link: NID, citeType: "none", upstreamConfirmed: false, wrong: false },
          { fact: "e", link: "", citeType: "none", upstreamConfirmed: false, wrong: false },
        ],
      },
    },
    { id: "P02", g1: { facts: [{ fact: "f", link: NID, citeType: "upstream_publisher", upstreamConfirmed: false, wrong: false }] } },
  ],
};
const reply = (status: number, body = "{}", error?: string): PublisherReply => ({ status, body, fetchedAt: "2026-10-20T00:00:00Z", sha256: "x", error });

describe("grades loader", () => {
  it("keeps only upstream_publisher facts on a host in the table, with the plan id and sourceId", () => {
    const f = inTableFacts(grades);
    expect(f.map((x) => `${x.plan}:${x.fact}:${x.sourceId}`)).toEqual(["P01:a:fema-openfema", "P01:b:fema-openfema", "P02:f:usace-nid"]);
  });
  it("groups facts by unique URL", () => {
    const rows = byUrl(inTableFacts(grades));
    expect(rows.map((r) => [r.url, r.facts.length])).toEqual([[OPENFEMA, 2], [NID, 1]]);
  });
  it("a record 'returned' means HTTP 200 with a non-empty body that is not an ArcGIS error object", () => {
    expect(recordReturned(reply(200, '{"a":1}'))).toBe(true);
    expect(recordReturned(reply(200, ""))).toBe(false);
    expect(recordReturned(reply(200, '{"error":{"code":503}}'))).toBe(false);
    expect(recordReturned(reply(0, "", "timeout"))).toBe(false);
    expect(recordReturned(reply(500, "x"))).toBe(false);
    expect(recordReturned(reply(404, "nope"))).toBe(false);
  });
  it("agree: record returned and reconciler confirmed; disagree: returned and not confirmed; unreachable: no record, never counted either way", () => {
    const rows = byUrl(inTableFacts(grades));
    const out = compare(rows, new Map([[OPENFEMA, reply(200, '{"x":1}')], [NID, reply(0, "", "timeout")]]));
    expect(out.map((o) => `${o.fact.fact}:${o.outcome}`)).toEqual(["a:agree", "b:disagree", "f:unreachable"]);
  });
  it("a URL with no reply at all is unreachable, not agree", () => {
    const out = compare(byUrl(inTableFacts(grades)), new Map());
    expect(new Set(out.map((o) => o.outcome))).toEqual(new Set(["unreachable"]));
  });
});
