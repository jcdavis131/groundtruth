// Power plants from the bundled snapshots (EIA-860M August 2026, Wikidata
// pulled 2026-09-26): what a box returns, what a planned-only plant says, and
// that the reporting entity never reaches a name or the search allowlist.

import { describe, expect, it } from "vitest";
import { searchableDetail } from "@/lib/search/allowlist";
import eiaJson from "./data/plants-eia860m.json";
import wdJson from "./data/nuclear-wikidata.json";
import { eiaPlants, fuelFamily, largestFirst, wikidataCapacity, wikidataNuclear, type EiaSnapshot, type PlantExtra, type WikidataCapacity, type WikidataSnapshot } from "./plants";

const eia = eiaJson as unknown as EiaSnapshot;
const wd = wdJson as unknown as WikidataSnapshot;
const SA: [number, number, number, number] = [-98.8, 29.2, -98.3, 29.6];

describe("EIA-860M plants", () => {
  const sa = eiaPlants(eia, SA);
  it("returns every plant in the box, planned ones included", () => {
    expect(sa).toHaveLength(24);
    expect(sa.filter((f) => f.properties.kind === "planned")).toHaveLength(3);
  });
  it("sums a plant's nameplate MW as EIA lists it, with the reporting entity in the dossier only", () => {
    const b = sa.find((f) => f.properties.name === "V H Braunig")!;
    expect(b.properties.id).toBe("eia:3612");
    expect((b.properties.extra as PlantExtra).mw).toBe(1138);
    expect(b.properties.details?.["operating capacity"]).toBe("1,138 MW nameplate");
    expect(b.properties.details?.["reporting entity (EIA)"]).toBe("City of San Antonio - (TX)");
    expect(b.properties.name).not.toContain("City of San Antonio");
    expect(searchableDetail("reporting entity (EIA)")).toBe(false);
    expect(searchableDetail("EIA plant id")).toBe(true);
  });
  it("gives a planned-only plant no operating capacity and says so", () => {
    const planned = eiaPlants(eia, [-85.4, 34.2, -85.3, 34.3]).find((f) => f.properties.id === "eia:708")!;
    expect(planned.properties.kind).toBe("planned");
    expect((planned.properties.extra as PlantExtra).mw).toBeUndefined();
    expect(planned.properties.details?.["operating capacity"]).toBe("none yet (planned)");
    expect(planned.properties.details?.["planned capacity"]).toBe("57.5 MW nameplate");
  });
  it("applies a size floor to operating or planned capacity", () => {
    expect(eiaPlants(eia, SA, 500).map((f) => f.properties.name).sort()).toEqual(["Arthur Von Rosenberg", "J K Spruce", "O W Sommers", "V H Braunig"]);
  });
  it("counts a generator with no nameplate value without adding it as 0 MW", () => {
    const row = JSON.parse(JSON.stringify(eia.plants.find((r) => r[0] === 3612)));
    // The same plant with one more generator of that technology that EIA listed with no nameplate value.
    row[10][0][2] += 1;
    row[10][0][3] = 1;
    const [f] = eiaPlants({ ...eia, plants: [row] }, SA);
    expect((f.properties.extra as PlantExtra).mw).toBe(1138);
    expect(String(f.properties.details?.["operating generators"])).toContain("1 with no nameplate value");
  });
  it("names the colour family from the technology EIA publishes", () => {
    expect(fuelFamily("Nuclear")).toBe("nuclear");
    expect(fuelFamily("Hydroelectric Pumped Storage")).toBe("storage");
    expect(fuelFamily("Natural Gas Fired Combined Cycle")).toBe("gas");
    expect(fuelFamily("Petroleum Liquids")).toBe("oil");
    expect(fuelFamily("Solar Photovoltaic")).toBe("solar");
    expect(fuelFamily(undefined)).toBe("other");
  });
});

describe("largestFirst", () => {
  const mw = (f: { properties: { extra?: unknown } }) => {
    const x = f.properties.extra as PlantExtra;
    return Math.max(x.mw ?? 0, x.plannedMw ?? 0);
  };
  it("sends every plant, as they came, when they fit", () => {
    const sa = eiaPlants(eia, SA);
    const r = largestFirst(sa, 10_000_000);
    expect(r.truncated).toBe(false);
    expect(r.features).toBe(sa);
  });
  it("keeps the world at min=0 under one response, largest first, and names the floor it reached", () => {
    const world = eiaPlants(eia, [-180, -90, 180, 90]);
    expect(JSON.stringify(world).length).toBeGreaterThan(4_500_000);
    const r = largestFirst(world, 3_000_000);
    expect(r.truncated).toBe(true);
    expect(JSON.stringify(r.features).length).toBeLessThanOrEqual(3_000_000);
    expect(r.features.length).toBeGreaterThan(1000);
    const kept = r.features.map(mw);
    for (let i = 1; i < kept.length; i++) expect(kept[i]).toBeLessThanOrEqual(kept[i - 1]);
    expect(r.floorMw).toBe(kept[kept.length - 1]);
    // Nothing left out is larger than the floor.
    const keptIds = new Set(r.features.map((f) => f.properties.id));
    for (const f of world) if (!keptIds.has(f.properties.id)) expect(mw(f)).toBeLessThanOrEqual(r.floorMw!);
  });
});

