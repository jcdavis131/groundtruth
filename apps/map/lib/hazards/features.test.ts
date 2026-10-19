import { describe, expect, it } from "vitest";
import type { Polygon } from "geojson";
import {
  buildEonetVolcanoes,
  buildGdacs,
  buildNwsAlerts,
  buildWildfire,
  flagQuakesInUsgs,
  hideableQuake,
  leftToLiveWarnings,
  markLiveOutlined,
  mergeGdacs,
  modisClass,
  NWS_SEVERITIES,
  parseFirmsCsv,
  parseGdacsGeoJson,
  parseGdacsRss,
  selectFires,
  trimNwsAlert,
  type FireExtra,
  type GdacsEvent,
  type HazardAlertExtra,
} from "./features";
import { LIVE_SEVERITIES } from "@/lib/live/live";
import { ALERTS_URL } from "@/lib/live/fetch";

const square: Polygon = { type: "Polygon", coordinates: [[[-120, 40], [-119.9, 40], [-119.9, 40.1], [-120, 40]]] };

// ---------------------------------------------------------------- WFIGS

describe("buildWildfire", () => {
  const perimeter = (props: Record<string, unknown>) => ({
    geometry: square,
    properties: { poly_IRWINID: "{ABC}", attr_IncidentName: "Test", attr_IncidentTypeCategory: "WF", ...props },
  });

  it("gives a perimeter with no capture time no perimeter date, and does not borrow the edit time", () => {
    const edited = Date.parse("2026-09-18T00:00:00Z");
    const modified = Date.parse("2026-09-20T00:00:00Z");
    const { features } = buildWildfire([perimeter({ poly_PolygonDateTime: null, poly_DateCurrent: edited, attr_ModifiedOnDateTime_dt: modified })], []);
    const p = features[0].properties;
    const x = p.extra as FireExtra;
    expect(x.perimeterAt).toBeUndefined();
    expect(x.perimeterEditedAt).toBe(edited);
    expect(p.details?.["perimeter captured"]).toBe("not published by WFIGS");
    expect(p.details?.["perimeter record edited"]).toBe("2026-09-18 00:00Z");
    // No capture time, no "seen" time: the incident's modified time stays in its own row.
    expect(p.observedAt).toBeUndefined();
    expect(p.details?.["incident updated"]).toBe("2026-09-20 00:00Z");
  });

  it("dates a perimeter from its capture time when WFIGS publishes one", () => {
    const captured = Date.parse("2026-08-16T12:00:00Z");
    const { features } = buildWildfire([perimeter({ poly_PolygonDateTime: captured, poly_DateCurrent: Date.parse("2026-09-18T00:00:00Z") })], []);
    const p = features[0].properties;
    expect((p.extra as FireExtra).perimeterAt).toBe(captured);
    expect(p.details?.["perimeter captured"]).toBe("2026-08-16 12:00Z");
    expect(p.observedAt).toBe(captured);
  });

  it("says containment was not reported rather than 0, and drops the incident point a perimeter already carries", () => {
    const incidents = [
      { geometry: { type: "Point" as const, coordinates: [-119.95, 40.05] }, properties: { IrwinID: "{abc}", IncidentName: "Test", IncidentTypeCategory: "WF" } },
      { geometry: { type: "Point" as const, coordinates: [-110, 35] }, properties: { IrwinID: "{DEF}", IncidentName: "Other", IncidentTypeCategory: "RX", PercentContained: 40 } },
    ];
    const r = buildWildfire([perimeter({})], incidents);
    expect(r.perimeters).toBe(1);
    expect(r.points).toBe(1);
    const [perim, point] = r.features;
    expect(perim.properties.details?.contained).toBe("not reported");
    expect(perim.properties.anchor).toEqual([-119.95, 40.05]);
    expect(point.properties.kind).toBe("prescribed");
    expect(point.properties.details?.contained).toBe("40 %");
  });
});

// ---------------------------------------------------------------- FIRMS

const VIIRS_CSV = [
  "latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight",
  "1.0,1.0,330,0.4,0.4,2026-09-25,0142,N20,VIIRS,n,2.0NRT,290,5.0,N",
  "1.001,1.001,340,0.4,0.4,2026-09-25,0142,N20,VIIRS,h,2.0NRT,295,9.0,N",
  "1.0,1.002,320,0.4,0.4,2026-09-25,0142,N20,VIIRS,l,2.0NRT,280,,N",
  "8.0,8.0,310,0.4,0.4,2026-09-25,1830,N20,VIIRS,x,2.0NRT,280,1.0,D",
  "50.0,50.0,310,0.4,0.4,2026-09-25,1830,N20,VIIRS,n,2.0NRT,280,1.0,D",
  // A row with no latitude is skipped, not placed at 0.
  ",1.5,310,0.4,0.4,2026-09-25,1830,N20,VIIRS,n,2.0NRT,280,1.0,D",
  "",
].join("\n");

