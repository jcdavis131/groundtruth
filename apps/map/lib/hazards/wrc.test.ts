// USFS Wildfire Risk to Communities on answers captured 2026-10-17, unmodified: Boulder County's
// full row (wrc-county-08013), the one county with every rank blank (wrc-county-blank: DC),
// Connecticut's nine planning-region GEOIDs (wrc-county-ct), and a Boulder-area community box
// asked with the route's own fields (wrc-place-boulder-box), which holds one excluded community
// (Leyner CDP, exclude = 1, "no people (pop = 0);"). The county outlines are
// /api/economy?op=areas for the Connecticut box (lib/economy/fixtures).
import { describe, expect, it } from "vitest";
import boulder from "./fixtures/wrc-county-08013.json";
import blank from "./fixtures/wrc-county-blank.json";
import ct from "./fixtures/wrc-county-ct.json";
import places from "./fixtures/wrc-place-boulder-box.json";
import areasCt from "@/lib/economy/fixtures/areas-ct.json";
import { countyOutlines } from "@/lib/layers/areas";
import { receivedRecordText } from "@/lib/catalog/recordText";
import {
  buildWrcPlaces,
  joinWrcCounties,
  packWrcRow,
  parsePct,
  rerankWrc,
  unpackWrcRow,
  WRC_CAVEAT,
  WRC_COUNTY_FIELDS,
  WRC_RANKS,
  WRC_VALUE_FIELDS,
  wrcBin,
  wrcDetails,
  wrcRankWords,
  wrcRow,
  type WrcExtra,
  type WrcRow,
} from "./wrc";

type EsriRows = { features: Array<{ attributes: Record<string, unknown> }> };
const rows = (j: unknown) => (j as EsriRows).features.map((f) => wrcRow(f.attributes)).filter((r): r is WrcRow => r != null);
const outlines = countyOutlines((areasCt as unknown as { data: Parameters<typeof countyOutlines>[0] }).data);

describe("WRC rows", () => {
  it("asks the 14 rank and count fields by name, plus GEOID", () => {
    expect(WRC_VALUE_FIELDS).toHaveLength(14);
    expect(WRC_COUNTY_FIELDS).not.toContain("*");
  });

  it("parses only the % suffix: '97.20%' is 97.2, a blank or anything else is null", () => {
    expect(parsePct("97.20%")).toBe(97.2);
    expect(parsePct(" ")).toBeNull();
    expect(parsePct("")).toBeNull();
    expect(parsePct(null)).toBeNull();
    expect(parsePct("n/a")).toBeNull();
    expect(parsePct("120%")).toBeNull();
  });

  it("reads Boulder County's every rank, keeping the published strings", () => {
    const [b] = rows(boulder);
    expect(b.geoid).toBe("08013");
    expect(b.national).toEqual([97.2, 95.7, 98.7, 98.8]);
    expect(b.stateRank).toEqual([95.2, 95.2, 95.2, 95.2]);
    expect(b.exposure).toEqual([25.84, 26.7, 28.63, 16.38]);
    expect(b.buildings).toBe(119558);
    expect(b.raw.RISK_NATIO).toBe("97.20%");
    const d = wrcDetails(b, "county");
    expect(d.RISK_NATIONAL_RANK).toBe("97.20% (ranked at the 97.2 percentile of US counties)");
    expect(d["buildings in direct exposure"]).toBe("26.70%");
  });

  it("reads DC's blank ranks as not ranked, never bin 0", () => {
    const [dc] = rows(blank);
    expect(dc.geoid).toBe("11001");
    expect(dc.national).toEqual([null, null, null, null]);
    const j = joinWrcCounties([], [dc], 0, "national");
    expect(j.unmatched).toEqual(["11001"]);
    expect(wrcBin(dc.national[0])).toBeNull();
  });

  it("round-trips the compact wire row", () => {
    const [b] = rows(boulder);
    const back = unpackWrcRow(packWrcRow(b));
    expect(back.national).toEqual(b.national);
    expect(back.raw).toEqual(b.raw);
  });

  it("bins on the fixed breaks 40 / 70 / 90 / 95", () => {
    expect([0, 39.9, 40, 70, 90, 95, 100].map(wrcBin)).toEqual([0, 0, 1, 2, 3, 4, 4]);
  });
});

