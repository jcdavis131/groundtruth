// /api/hazards?op=alerts with its upstreams replaced by fixtures: which NWS
// alerts are marked liveOutlined (the live feed behind Live warnings drew
// them), and that a live feed that failed or did not answer marks none. No
// network.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Polygon } from "geojson";
import type { NwsAlert } from "@/lib/hazards/features";
import type { LiveFeed } from "@/lib/live/fetch";
import type { AlertItem } from "@/lib/live/live";

const square: Polygon = { type: "Polygon", coordinates: [[[-98, 30], [-97, 30], [-97, 31], [-98, 31], [-98, 30]]] };

const nwsAlert = (id: string, severity: string): NwsAlert => ({ id, event: "Flash Flood Warning", severity, counties: [], zones: 1, geometry: square });

const liveAlert = (id: string, rings: number[][][] | null): AlertItem => ({
  id,
  event: "Flash Flood Warning",
  family: "flood",
  severity: "Severe",
  urgency: "Immediate",
  certainty: "Observed",
  headline: "",
  areaDesc: "",
  sender: "NWS",
  onset: null,
  expires: null,
  ends: null,
  rings,
  outline: rings ? "polygon" : null,
  zones: [],
  url: `https://api.weather.gov/alerts/${id}`,
});

const fixtures: { nws: NwsAlert[]; live: (() => Promise<{ value: LiveFeed; age: number; hit: boolean }>) | null } = { nws: [], live: null };

vi.mock("@/lib/server/cache", () => ({
  // No route-level memo in tests: every GET assembles its answer again.
  cached: async <T,>(_k: string, _ttl: number, produce: () => Promise<T>) => ({ value: await produce(), age: 0, hit: false }),
}));

vi.mock("@/lib/hazards/sources", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/hazards/sources")>()),
  nwsAlerts: async () => ({ value: fixtures.nws, age: 0, hit: false }),
  countiesByGeoid: async () => new Map(),
  gdacs: async () => ({ value: { events: [], via: ["RSS"], failed: [], counts: {}, truncated: false }, age: 0, hit: false }),
  eonetVolcanoes: async () => ({ value: [], age: 0, hit: false }),
  usgsDay: async () => ({ quakes: [], age: 0 }),
}));

vi.mock("@/lib/live/fetch", () => ({
  ALERTS_URL: "https://api.weather.gov/alerts/active?status=actual&severity=Extreme,Severe",
  liveFeed: () => (fixtures.live ? fixtures.live() : Promise.reject(new Error("no live fixture"))),
}));

import { GET } from "./route";

interface Answer {
  data: { features: Array<{ properties: { id: string; extra: { liveOutlined?: boolean }; details: Record<string, unknown> } }> };
  counts: { nws: { liveChecked: boolean; liveOutlined: number; liveCacheAge: number | null } };
  caveats: string[];
  provenance: Array<{ notes?: string[] }>;
}

async function alerts(): Promise<Answer> {
  const res = await GET(new NextRequest("http://localhost/api/hazards?op=alerts"));
  expect(res.status).toBe(200);
  return (await res.json()) as Answer;
}

const marked = (a: Answer) => a.data.features.filter((f) => f.properties.extra.liveOutlined).map((f) => f.properties.id);

describe("/api/hazards?op=alerts marking what Live warnings draws", () => {
  beforeEach(() => {
    fixtures.nws = [nwsAlert("urn:polygon", "Extreme"), nwsAlert("urn:zone-only", "Severe"), nwsAlert("urn:moderate", "Moderate")];
  });

  it("marks only the alerts the live feed outlined; an unmapped one stays unmarked", async () => {
    const rings = square.coordinates;
    fixtures.live = async () => ({ value: { alerts: [liveAlert("urn:polygon", rings), liveAlert("urn:zone-only", null)], quakes: [], items: [], failed: [], unmapped: 1 }, age: 30_000, hit: true });
    const a = await alerts();
    expect(marked(a)).toEqual(["nws:urn:polygon"]);
    expect(a.counts.nws).toMatchObject({ liveChecked: true, liveOutlined: 1, liveCacheAge: 30_000 });
    expect(a.data.features.find((f) => f.properties.id === "nws:urn:polygon")?.properties.details["also on Live warnings"]).toMatch(/^yes/);
    expect(a.provenance.some((p) => p.notes?.some((n) => /used only to mark/.test(n)))).toBe(true);
    // Nothing is dropped on the server.
    expect(a.data.features).toHaveLength(3);
  });

  it("marks nothing when the live feed's NWS request failed", async () => {
    fixtures.live = async () => ({ value: { alerts: [], quakes: [], items: [], failed: [{ source: "nws-api", error: "HTTP 503" }], unmapped: 0 }, age: 0, hit: false });
    const a = await alerts();
    expect(marked(a)).toEqual([]);
    expect(a.counts.nws).toMatchObject({ liveChecked: false, liveOutlined: 0, liveCacheAge: null });
    expect(a.caveats.some((c) => /no alert is marked liveOutlined/.test(c))).toBe(true);
  });

  it("marks nothing when the live feed does not answer in time", async () => {
    fixtures.live = () => Promise.reject(new Error("live: no answer within 20 s"));
    const a = await alerts();
    expect(marked(a)).toEqual([]);
    expect(a.counts.nws.liveChecked).toBe(false);
    expect(a.data.features).toHaveLength(3);
  });
});