const MODIS_CSV = [
  "latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight",
  "5.0,5.0,320,1,1,2026-09-25,905,Terra,MODIS,85,6.1NRT,300,12.5,D",
  "5.5,5.5,320,1,1,2026-09-25,905,Aqua,MODIS,,6.1NRT,300,3,D",
].join("\n");

describe("parseFirmsCsv / selectFires", () => {
  const viirs = parseFirmsCsv(VIIRS_CSV, "VIIRS", "VIIRS 375 m NOAA-20");
  const modis = parseFirmsCsv(MODIS_CSV, "MODIS", "MODIS 1 km C6.1");

  it("reads rows into typed arrays with UTC acquisition times and blank FRP as NaN", () => {
    expect(viirs.n).toBe(5);
    expect(viirs.version).toBe("2.0NRT");
    expect(viirs.t[0]).toBe(Date.parse("2026-09-25T01:42:00Z"));
    expect(Number.isNaN(viirs.frp[2])).toBe(true);
    // "905" is 09:05, padded as FIRMS writes HHMM without a leading zero.
    expect(modis.t[0]).toBe(Date.parse("2026-09-25T09:05:00Z"));
  });

  it("keeps each instrument's confidence on its own scale and never invents one", () => {
    const rows = selectFires([viirs, modis], [-180, -90, 180, 90], 5000).rows;
    const conf = (lon: number) => rows.find((r) => r[0] === lon)?.[6];
    expect(conf(1.001)).toBe("high");
    expect(conf(1.002)).toBe("low");
    // An unknown VIIRS code is blank, not a guess.
    expect(conf(8)).toBeNull();
    // MODIS stays a percentage; the class is for colour only.
    expect(conf(5)).toBe(85);
    expect(modisClass(85)).toBe("high");
    expect(conf(5.5)).toBeNull();
  });

  it("cuts to the box and, over the budget, keeps the brightest detection per cell with its count", () => {
    const box: [number, number, number, number] = [0, 0, 10, 10];
    const all = selectFires([viirs], box, 5000);
    expect(all.total).toBe(4);
    expect(all.cellDeg).toBeNull();
    const binned = selectFires([viirs], box, 2);
    expect(binned.total).toBe(4);
    expect(binned.rows).toHaveLength(2);
    expect(binned.cellDeg).not.toBeNull();
    const cluster = binned.rows.find((r) => r[8] === 3)!;
    // The 9 MW detection stands for the cell; a blank FRP never beats a reading.
    expect(cluster[2]).toBe(9);
    expect(binned.rows.find((r) => r[0] === 8)?.[8]).toBe(1);
  });
});

// ---------------------------------------------------------------- NWS

const nwsFeature = (props: Record<string, unknown>, geometry: Polygon | null = null) => ({
  id: "https://api.weather.gov/alerts/urn:1",
  geometry,
  properties: { id: "urn:1", event: "Flood Watch", severity: "Moderate", messageType: "Alert", ...props },
});

describe("NWS alerts", () => {
  it("skips cancellations", () => {
    expect(trimNwsAlert(nwsFeature({ messageType: "Cancel" }))).toBeNull();
    expect(trimNwsAlert(nwsFeature({ messageType: "Update" }))).not.toBeNull();
  });

  it("slices SAME codes to county GEOIDs and draws a polygon-less alert as those counties, saying so", () => {
    const a = trimNwsAlert(nwsFeature({ geocode: { SAME: ["048029", "048091", "0480"], UGC: ["TXZ205", "TXZ206"] } }))!;
    expect(a.counties).toEqual(["48029", "48091"]);
    expect(a.zones).toBe(2);
    const counties = new Map([["48029", { name: "Bexar", geometry: square }]]);
    const r = buildNwsAlerts([a], counties);
    expect(r.drawnCounties).toBe(1);
    const x = r.features[0].properties.extra as HazardAlertExtra;
    expect(x.drawnAs).toBe("counties");
    expect(r.features[0].properties.details?.["area drawn as"]).toMatch(/^the 1 county the alert lists \(SAME codes\)/);
    expect(r.features[0].properties.details?.counties).toBe("Bexar");
  });

  it("counts an alert with no polygon and no known county as undrawn instead of placing it", () => {
    const a = trimNwsAlert(nwsFeature({ geocode: { SAME: ["057000"] } }))!;
    const r = buildNwsAlerts([a], new Map());
    expect(r.features).toHaveLength(0);
    expect(r.undrawn).toBe(1);
  });

  it("marks an alert NWS rated Unknown as not rated by source, never as a level", () => {
    const a = trimNwsAlert(nwsFeature({ severity: "Unknown" }, square))!;
    const f = buildNwsAlerts([a], new Map()).features[0];
    expect((f.properties.extra as HazardAlertExtra).severity).toBeUndefined();
    expect(f.properties.details?.severity).toBe("not rated by source (NWS: Unknown)");
    expect((f.properties.extra as HazardAlertExtra).drawnAs).toBe("polygon");
  });
});

