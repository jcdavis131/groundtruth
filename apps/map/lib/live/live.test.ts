import { describe, expect, it } from "vitest";
import { alertRank, hazardFamily, liveAlertId, liveDrawnIds, liveDraws, liveItems, parseAlerts, parseQuakes, quakeRank, thinRing, type AlertItem } from "./live";
import { alertFeature } from "@/lib/layers/alerts";
import { lifeLeft } from "@/lib/globe/alertStyles";
import { frameHeight } from "./teleportStore";
import { isPhysical } from "@/lib/fabric/emergence";
import { joinInside } from "@/lib/fabric/join";
import type { LayerFeature } from "@/lib/layers/types";

const NOW = Date.parse("2026-09-23T12:00:00Z");
const box = [[[-91, 39], [-90, 39], [-90, 40], [-91, 40], [-91, 39]]];

const alert = (id: string, props: Record<string, unknown>, geometry: { type: string; coordinates: unknown } | null = { type: "Polygon", coordinates: box }) => ({
  id: `https://api.weather.gov/alerts/${id}`,
  geometry,
  properties: {
    id,
    event: "Flood Warning",
    severity: "Severe",
    urgency: "Immediate",
    certainty: "Observed",
    headline: "Flood Warning issued",
    areaDesc: "Calhoun, IL; Lincoln, MO",
    senderName: "NWS St Louis MO",
    onset: "2026-09-23T10:00:00Z",
    expires: "2026-09-24T10:00:00Z",
    status: "Actual",
    messageType: "Alert",
    affectedZones: ["https://api.weather.gov/zones/county/ILC013"],
    ...props,
  },
});

describe("NWS alerts as live constructs", () => {
  it("keeps actual alerts, with the polygon the forecaster drew", () => {
    const a = parseAlerts({
      features: [alert("a1", {}), alert("a2", { status: "Test" }), alert("a3", { messageType: "Cancel" }), alert("a4", { event: "Coastal Flood Warning" }, null)],
    });
    expect(a.map((x) => x.id)).toEqual(["a1", "a4"]);
    expect(a[0]).toMatchObject({ family: "flood", outline: "polygon", sender: "NWS St Louis MO", url: "https://api.weather.gov/alerts/a1" });
    expect(a[0].rings).toEqual(box);
    // No polygon: waits for its zones to be outlined.
    expect(a[1]).toMatchObject({ family: "coastal", rings: null, outline: null, zones: ["https://api.weather.gov/zones/county/ILC013"] });
  });

  it("sorts events into hazard families by their words", () => {
    expect(["Tornado Warning", "Flash Flood Warning", "Severe Thunderstorm Warning", "Red Flag Warning", "High Wind Warning", "Winter Storm Warning", "Excessive Heat Warning", "Gale Warning", "Storm Surge Warning", "Dense Fog Advisory"].map(hazardFamily)).toEqual([
      "tornado",
      "flood",
      "storm",
      "fire",
      "wind",
      "winter",
      "heat",
      "marine",
      "coastal",
      "other",
    ]);
  });

  it("becomes a hazard construct that joins the physical layers but is not one", () => {
    const [a] = parseAlerts({ features: [alert("a1", {})] });
    const f = alertFeature(a)!;
    expect(f.properties).toMatchObject({ id: "nws-alert:a1", layer: "alerts", name: "Flood Warning", kind: "flood" });
    const node = (f.properties.extra as { node: { kind: string; domain: string; areaKm2: number } }).node;
    expect(node).toMatchObject({ kind: "nws-alert", domain: "hazard" });
    expect(node.areaKm2).toBeGreaterThan(9000);
    expect(isPhysical(f)).toBe(false);
    const gauge = { type: "Feature", geometry: { type: "Point", coordinates: [-90.5, 39.5, 0] }, properties: { id: "g", layer: "water", name: "g", source: "t" } } as unknown as LayerFeature;
    const joined = joinInside(box, [gauge, f]);
    expect([...joined.keys()]).toEqual(["water"]);
    expect(alertFeature({ ...a, rings: null })).toBeNull();
  });

  it("says which alerts the layer draws with the same test alertFeature makes", () => {
    const [a] = parseAlerts({ features: [alert("a1", {})] });
    const cases: AlertItem[] = [a, { ...a, rings: null }, { ...a, rings: [] }, { ...a, rings: [[]] }];
    for (const c of cases) expect(liveDraws(c), JSON.stringify(c.rings)).toBe(!!alertFeature(c));
    expect(alertFeature(a)!.properties.id).toBe(liveAlertId(a.id));
  });

  it("lists the ids a feed answer draws, and none known when its NWS request failed", () => {
    const [drawn, zoneOnly] = parseAlerts({ features: [alert("a1", {}), alert("a2", {}, null)] });
    expect(liveDrawnIds({ alerts: [drawn, zoneOnly], failed: [] })).toEqual(new Set(["a1"]));
    // Only the quakes failed: the alerts are still known.
    expect(liveDrawnIds({ alerts: [drawn], failed: [{ source: "usgs-earthquakes" }] })).toEqual(new Set(["a1"]));
    expect(liveDrawnIds({ alerts: [], failed: [{ source: "nws-api" }] })).toBeNull();
  });

  it("fades as it runs out", () => {
    expect(lifeLeft(null, NOW)).toBe(1);
    expect(lifeLeft(NOW + 5 * 3600_000, NOW)).toBe(1);
    expect(lifeLeft(NOW + 1800_000, NOW)).toBe(0.5);
    expect(lifeLeft(NOW - 1, NOW)).toBe(0.25);
  });

  it("thins a dense zone outline but keeps its ends", () => {
    const ring = Array.from({ length: 101 }, (_, i) => [i * 0.001, 0]);
    const thin = thinRing(ring, 0.01);
    expect(thin.length).toBe(11);
    expect(thin[0]).toEqual(ring[0]);
    expect(thin[thin.length - 1]).toEqual(ring[100]);
  });
});

