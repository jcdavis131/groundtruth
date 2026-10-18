// Which dossiers must show the City of Chicago's disclaimer: every zoning
// district, permit and licence built from a Chicago dataset, and nothing else.
// Built from the captured Chicago and Seattle payloads. No network.
import { describe, expect, it } from "vitest";
import { CHICAGO_DISCLAIMER, requiredDisclaimer } from "./terms";
import { buildPermits } from "@/lib/permits/features";
import { buildLicences } from "@/lib/permits/licences";
import { licenceFeature, permitFeature } from "@/lib/permits/dossier";
import { licenceFeatures, permitFeatures } from "@/lib/permits/geojson";
import { buildOutlines, cityRecord, hitFor } from "@/lib/zoning/features";
import { zoningPointFeature } from "@/lib/zoning/dossier";

import chicagoPermits from "@/lib/permits/fixtures/permits-chicago.json";
import seattlePermits from "@/lib/permits/fixtures/permits-seattle.json";
import chicagoLicences from "@/lib/permits/fixtures/licences-chicago.json";
import nysla from "@/lib/permits/fixtures/licences-nysla.json";
import chicagoPoint from "@/lib/zoning/fixtures/chicago-point.json";
import chicagoOutlines from "@/lib/zoning/fixtures/chicago-outlines.json";
import seattleOutlines from "@/lib/zoning/fixtures/seattle-outlines.json";

type Row = Record<string, unknown>;
const rows = (j: unknown) => (j as Row[]).map((r) => ({ geometry: null, properties: r }));
type Fc = Parameters<typeof buildOutlines>[1];

describe("requiredDisclaimer", () => {
  it("Chicago's permits, licences and zoning carry it", () => {
    const permit = permitFeatures(buildPermits("chicago", rows(chicagoPermits))).features.map(permitFeature)[0];
    const licence = licenceFeatures(buildLicences("chicago", chicagoLicences as Row[]).records).features.map(licenceFeature)[0];
    const outline = buildOutlines("chicago", (chicagoOutlines as unknown as { features: Fc }).features)[0];
    const point = zoningPointFeature(cityRecord("chicago", -87.6305, 41.8842, { geoid: "1714000", name: "Chicago city" }, hitFor("chicago", chicagoPoint as Row[])), 0);
    for (const p of [permit.properties, licence.properties, { layer: "zoning", extra: outline.properties }, point.properties]) {
      expect(requiredDisclaimer(p), p.layer).toBe(CHICAGO_DISCLAIMER);
    }
  });

  it("other cities, other registries and other layers do not", () => {
    const permit = permitFeatures(buildPermits("seattle", rows(seattlePermits))).features.map(permitFeature)[0];
    const licence = licenceFeatures(buildLicences("nysla", nysla as Row[]).records).features.map(licenceFeature)[0];
    const outline = buildOutlines("seattle", (seattleOutlines as unknown as { features: Fc }).features)[0];
    for (const p of [permit.properties, licence.properties, { layer: "zoning", extra: outline.properties }, { layer: "envpermits", extra: { city: "chicago" } }, { layer: "zoning" }]) {
      expect(requiredDisclaimer(p), p.layer).toBeNull();
    }
  });
});
