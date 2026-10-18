// The storm-events bake (scripts/bake-storm-events.mjs): the pure functions on labelled slices of
// NCEI's details files (lib/hazards/fixtures/se-*.slice.csv: whole rows cut from the 2026-10-17
// downloads of the 1996 (c20260323), 2025 (c20260819) and 2026 (c20260918) files, with the
// EPISODE_NARRATIVE and EVENT_NARRATIVE columns emptied, because the bake never reads free text).
//   se-2025.slice.csv        Travis County's county-coded rows (tornadoes included), the zone rows
//                            of the Texas zones that reach Travis in NWS's bp16ap26 table, Bayamón
//                            (Puerto Rico 99/21), Georgia's 13055 "CLAYTON" rows and Hartford (09003)
//   se-2025-as.slice.csv     three American Samoa (97) county-coded rows
//   se-1996.slice.csv        every 1996 Texas Flood row (zone and county), Travis's 1996 county rows
//                            and the Puerto Rico 99/17 "FAJARDO RIO GRANDE" rows
//   se-2026-type5.slice.csv  the two CZ_TYPE '5' rows of 2026
// storm-events-48.shard.json is this bake's own output on se-2025.slice.csv (labelled derived).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import counties from "@/lib/places/data/counties.json";
import { BOUNDARY_CHANGED_SINCE_2010 } from "./bake";
import { csvStream, foldCountyName, STORM_BREAKS, STORM_CT_LEGACY, STORM_STATE_CODES, stormBaker, stormCountyOf, stormFiles, stormNamesAgree } from "./stormBake";
import metaCommitted from "./data/storm-events/meta.json";
import shardTx from "./data/storm-events/48.json";

const refs = (counties as { rows: Array<{ geoid: string; name: string; stusab: string }> }).rows.map((r) => ({ geoid: r.geoid, name: r.name, stusab: r.stusab }));
const names = new Map(refs.map((r) => [r.geoid, r.name]));
const fx = (n: string) => readFileSync(path.resolve(__dirname, "fixtures", n), "latin1");

/** Bake the given slices, pushing each in small chunks so the reader is exercised across chunk edges. */
function bake(files: Array<{ year: number; name: string }>, chunk = 997) {
  const b = stormBaker(refs);
  for (const f of files) {
    b.beginFile({ year: f.year, file: f.name, stamp: "slice", url: `fixture:${f.name}` });
    const csv = csvStream((r) => b.row(r));
    const text = fx(f.name);
    for (let i = 0; i < text.length; i += chunk) csv.push(text.slice(i, i + chunk));
    csv.end();
    b.endFile({ sha256: null, bytes: null });
  }
  return b.result();
}

describe("csvStream", () => {
  it("reads quoted commas, doubled quotes and newlines inside quotes, across any chunk edge", () => {
    const text = 'A,B,C\r\n"x, y","say ""hi""","line one\nline two"\n1,,3\n';
    for (const size of [1, 2, 3, 7, text.length]) {
      const rows: string[][] = [];
      const s = csvStream((r) => rows.push(r));
      for (let i = 0; i < text.length; i += size) s.push(text.slice(i, i + size));
      s.end();
      expect(rows).toEqual([
        ["A", "B", "C"],
        ["x, y", 'say "hi"', "line one\nline two"],
        ["1", "", "3"],
      ]);
    }
  });
  it("reads a last row with no newline", () => {
    const rows: string[][] = [];
    const s = csvStream((r) => rows.push(r));
    s.push("a,b\n1,2");
    s.end();
    expect(rows).toEqual([["a", "b"], ["1", "2"]]);
  });
});

