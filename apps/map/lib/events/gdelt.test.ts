// GDELT folding on a real 15-minute export file (2026-09-26 21:45 UTC,
// 329 events), read through the in-memory zip reader.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { firstEntryText } from "@/lib/server/zip";
import { CAMEO_ROOT, eventFeature, exportStamps, exportUrl, foldEvents, GDELT_COLUMNS } from "./gdelt";

const zip = readFileSync(path.join(__dirname, "fixtures", "20260926214500.export.CSV.zip"));

describe("the zip reader", () => {
  it("inflates GDELT's single CSV", () => {
    const { name, text } = firstEntryText(zip);
    expect(name).toBe("20260926214500.export.CSV");
    const rows = text.split("\n").filter(Boolean);
    expect(rows).toHaveLength(329);
    expect(rows.every((r) => r.split("\t").length === GDELT_COLUMNS)).toBe(true);
  });
  it("refuses something that is not a zip", () => {
    expect(() => firstEntryText(Buffer.from("not a zip at all, just text that is long enough"))).toThrow(/zip/);
  });
});

describe("foldEvents", () => {
  const { text } = firstEntryText(zip);
  const r = foldEvents([text]);
  it("keeps city-level conflict events only, and says what it left off", () => {
    expect(r.rows).toBe(329);
    expect(r.notConflict).toBe(213);
    const kept = r.places.reduce((s, p) => s + p.events, 0);
    expect(kept).toBe(63);
    expect(r.places).toHaveLength(25);
    expect(kept + r.notConflict + r.notCityLevel + r.noPosition).toBe(r.rows);
  });
  it("folds a place's events together with GDELT's own city point", () => {
    const sadad = r.places.find((p) => p.name.startsWith("Sadad"))!;
    expect(sadad.lat).toBeCloseTo(26.0828);
    expect(sadad.lon).toBeCloseTo(50.4897);
    expect(sadad.geoType).toBe("4");
    expect(sadad.domains).toContain("gdnonline.com");
  });
  it("counts each event once across overlapping files", () => {
    const twice = foldEvents([text, text]);
    expect(twice.rows).toBe(329);
    expect(twice.places.reduce((s, p) => s + p.events, 0)).toBe(63);
  });
  it("never carries an actor name or an article link into a feature", () => {
    const rows = text.split("\n").filter(Boolean).map((l) => l.split("\t"));
    const actorNames = new Set(rows.flatMap((c) => [c[6], c[16]]).filter((n) => n && n.length > 3));
    expect(actorNames.size).toBeGreaterThan(0);
    for (const p of r.places) {
      const f = eventFeature(p, "last hour");
      const blob = JSON.stringify(f);
      expect(blob).not.toMatch(/https?:\/\/(?!www\.gdeltproject\.org)/);
      for (const n of actorNames) expect(blob.includes(`"${n}"`), n).toBe(false);
    }
  });
  it("labels event classes with CAMEO's own names", () => {
    expect(CAMEO_ROOT["14"]).toBe("Protest");
    expect(CAMEO_ROOT["19"]).toBe("Fight");
    const f = eventFeature(r.places[0], "last hour");
    expect(String(f.properties.details?.["by CAMEO event class"])).toMatch(/^[A-Z][a-z]/);
  });
});

describe("export stamps", () => {
  it("walks back a quarter hour at a time from lastupdate.txt", () => {
    const txt = "22303 7edc97a7 http://data.gdeltproject.org/gdeltv2/20260926211500.export.CSV.zip\n45706 d7b4 http://data.gdeltproject.org/gdeltv2/20260926211500.mentions.CSV.zip";
    expect(exportStamps(txt, 4)).toEqual(["20260926211500", "20260926210000", "20260926204500", "20260926203000"]);
    expect(exportUrl("20260926211500")).toBe("https://data.gdeltproject.org/gdeltv2/20260926211500.export.CSV.zip");
    expect(() => exportStamps("nothing here", 2)).toThrow(/lastupdate/);
  });
});