describe("Wikidata nuclear plants", () => {
  const one = (qid: string, lon: number, lat: number) => wikidataNuclear(wd, [lon - 0.01, lat - 0.01, lon + 0.01, lat + 0.01]).find((x) => x.properties.id === `wd:${qid}`)!;

  it("counts distinct coordinate locations, not query rows, and draws a fixed one", () => {
    // Leningrad (Q3279825) has one coordinate and three capacity statements in Wikidata; the row product once made it "3".
    const len = wd.plants.find((p) => p[0] === "Q3279825")!;
    expect(len[7]).toBe(1);
    // Q123002687 has two coordinate statements in Wikidata; the westernmost is drawn.
    const two = wd.plants.find((p) => p[0] === "Q123002687")!;
    expect(two[7]).toBe(2);
    expect(two[2]).toBe(109.4825);
    const [f] = wikidataNuclear(wd, [109, 21, 110, 22]).filter((x) => x.properties.id === "wd:Q123002687");
    expect(f.properties.details?.["coordinate locations"]).toBe("2 in Wikidata (the westernmost is drawn)");
  });

  it("reads only best-rank capacity: a preferred statement wins over larger normal-rank ones", () => {
    // Leningrad in Wikidata (checked 2026-09-26): 3,700 MW (normal, ended 2018-12-22), 2,775 MW
    // (normal, 2018-12-23 to 2020-11-10) and 1,850 MW (preferred, since 2020-11-11). The query
    // keeps best rank only, so this checks the pulled snapshot: the superseded 3,700 MW never
    // sizes the plant or reaches its dossier.
    const len = wd.plants.find((p) => p[0] === "Q3279825")!;
    expect(len[6]).toEqual([[1850, null, "2020-11-11", null, null]]);
    const f = one("Q3279825", len[2], len[3]);
    expect((f.properties.extra as PlantExtra).mw).toBe(1850);
    expect(f.properties.details?.["nameplate capacity"]).toBe("1,850 MW (since 2020-11-11)");
    expect(f.properties.details?.["capacity drawn"]).toBeUndefined();
    // Phénix: 233 MW (normal, 1973 to 1996) and 130 MW (preferred, 1997 to 2010); its end date stays.
    const phenix = wd.plants.find((p) => p[0] === "Q113368")!;
    expect(phenix[6]).toEqual([[130, null, "1997", "2010", null]]);
    expect(one("Q113368", phenix[2], phenix[3]).properties.details?.["nameplate capacity"]).toBe("130 MW (1997 to 2010)");
    // No superseded maximum is left anywhere: every plant with several figures has only best-rank ones.
    expect(wd.plants.filter((p) => new Set(p[6].map((c) => c[0])).size > 1).map((p) => p[0])).toEqual(["Q1539046"]);
  });

  it("sizes a plant with several best-rank figures by the most recent one, and shows each with its date", () => {
    // Oskarshamn: two normal-rank statements, 2,500 MW (point in time 2014) and 1,400 MW (2018), none preferred.
    const osk = wd.plants.find((p) => p[0] === "Q1539046")!;
    const f = one("Q1539046", osk[2], osk[3]);
    expect((f.properties.extra as PlantExtra).mw).toBe(1400);
    expect(f.properties.details?.["nameplate capacity"]).toBe("1,400 MW (2018) / 2,500 MW (2014)");
    expect(f.properties.details?.["capacity drawn"]).toBe("1,400 MW, the most recent of Wikidata's figures");
  });

  it("leaves a plant unsized when Wikidata does not say which of its figures is current", () => {
    const c = (mw: number, pit: string | null, start: string | null = null, method: string | null = null): WikidataCapacity => [mw, pit, start, null, method];
    // Undated, the same date, or dates of different precision that overlap: no pick.
    expect(wikidataCapacity([c(6710, null), c(6366, null)])).toEqual({ mw: undefined, text: "6,710 MW / 6,366 MW", figures: 2 });
    expect(wikidataCapacity([c(1000, "2018"), c(900, "2018")]).mw).toBeUndefined();
    expect(wikidataCapacity([c(1000, "2018"), c(900, "2018-06")]).mw).toBeUndefined();
    expect(wikidataCapacity([c(1000, "1970s"), c(900, "1975")]).mw).toBeUndefined();
    expect(wikidataCapacity([c(1000, "1970s"), c(900, "1985")]).mw).toBe(900);
    // One undated figure among dated ones blocks the pick too.
    expect(wikidataCapacity([c(1000, "2014"), c(900, "2018"), c(950, null)]).mw).toBeUndefined();
    // Start time orders a figure when there is no point in time; the method is shown.
    expect(wikidataCapacity([c(5080, null, "2015"), c(6240, null, "2021", "nameplate capacity")])).toEqual({ mw: 6240, text: "6,240 MW (since 2021; method: nameplate capacity) / 5,080 MW (since 2015)", figures: 2 });
    // Two statements of one figure are one figure, whatever their dates.
    expect(wikidataCapacity([c(985, null), c(985, "2021")]).mw).toBe(985);
    expect(wikidataCapacity([])).toEqual({ figures: 0 });
  });

  it("leaves out plants in the United States, which EIA covers", () => {
    expect(wd.plants.length).toBe(286);
    expect(wd.plants.some((p) => /United States/.test(p[4] ?? ""))).toBe(false);
  });
  it("shows status and capacity only where Wikidata has them", () => {
    const [z] = wikidataNuclear(wd, [34, 47, 35, 48]);
    expect(z.properties.name).toBe("Zaporizhzhia Nuclear Power Plant");
    expect(z.properties.details?.status).toBe("in partial operation");
    expect(z.properties.details?.["nameplate capacity"]).toBe("5,700 MW");
    const none = wd.plants.find((p) => p[5].length === 0)!;
    const [f] = wikidataNuclear(wd, [none[2] - 0.01, none[3] - 0.01, none[2] + 0.01, none[3] + 0.01]).filter((x) => x.properties.id === `wd:${none[0]}`);
    expect(f.properties.details?.status).toBe("not recorded in Wikidata");
  });
});