describe("the name check", () => {
  it("folds accents, suffixes and SAINT", () => {
    expect(foldCountyName("Bayamón Municipio")).toBe("BAYAMON");
    expect(foldCountyName("St. Louis County")).toBe("STLOUIS");
    expect(foldCountyName("SAINT LOUIS")).toBe("STLOUIS");
    expect(stormNamesAgree("DORAD", "Dorado Municipio")).toBe(true);
    expect(stormNamesAgree("CLAYTON", "Chattooga County")).toBe(false);
  });
  it("reads 99 as 72 only when the name agrees; 96-98 are not counties", () => {
    expect(STORM_STATE_CODES).toEqual({ "99": "72" });
    expect(stormCountyOf("99", "21", "BAYAMON", names)).toEqual({ kind: "county", code: "72021" });
    expect(stormCountyOf("99", "17", "FAJARDO RIO GRANDE", names)).toEqual({ kind: "name-mismatch", code: "72017", countyName: "Barceloneta Municipio" });
    expect(stormCountyOf("97", "1", "TUTUILA", names)).toEqual({ kind: "not-county", label: "97 American Samoa" });
    expect(stormCountyOf("13", "55", "CLAYTON", names)).toEqual({ kind: "name-mismatch", code: "13055", countyName: "Chattooga County" });
  });
  it("keeps a Connecticut legacy code under its own code when its name agrees, and maps the three Census renames", () => {
    expect(stormCountyOf("9", "3", "HARTFORD", names)).toEqual({ kind: "legacy-ct", code: "09003" });
    expect(stormCountyOf("9", "3", "TOLLAND", names).kind).toBe("name-mismatch");
    expect(Object.keys(STORM_CT_LEGACY)).toHaveLength(8);
    expect(stormCountyOf("12", "25", "DADE", names)).toEqual({ kind: "county", code: "12086", renamedFrom: "12025" });
    expect(stormCountyOf("46", "113", "SHANNON", names)).toEqual({ kind: "county", code: "46102", renamedFrom: "46113" });
    expect(stormCountyOf("2", "270", "WADE HAMPTON", names)).toEqual({ kind: "county", code: "02158", renamedFrom: "02270" });
    expect(stormCountyOf("51", "515", "BEDFORD (C)", names)).toEqual({ kind: "unmatched", code: "51515" });
  });
  it("has a break year for exactly the six counties whose boundary changed since 2010", () => {
    expect(Object.keys(STORM_BREAKS).sort()).toEqual(Object.keys(BOUNDARY_CHANGED_SINCE_2010).sort());
  });
});

describe("stormFiles", () => {
  it("takes the newest compilation of each year from 1996", () => {
    const html = ["StormEvents_details-ftp_v1.0_d1995_c20260323.csv.gz", "StormEvents_details-ftp_v1.0_d1996_c20250101.csv.gz", "StormEvents_details-ftp_v1.0_d1996_c20260323.csv.gz", "StormEvents_details-ftp_v1.0_d2025_c20260819.csv.gz", "StormEvents_locations-ftp_v1.0_d2025_c20260819.csv.gz"].map((f) => `<a href="${f}">${f}</a>`).join("\n");
    expect(stormFiles(html).map((f) => [f.year, f.stamp])).toEqual([
      [1996, "20260323"],
      [2025, "20260819"],
    ]);
  });
});

