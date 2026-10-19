// Ask Jev: the view model's rules and the one call it makes.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { WorldItem } from "@/lib/mcp/world";
import { fipsTarget, jevArguments, jevRequest, readReply } from "./ask";
import { parseShare, shareQuery } from "@/lib/globe/share";
import { parseJev } from "./flag";
import { JEV_TOPICS, gapSentence, jevSections, placeTitle, sourceHref, toLine, toSection } from "./format";

const base: WorldItem = { fact: "f", value: 1, sourceId: "s", publisher: "P", upstreamUrl: "https://u/", retrievedAt: "2026-10-19T12:00:00Z", link: "https://www.arxiviq.com/api/x" };

describe("toLine", () => {
  it("keeps a real 0 or false as the value", () => {
    expect(toLine({ ...base, value: 0 }).text).toBe("0");
    expect(toLine({ ...base, value: 0 }).fromNote).toBe(false);
    expect(toLine({ ...base, value: false }).text).toBe("no");
  });

  it("shows the note for a null value in plain words, never 0", () => {
    const l = toLine({ ...base, value: null, note: "name withheld (private owner); labelled by NID id", code: "nid:AL00011" });
    expect(l.text).toBe("name withheld (private owner); labelled by its NID id");
    expect(l.fromNote).toBe(true);
    expect(l.id).toBe("NID id AL00011");
    expect(toLine({ ...base, value: "Longhorn Dam", code: "nid:TX00001" }).id).toBeUndefined();
  });

  it("formats numbers with their unit and dates retrieval", () => {
    const l = toLine({ ...base, value: 1234567, unit: "USD a year (modelled)", period: "2026 Q1" });
    expect(l.text).toBe("1,234,567 USD a year (modelled)");
    expect(l.period).toBe("2026 Q1");
    expect(l.asOf).toBe("2026-10-19");
  });

  it("links upstreamRecordUrl, else link", () => {
    expect(sourceHref({ link: "L", upstreamRecordUrl: "R" })).toBe("R");
    expect(sourceHref({ link: "L" })).toBe("L");
  });
});

describe("toSection", () => {
  it("marks a topic only when it has missing entries", () => {
    expect(toSection("hazards", { items: [base] }).marker).toBeNull();
    const s = toSection("hazards", { items: [], missing: [{ what: "FEMA declarations", reason: "FEMA lists Connecticut under its 8 legacy counties." }] });
    expect(s.marker).toContain("FEMA declarations");
    expect(s.gaps[0].sentence).toBe("FEMA declarations: FEMA still files Connecticut under its 8 old counties, not the planning regions Census uses now, so nothing is filed under this region.");
    expect(s.gaps[0].rule).toBe("ct-legacy-counties");
  });

  it("writes a gap as what, then the plain sentence for its reason", () => {
    expect(gapSentence({ what: "elevation", reason: "USGS 3DEP gave no elevation for this point" })).toBe("elevation: USGS has no elevation for this spot.");
  });
});

describe("jevSections and placeTitle", () => {
  it("orders the spec's sections and skips topics the panel does not show", () => {
    const b = { topics: { freshness: { items: [] }, fabric: { items: [base] }, identity: { items: [base] } } };
    expect(jevSections(b).map((s) => s.key)).toEqual(["identity", "freshness"]);
  });

  it("names the place from the reply, else its point", () => {
    expect(placeTitle({ place: { name: "Mobile County, AL" } })).toBe("Mobile County, AL");
    expect(placeTitle({ place: { name: null, point: { lon: -40, lat: 30 } } })).toBe("30.0000, -40.0000");
  });
});

describe("the world_context call", () => {
  it("sends only the picked place and the panel's topics", () => {
    expect(jevArguments({ kind: "county", fips: "01097" })).toEqual({ fips: "01097", topics: JEV_TOPICS });
    expect(jevArguments({ kind: "point", lon: -97.743061234, lat: 30.267153 })).toEqual({ lon: -97.7431, lat: 30.2672, topics: JEV_TOPICS });
    const r = jevRequest({ kind: "state", fips: "48" });
    expect(r.method).toBe("tools/call");
    expect(r.params.name).toBe("world_context");
    expect(Object.keys(r.params.arguments).sort()).toEqual(["fips", "topics"]);
  });

  it("reads a recorded reply as the tool's payload", () => {
    const text = fs.readFileSync(path.join(__dirname, "__fixtures__", "texas.full.json"), "utf8");
    const viaText = readReply({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text }], isError: false } });
    expect(viaText.ok && viaText.bundle.place?.name).toBe("Texas");
    const viaStructured = readReply({ result: { structuredContent: JSON.parse(text), isError: false } });
    expect(viaStructured.ok).toBe(true);
  });

  it("reports an error reply with the tool's own words", () => {
    const r = readReply({ result: { structuredContent: { error: "no county with FIPS 09001" }, isError: true } });
    expect(r).toEqual({ ok: false, error: "no county with FIPS 09001" });
    expect(readReply({ error: { message: "bad" } })).toEqual({ ok: false, error: "bad" });
  });

  it("takes a county or state FIPS from the fabric's nodes, else nothing", () => {
    const nodes = [{ kind: "county", code: "01097" }, { kind: "state", code: "01" }];
    expect(fipsTarget("county", nodes)).toEqual({ kind: "county", fips: "01097" });
    expect(fipsTarget("state", nodes)).toEqual({ kind: "state", fips: "01" });
    expect(fipsTarget("county", [])).toBeNull();
  });
});

describe("the ?jev=1 flag", () => {
  it("is on only with jev=1", () => {
    expect(parseJev("?jev=1")).toBe(true);
    expect(parseJev("?lat=30&jev=1")).toBe(true);
    expect(parseJev("?jev=0")).toBe(false);
    expect(parseJev("")).toBe(false);
  });

  it("is kept in a share link while on, so a reload or a shared link keeps the panel", () => {
    const s = parseShare("?lat=30.2672&lon=-97.7431&jev=1");
    expect(s.jev).toBe(true);
    expect(new URLSearchParams(shareQuery(s)).get("jev")).toBe("1");
  });

  it("leaves a link without jev=1 untouched", () => {
    const s = parseShare("?lat=30&lon=-97&jev=0");
    expect(s.jev).toBeUndefined();
    expect(shareQuery(s)).not.toContain("jev");
  });
});