describe("the teleport order", () => {
  const q = { features: [{ id: "us1", geometry: { coordinates: [142, 38, 10] }, properties: { mag: 7.1, place: "off Honshu", time: NOW - 3600_000, tsunami: 1, alert: "yellow", url: "u" } }, { id: "bad", properties: { mag: null } }] };

  it("reads the quake feed and scores quakes on the alert scale", () => {
    const quakes = parseQuakes(q);
    expect(quakes).toHaveLength(1);
    expect(quakes[0]).toMatchObject({ mag: 7.1, lon: 142, lat: 38, depthKm: 10, tsunami: true, alert: "yellow" });
    expect(quakeRank({ mag: 4.5, alert: null, tsunami: false })).toBeCloseTo(1.3);
    expect(quakeRank(quakes[0])).toBeGreaterThan(alertRank({ severity: "Extreme", urgency: "Immediate", certainty: "Observed" }));
  });

  it("puts extreme and immediate first, and in force now before later", () => {
    const alerts: AlertItem[] = parseAlerts({
      features: [
        alert("later", { onset: "2026-09-25T12:00:00Z", severity: "Extreme" }),
        alert("now", { severity: "Extreme" }),
        alert("watch", { event: "Flood Watch", urgency: "Future", certainty: "Possible" }),
        alert("unmapped", {}, null),
      ],
    });
    const items = liveItems(alerts, parseQuakes(q), NOW);
    expect(items.map((i) => i.id)).toEqual(["us1", "nws-alert:now", "nws-alert:later", "nws-alert:watch"]);
    const now = items[1];
    expect(now).toMatchObject({ kind: "alert", title: "Flood Warning", family: "flood", bbox: [-91, 39, -90, 40] });
    expect(now.until).toBe(Date.parse("2026-09-24T10:00:00Z"));
    // Frame the warning's extent; a point gets a fixed height.
    expect(frameHeight(now)).toBeGreaterThan(150_000);
    expect(frameHeight(now)).toBeLessThan(250_000);
    expect(frameHeight(items[0])).toBe(700_000);
  });
});
