// EPA EMEF rows -> Contaminated sites features, on rows captured from EMEF
// around the Houston Ship Channel (2026-10-12).
import { describe, expect, it } from "vitest";
import emefAcres from "./fixtures/emef-5-houston.json";
import emefRcra from "./fixtures/emef-4-houston.json";
import { buildContaminants, EMEF_FIELDS, EMEF_LAYERS, emefParams, type ContaminantExtra } from "./contaminants";
import { matchScore } from "@/lib/search/allowlist";

type Rows = Parameters<typeof buildContaminants>[1];

describe("EPA program listings", () => {
  it("uses EMEF's Superfund, TRI, hazardous waste and Brownfields layers only, and never asks for an address", () => {
    expect(EMEF_LAYERS.map((l) => l.layer)).toEqual([0, 1, 4, 5]);
    expect(EMEF_FIELDS as readonly string[]).not.toContain("location_address");
    expect(emefParams([-95.3, 29.7, -95.15, 29.8]).outFields).toBe("registry_id,primary_name,pgm_sys_acrnm,pgm_sys_id,facility_url");
  });

  it("names a listing by its program id; the facility name (here a street address) is in the record only and is not searched", () => {
    const acres = buildContaminants("acres", emefAcres.features as unknown as Rows);
    expect(acres).toHaveLength(24);
    const canal = acres.find((f) => (f.properties.extra as ContaminantExtra).programId === "10951")!;
    expect(canal.properties.name).toBe("Brownfields 10951");
    expect(canal.properties.details?.["facility (as EPA publishes it)"]).toBe("7238 CANAL STREET");
    expect(matchScore(canal.properties, "canal street")).toBe(0);
    expect(matchScore(canal.properties, "110038744320")).toBe(1);
  });

  it("keeps each program listing once, and only an https EPA record link", () => {
    const rcra = buildContaminants("rcra", emefRcra.features as unknown as Rows);
    expect(rcra).toHaveLength(617);
    const row = (emefRcra.features as unknown as Rows)[0];
    const twice = buildContaminants("rcra", [row, row]);
    expect(twice).toHaveLength(1);
    const plain = buildContaminants("rcra", [{ ...row, properties: { ...row.properties, facility_url: "http://example.invalid/x" } }]);
    expect(plain[0].properties.details?.["EPA record"]).toBeUndefined();
  });
});
