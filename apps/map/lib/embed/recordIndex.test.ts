// The browser's record index, with the real embedder over real fixture
// features (their record text comes from the route builders).

import { describe, expect, it } from "vitest";
import { recordFixtures } from "./__fixtures__/records";
import { potionNode } from "./loadNode";
import { RecordIndex, featureKey } from "./recordIndex";
import { queryText } from "@/lib/catalog/recordText";

const features = recordFixtures().flatMap((r) => r.features);

describe("RecordIndex", () => {
  it("indexes only features with record text, and follows what is loaded", () => {
    const idx = new RecordIndex(potionNode());
    idx.sync(features);
    const withText = features.filter((f) => (f.properties.extra as { embedText?: string } | undefined)?.embedText);
    expect(idx.size).toBe(new Set(withText.map(featureKey)).size);
    idx.sync(withText.slice(0, 3));
    expect(idx.size).toBe(3);
  });

  it("caps the index, dropping the oldest", () => {
    const idx = new RecordIndex(potionNode(), 5);
    idx.sync(features);
    expect(idx.size).toBe(5);
  });

  it("returns hits above the threshold, best first, without the excluded keys", () => {
    const model = potionNode();
    const idx = new RecordIndex(model);
    idx.sync(features);
    const q = model.embed(queryText("earth dam with high hazard potential")!)!;
    const hits = idx.search(q, 5, 0);
    expect(hits.length).toBe(5);
    for (let i = 1; i < hits.length; i++) expect(hits[i - 1].score).toBeGreaterThanOrEqual(hits[i].score);
    expect(hits[0].feature.properties.layer).toBe("dams");
    const ex = new Set([featureKey(hits[0].feature)]);
    expect(idx.search(q, 5, 0, ex).map((h) => featureKey(h.feature))).not.toContain(featureKey(hits[0].feature));
    expect(idx.search(q, 5, 1.01)).toEqual([]);
  });
});
