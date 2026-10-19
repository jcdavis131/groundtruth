import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { damIsNamed } from "./features";

// One case table for all three copies of the dam naming rule: this one, data/schema/validate.mjs and
// data/pipeline/cards.py dam_name_rule. Every owner pair NID publishes, plus edge cases.
type Case = { primary: string | null; ownerTypes: string | null; absent?: boolean; named: boolean; from: string; dams?: number };
const doc = JSON.parse(readFileSync(path.resolve(__dirname, "../../../../data/schema/fixtures/dam-owner-cases.json"), "utf8")) as { cases: Case[]; dams: number; namedDams: number };

describe("dam naming rule parity", () => {
  it.each(doc.cases.map((c) => [`${JSON.stringify(c.primary)} / ${c.absent ? "(no owner types)" : JSON.stringify(c.ownerTypes)}`, c] as const))("%s", (_label, c) => {
    const p: Record<string, unknown> = { PRIMARY_OWNER_TYPE: c.primary };
    if (!c.absent) p.OWNER_TYPES = c.ownerTypes;
    expect(damIsNamed(p)).toBe(c.named);
  });

  it("names the dams NID's own counts say are nameable", () => {
    const named = doc.cases.filter((c) => c.from === "NID" && damIsNamed({ PRIMARY_OWNER_TYPE: c.primary, OWNER_TYPES: c.ownerTypes })).reduce((n, c) => n + (c.dams ?? 0), 0);
    expect(named).toBe(doc.namedDams);
  });
});