describe("Connecticut", () => {
  it("joins all nine planning regions; none unmatched", () => {
    const geoids = (ct as EsriRows).features.map((f) => String(f.attributes.GEOID));
    expect(geoids).toHaveLength(9);
    // The CT fixture carries GEOID only (no ranks): every region is a row, so each joins (not ranked, not 'not in this release').
    const r = geoids.map((g) => wrcRow({ GEOID: g })!);
    const j = joinWrcCounties(outlines, r, 0, "national");
    expect(j.unmatched).toEqual([]);
    const joined = j.features.filter((f) => geoids.includes((f.properties.extra as WrcExtra).geoid));
    expect(joined).toHaveLength(9);
    for (const f of joined) expect((f.properties.extra as WrcExtra).row).not.toBeNull();
  });
});

describe("communities", () => {
  const built = buildWrcPlaces((places as unknown as { features: never[] }).features, 0, "national");

  it("draws Boulder city by its national rank", () => {
    const b = built.find((f) => f.properties.name === "Boulder city, CO")!;
    const x = b.properties.extra as WrcExtra;
    expect(x.geoid).toBe("0807850");
    expect(x.value).toBe(96.5);
    expect(x.bin).toBe(4);
  });

  it("draws an excluded community unfilled with USFS's reason, never low", () => {
    const l = built.find((f) => f.properties.name === "Leyner CDP, CO")!;
    const x = l.properties.extra as WrcExtra;
    expect(x.bin).toBeNull();
    expect(l.properties.kind).toBe("not-ranked");
    expect(x.noRank).toBe("not ranked by USFS: no people (pop = 0)");
    expect(l.properties.details?.["not ranked because"]).toBe("no people (pop = 0);");
    expect(receivedRecordText(l.properties)).toBe(
      "collection: Wildfire risk to communities; agency: USDA Forest Service; state: CO; wildfire risk community, national risk rank: not ranked by USFS; wildfire likelihood (burn probability), national rank: not ranked by USFS; not ranked by USFS because: no people (pop = 0);",
    );
  });

  it("embeds the RISK and BP national ranks as the layer's bins, whatever measure and scope draw it", () => {
    const b = built.find((f) => f.properties.name === "Boulder city, CO")!;
    const text = "collection: Wildfire risk to communities; agency: USDA Forest Service; state: CO; wildfire risk community, national risk rank: 95 or more percentile; wildfire likelihood (burn probability), national rank: 95 or more percentile";
    expect(receivedRecordText(b.properties)).toBe(text);
    const other = buildWrcPlaces((places as unknown as { features: never[] }).features, 2, "state");
    expect(other.map((f) => receivedRecordText(f.properties))).toEqual(built.map((f) => receivedRecordText(f.properties)));
    expect([null, 0, 39.9, 40, 69.99, 70, 90, 94.9, 95, 100].map(wrcRankWords)).toEqual([
      "not ranked by USFS",
      "under 40 percentile",
      "under 40 percentile",
      "40 to 70 percentile",
      "40 to 70 percentile",
      "70 to 90 percentile",
      "90 to 95 percentile",
      "90 to 95 percentile",
      "95 or more percentile",
      "95 or more percentile",
    ]);
  });

  it("embeds the state and the exclude reason, never the community's name", () => {
    for (const f of built) {
      const t = receivedRecordText(f.properties) ?? "";
      // B0 (2026-10-18): the card's head, then the state; the Census place name stays out (an exclusion on the card).
      expect(t).toMatch(/^collection: Wildfire risk to communities; agency: USDA Forest Service; state: CO/);
      expect(t).not.toContain(f.properties.name.replace(/, CO$/, ""));
    }
  });

  it("re-ranks at state scope without refetching", () => {
    const again = rerankWrc(built, 0, "state");
    const b = again.find((f) => f.properties.name === "Boulder city, CO")!;
    expect((b.properties.extra as WrcExtra).scope).toBe("state");
    expect(WRC_RANKS[0].stateAlias).toBe("RISK_STATE_RANK");
  });

  it("says what a rank is not", () => {
    expect(WRC_CAVEAT).toMatch(/not a forecast/);
    expect(WRC_CAVEAT).toMatch(/2nd edition, 2024/);
  });
});