describe("the bake on the 2025 slice", () => {
  const { meta, shards } = bake([{ year: 2025, name: "se-2025.slice.csv" }, { year: 2025, name: "se-2025-as.slice.csv" }]);
  const ti = (t: string) => String(meta.types.indexOf(t));
  it("counts Travis 2025: hail 15, flash flood 7, thunderstorm wind 6; tornadoes and zone rows not attached", () => {
    const tr = shards["48"].counties["48453"]["2025"];
    expect(tr[ti("Hail")]).toBe(15);
    expect(tr[ti("Flash Flood")]).toBe(7);
    expect(tr[ti("Thunderstorm Wind")]).toBe(6);
    expect(meta.types).not.toContain("Tornado");
    expect(Object.values(tr).reduce((a, b) => a + b, 0)).toBe(28);
    expect(meta.excludedTypeRows["2025"].Tornado).toBeGreaterThan(0);
    expect(Object.values(meta.zoneRows["2025"]).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });
  it("puts Bayamón on 72021, the Georgia CLAYTON rows in nameMismatch, American Samoa in notCounty and Hartford under 09003", () => {
    expect(shards["72"].counties["72021"]["2025"]).toBeDefined();
    expect(shards["99"]).toBeUndefined();
    expect(meta.nameMismatch["2025"]).toEqual([["13055", "CLAYTON", "Chattooga County", 2]]);
    expect(meta.notCounty["2025"]).toEqual({ "97 American Samoa": 3 });
    expect(shards["09"].counties["09003"]).toBeDefined();
    expect(meta.legacyCt).toEqual(["09003"]);
  });
  it("is byte-identical on a rerun, and the committed derived shard is its output", () => {
    const again = bake([{ year: 2025, name: "se-2025.slice.csv" }, { year: 2025, name: "se-2025-as.slice.csv" }], 4096);
    expect(JSON.stringify(again)).toBe(JSON.stringify({ meta, shards }));
    const derived = JSON.parse(fx("storm-events-48.shard.json")) as { note: string; shard: unknown; types: string[] };
    expect(derived.shard).toEqual(shards["48"]);
    expect(derived.types).toEqual(meta.types);
  });
});

describe("the bake on the 1996 and 2026 slices", () => {
  it("lists 1996's FAJARDO RIO GRANDE area under nameMismatch, never on a municipio", () => {
    const { meta, shards } = bake([{ year: 1996, name: "se-1996.slice.csv" }]);
    expect(meta.nameMismatch["1996"].map((x) => [x[0], x[1]])).toEqual([["72017", "FAJARDO RIO GRANDE"]]);
    expect(shards["72"]).toBeUndefined();
    // Texas 1996 floods: the slice has more zone-coded rows than county-coded ones; the route's gate
    // reads the national zone share of a type-year (10 % or more, STORM_ZONE_SHARE_MAX), from zoneRows.
    expect(meta.zoneRows["1996"].Flood).toBeGreaterThan(meta.countyRows["1996"].Flood);
  });
  it("puts the two CZ_TYPE '5' rows of 2026 under otherCzType", () => {
    const { meta } = bake([{ year: 2026, name: "se-2026-type5.slice.csv" }]);
    expect(meta.otherCzType["2026"]).toEqual({ "5": 2 });
    expect(meta.attachedRows).toBe(0);
  });
});

describe("the committed bake (31 files, 1996-2026)", () => {
  const m = metaCommitted as unknown as import("./stormBake").StormMeta;
  it("read every file whole: the design's row counts for 1996, 2025 and 2026, nothing malformed", () => {
    expect(m.files).toHaveLength(31);
    const rows = Object.fromEntries(m.files.map((f) => [f.year, f.rows]));
    expect([rows[1996], rows[2025], rows[2026]]).toEqual([48534, 72360, 39062]);
    expect(m.files.every((f) => f.malformedRows === 0 && /^[0-9a-f]{64}$/.test(f.sha256 ?? ""))).toBe(true);
    expect(m.lastYearMonth).toBe("202606");
  });
  it("reproduces the design's name-check tallies (1996: 139, 2025: 60) and never attaches a tornado", () => {
    const n = (y: string) => (m.nameMismatch[y] ?? []).reduce((a, x) => a + x[3], 0);
    expect(n("1996")).toBe(139);
    expect(n("2025")).toBe(60);
    expect(m.types).not.toContain("Tornado");
  });
  it("has 51 shards: no Alaska, whose county-coded rows are all NCEI's own areas", () => {
    expect(m.shards).toHaveLength(51);
    expect(m.shards).not.toContain("02");
    expect(m.shards).toContain("09");
    expect(m.shards).toContain("72");
  });
  it("matches the committed Texas shard for Travis 2025", () => {
    const tr = (shardTx as { counties: Record<string, Record<string, Record<string, number>>> }).counties["48453"]["2025"];
    expect(tr[String(m.types.indexOf("Hail"))]).toBe(15);
  });
});