describe("leaving Severe and Extreme NWS alerts to Live warnings", () => {
  const nws = (severity?: string, marked = true): HazardAlertExtra => ({ source: "NWS", severity, event: "x", drawnAs: "polygon", nwsId: "a", liveOutlined: marked ? true : undefined });

  it("partitions the NWS severities (and unrated) exactly along the live feed's own query", () => {
    for (const s of LIVE_SEVERITIES) expect(NWS_SEVERITIES).toContain(s);
    const left = NWS_SEVERITIES.filter((s) => leftToLiveWarnings(nws(s)));
    const kept = NWS_SEVERITIES.filter((s) => !leftToLiveWarnings(nws(s)));
    expect(new Set(left)).toEqual(new Set(LIVE_SEVERITIES));
    expect(kept).toEqual(["Moderate", "Minor"]);
    expect(leftToLiveWarnings(nws(undefined))).toBe(false);
    expect(ALERTS_URL).toContain(`severity=${LIVE_SEVERITIES.join(",")}`);
  });

  it("never leaves an alert the live feed did not outline (unmapped, or the feed failed)", () => {
    for (const s of LIVE_SEVERITIES) expect(leftToLiveWarnings(nws(s, false))).toBe(false);
  });

  it("marks, on copies, only the alerts the live feed outlined, and nothing when that feed is unknown", () => {
    const a = trimNwsAlert(nwsFeature({ id: "urn:t1", severity: "Extreme" }, square))!;
    const b = trimNwsAlert(nwsFeature({ id: "urn:t2", severity: "Severe" }, square))!;
    const built = buildNwsAlerts([a, b], new Map()).features;
    expect((built[0].properties.extra as HazardAlertExtra).nwsId).toBe("urn:t1");
    const r = markLiveOutlined(built, new Set(["urn:t1"]));
    expect(r.marked).toBe(1);
    expect((r.features[0].properties.extra as HazardAlertExtra).liveOutlined).toBe(true);
    expect(r.features[0].properties.details?.["also on Live warnings"]).toMatch(/^yes/);
    expect((r.features[1].properties.extra as HazardAlertExtra).liveOutlined).toBeUndefined();
    // The cached features are not mutated.
    expect((built[0].properties.extra as HazardAlertExtra).liveOutlined).toBeUndefined();
    expect(built[0].properties.details?.["also on Live warnings"]).toBeUndefined();
    expect(markLiveOutlined(built, null)).toEqual({ features: built, marked: 0 });
    // A GDACS event is never marked, whatever its id.
    const g = buildGdacs([{ eventtype: "FL", eventid: "urn:t1", lon: 0, lat: 0 }]);
    expect(markLiveOutlined(g, new Set(["urn:t1"])).marked).toBe(0);
  });

  it("never leaves a GDACS or EONET event", () => {
    expect(leftToLiveWarnings({ source: "GDACS", severity: "Red", event: "flood", drawnAs: "point" })).toBe(false);
    expect(leftToLiveWarnings({ source: "EONET", event: "volcano", drawnAs: "point" })).toBe(false);
    expect(leftToLiveWarnings(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------- GDACS

const rssItem = (id: string, current: string | null, level = "Green", type = "FL") =>
  `<item><title>${level} ${type} ${id}</title>${current == null ? "" : `<gdacs:iscurrent>${current}</gdacs:iscurrent>`}` +
  `<gdacs:eventtype>${type}</gdacs:eventtype><gdacs:eventid>${id}</gdacs:eventid><gdacs:alertlevel>${level}</gdacs:alertlevel>` +
  `<gdacs:datemodified>Fri, 25 Sep 2026 06:00:00 GMT</gdacs:datemodified><geo:Point><geo:lat>10</geo:lat><geo:long>20</geo:long></geo:Point></item>`;

describe("GDACS", () => {
  it("keeps only RSS items marked iscurrent=true (an item that does not say is not assumed current)", () => {
    const xml = `<rss><channel>${rssItem("1", "true")}${rssItem("2", "false", "Orange", "DR")}${rssItem("3", null)}</channel></rss>`;
    expect(parseGdacsRss(xml).map((e) => e.eventid)).toEqual(["1"]);
  });

  it("filters the GeoJSON lists on iscurrent and reports the rows a truncation check needs", () => {
    const f = (id: number, iscurrent: string | boolean) => ({
      geometry: { type: "Point" as const, coordinates: [83.7, 18.1] },
      properties: { eventtype: "TC", eventid: id, iscurrent, alertlevel: "Orange" },
    });
    const r = parseGdacsGeoJson({ features: [f(1001326, "true"), f(1001305, "false"), f(7, true)] });
    expect(r.rows).toBe(3);
    expect(r.events.map((e) => e.eventid)).toEqual(["1001326", "7"]);
  });

  it("merges to one record per event: the most recently modified wins, a tie keeps the earlier list", () => {
    const ev = (id: string, modified: string, level: string): GdacsEvent => ({ eventtype: "TC", eventid: id, datemodified: modified, alertlevel: level, lon: 0, lat: 0 });
    const merged = mergeGdacs([
      [ev("1", "Fri, 25 Sep 2026 06:00:00 GMT", "Green"), ev("2", "2026-09-25T06:00:00", "Green")],
      [ev("1", "2026-09-25T07:00:00", "Orange"), ev("2", "2026-09-25T06:00:00", "Red")],
    ]);
    expect(merged).toHaveLength(2);
    expect(merged.find((e) => e.eventid === "1")?.alertlevel).toBe("Orange");
    expect(merged.find((e) => e.eventid === "2")?.alertlevel).toBe("Green");
  });

  it("flags quakes USGS also has within 100 km and 30 min, and only Green ones are hideable", () => {
    const t = "2026-09-25T21:23:03";
    const q = (id: string, level: string, fromdate: string = t): GdacsEvent => ({ eventtype: "EQ", eventid: id, alertlevel: level, fromdate, lon: 168.0, lat: -17.7 });
    const usgs = [{ lon: 168.3, lat: -17.6, t: Date.parse(`${t}Z`) + 5 * 60_000 }];
    const { events, flagged } = flagQuakesInUsgs([q("1", "Green"), q("2", "Orange"), { ...q("3", "Green"), fromdate: undefined }, q("4", "Green", "2026-09-24T21:23:03")], usgs);
    expect(flagged).toBe(2);
    const built = buildGdacs(events);
    const extra = (id: string) => built.find((f) => f.properties.id === `gdacs:EQ${id}`)!.properties.extra as HazardAlertExtra;
    expect(hideableQuake(extra("1"))).toBe(true);
    expect(hideableQuake(extra("2"))).toBe(false);
    // A quake with no time is never called a duplicate; a day apart is not the same quake.
    expect(extra("3").alsoInUsgs).toBeUndefined();
    expect(extra("4").alsoInUsgs).toBeUndefined();
  });

  it("keeps GDACS's own level words and marks anything else as not rated", () => {
    const [red, odd] = buildGdacs([
      { eventtype: "FL", eventid: "9", alertlevel: "RED", lon: 1, lat: 2 },
      { eventtype: "XX", eventid: "10", alertlevel: "Purple", lon: 1, lat: 2 },
    ]);
    expect((red.properties.extra as HazardAlertExtra).severity).toBe("Red");
    expect(red.properties.kind).toBe("gdacs-fl");
    expect((odd.properties.extra as HazardAlertExtra).severity).toBeUndefined();
    expect(odd.properties.details?.["GDACS alert level"]).toBe("not rated by source (Purple)");
  });
});

// ---------------------------------------------------------------- EONET

describe("buildEonetVolcanoes", () => {
  it("places a volcano at its latest report and says EONET rates nothing", () => {
    const [f] = buildEonetVolcanoes([
      {
        id: "EONET_1",
        title: "Etna",
        geometry: [
          { date: "2026-09-01T00:00:00Z", type: "Point", coordinates: [15.0, 37.7] },
          { date: "2026-09-20T00:00:00Z", type: "Point", coordinates: [15.1, 37.75] },
        ],
      },
      { id: "EONET_2", title: "No geometry" },
    ]);
    expect(f.geometry.coordinates).toEqual([15.1, 37.75, 0]);
    expect(f.properties.details?.reports).toBe(2);
    expect(f.properties.details?.severity).toMatch(/^not rated by source/);
    expect((f.properties.extra as HazardAlertExtra).severity).toBeUndefined();
  });
});
