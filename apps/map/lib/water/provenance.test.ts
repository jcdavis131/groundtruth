import { describe, expect, it } from "vitest";
import { citation } from "@/lib/provenance/types";
import { nwpsProvenance, sentinelProvenance, twdbProvenance, usdmProvenance, usgsProvenance, waterEstimateProvenance } from "./provenance";

const at = "2026-09-11T10:00:00.000Z";

describe("water provenance builders", () => {
  it("usgs: site:param seriesId and an items URL for one site", () => {
    const p = usgsProvenance({ collection: "daily", site: "USGS-08180800", params: ["00060"], period: "2025-09-11/2026-09-11", retrievedAt: at });
    expect(p.source.id).toBe("usgs-water");
    expect(p.seriesId).toBe("USGS-08180800:00060");
    expect(p.upstreamUrl).toBe("https://api.waterdata.usgs.gov/ogcapi/v0/collections/daily/items?f=json&monitoring_location_id=USGS-08180800&parameter_code=00060");
    expect(p.period).toBe("2025-09-11/2026-09-11");
    expect(p.revision).toContain("provisional");
    expect(p.notes).toEqual(["Site page: https://waterdata.usgs.gov/monitoring-location/08180800/"]);
    expect(citation(p)).toContain("series USGS-08180800:00060");
  });
  it("usgs: collection plus parameter list for a bbox, approval flag as revision", () => {
    const p = usgsProvenance({ collection: "latest-continuous", params: ["00060", "00065"], approval: "Provisional", retrievedAt: at, notes: ["bbox -99,29,-98,30"] });
    expect(p.seriesId).toBe("latest-continuous 00060,00065");
    expect(p.upstreamUrl).toBe("https://api.waterdata.usgs.gov/ogcapi/v0/collections/latest-continuous/items");
    expect(p.revision).toBe("Provisional");
    expect(p.notes).toEqual(["bbox -99,29,-98,30"]);
    expect(usgsProvenance({ collection: "latest-daily", retrievedAt: at }).seriesId).toBe("latest-daily");
    expect(usgsProvenance({ collection: "latest-daily", retrievedAt: at }).notes).toBeUndefined();
  });
  it("nwps, twdb, usdm, sentinel", () => {
    const n = nwpsProvenance(at, "2026-09-11T09:45:00Z");
    expect(n.source.id).toBe("noaa-nwps");
    expect(n.period).toBe("2026-09-11T09:45:00Z");
    expect(nwpsProvenance(at, null, "SATT2").upstreamUrl).toBe("https://water.noaa.gov/gauges/SATT2");
    const t = twdbProvenance("2026-09-10T00:00:00", at);
    expect(t.period).toBe("2026-09-10");
    expect(twdbProvenance(null, at, "medina").upstreamUrl).toContain("/individual/medina");
    const u = usdmProvenance(at);
    expect(u.period).toBeUndefined();
    expect(u.notes?.[0]).toContain("Valid week not carried");
    expect(usdmProvenance(at, "2026-09-09").period).toBe("2026-09-09");
    expect(usdmProvenance(at, "2026-09-09").notes).toBeUndefined();
    const s = sentinelProvenance("S2A_MSIL2A_20260905T170851_N0511_R112_T14RPU", "2026-09-05T17:08:51Z", at);
    expect(s.source.id).toBe("sentinel-2");
    expect(s.period).toBe("2026-09-05");
  });
  it("estimates carry kind and method", () => {
    const e = waterEstimateProvenance("twdb", "Σ(capacity × percent full) / Σ capacity", at);
    expect(e.kind).toBe("estimate");
    expect(e.source.id).toBe("twdb");
    expect(citation(e)).toContain("estimate computed by Embedding Atlas");
  });
});
