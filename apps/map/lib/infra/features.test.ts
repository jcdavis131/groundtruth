// Builders for the infrastructure and geohazard layers, run on payloads
// captured from each service on 2026-09-26 (trimmed to a few features, their
// values untouched): HIFLD transmission lines around Austin, EIA pipelines
// around San Antonio and Houston, the FRA rail network and the USACE NID
// around San Antonio, FAA public-use airports south-west of San Antonio,
// USGS Quaternary faults in the Bay Area, USGS landslides in the East Bay,
// and the BLM PLSS grid in Oklahoma City.

import { describe, expect, it } from "vitest";
import type { LayerFeature } from "@/lib/layers/types";
import { searchableDetail } from "@/lib/search/allowlist";
import {
  buildAirports,
  buildDams,
  buildFaults,
  buildLandslides,
  buildPipelines,
  buildPlss,
  buildRail,
  buildTransmission,
  faultAgeClass,
  finite,
  str,
  voltBand,
  type Row,
  type TransmissionExtra,
} from "./features";
import transmission from "./fixtures/transmission-austin.json";
import rail from "./fixtures/rail-sanantonio.json";
import natgas from "./fixtures/pipelines-natgas-sanantonio.json";
import crude from "./fixtures/pipelines-crude-houston.json";
import airports from "./fixtures/airports-texas.json";
import dams from "./fixtures/dams-sanantonio.json";
import faults from "./fixtures/faults-bayarea.json";
import landslides from "./fixtures/landslides-eastbay.json";
import sections from "./fixtures/plss-sections-okc.json";
import townships from "./fixtures/plss-townships-okc.json";

const rows = (fc: { features: unknown[] }) => fc.features as Row[];

/** No owner, operator or railroad name may reach a feature's name (search always reads names). */
function operatorsStayOutOfNames(features: LayerFeature[], keys: string[]) {
  for (const f of features) {
    for (const k of keys) {
      const v = f.properties.details?.[k];
      if (typeof v === "string" && v.length > 3) expect(f.properties.name.toLowerCase(), `${f.properties.id} ${k}`).not.toContain(v.toLowerCase());
      expect(searchableDetail(k), k).toBe(false);
    }
  }
}

describe("value helpers", () => {
  it("never turns a missing value into 0", () => {
    expect(finite(null)).toBeUndefined();
    expect(finite("")).toBeUndefined();
    expect(finite("  ")).toBeUndefined();
    expect(finite(0)).toBe(0);
    expect(finite(-999999, 0)).toBeUndefined();
  });
  it("drops the publishers' not-available words", () => {
    expect(str("NOT AVAILABLE")).toBeUndefined();
    expect(str(" ")).toBeUndefined();
    expect(str("Unknown", ["UNKNOWN"])).toBeUndefined();
    expect(str("PILOT KNOB")).toBe("PILOT KNOB");
  });
});

describe("HIFLD transmission lines", () => {
  const out = buildTransmission(rows(transmission) as never);
  it("builds a line for every feature with a line geometry", () => {
    expect(out).toHaveLength(transmission.features.length);
    expect(out.every((f) => f.geometry.type === "LineString" || f.geometry.type === "MultiLineString")).toBe(true);
  });
  it("names a line by its published voltage", () => {
    const a = out[0];
    expect(a.properties.name).toBe("138 kV line");
    expect((a.properties.extra as TransmissionExtra).band).toBe("100-161");
    expect(a.properties.details?.["from substation"]).toBe("PILOT KNOB");
  });
  it("drops HIFLD's -999999 voltage and placeholder substations instead of showing them", () => {
    const missing = out.find((f) => (f.properties.extra as TransmissionExtra).kv == null)!;
    expect(missing).toBeDefined();
    expect(missing.properties.details?.voltage).toBe("not published");
    expect(missing.properties.name).not.toContain("-999999");
    for (const f of out) {
      expect(f.properties.details?.["to substation"]).not.toBe("NOT AVAILABLE");
      expect(String(f.properties.details?.["from substation"] ?? "")).not.toMatch(/^UNKNOWN\d/);
    }
  });
  it("keeps the owner in the dossier only", () => {
    expect(out[0].properties.details?.owner).toBe("ONCOR ELECTRIC DELIVERY CO.");
    operatorsStayOutOfNames(out, ["owner"]);
  });
  it("bands a line by kV, falling back to the published class", () => {
    expect(voltBand(345, "345", "AC; OVERHEAD")).toBe("345");
    expect(voltBand(undefined, "735 AND ABOVE", "OVERHEAD")).toBe("765");
    expect(voltBand(undefined, "SUB 100", "OVERHEAD")).toBe("under-100");
    expect(voltBand(500, "500", "DC; OVERHEAD")).toBe("dc");
    expect(voltBand(undefined, undefined, "NOT AVAILABLE")).toBe("unknown");
  });
});

describe("EIA pipelines", () => {
  it("names a natural gas line by its type, with the operator in the dossier", () => {
    const out = buildPipelines("natgas", rows(natgas));
    expect(out[0].properties.name).toBe("Natural gas pipeline · intrastate");
    expect(out[0].properties.details?.operator).toBe("El Paso Texas Pipeline Co");
    expect(out[0].properties.kind).toBe("natgas");
    operatorsStayOutOfNames(out, ["operator"]);
  });
  it("names a liquids line by the system name EIA publishes", () => {
    const out = buildPipelines("crude", rows(crude));
    expect(out[0].properties.name).toBe("Longhorn (crude oil)");
    expect(out[0].properties.details?.operator).toBe("MAGELLAN MIDSTREAM PARTNERS");
    operatorsStayOutOfNames(out, ["operator"]);
  });
});

describe("FRA rail network", () => {
  const out = buildRail(rows(rail));
  it("decodes the network code with the service's own domain", () => {
    const main = out.find((f) => f.properties.kind === "main")!;
    expect(main.properties.details?.network).toBe("Main sub network (M)");
    const yard = out.find((f) => f.properties.details?.network === "Yard Tracks (Y)");
    expect(yard?.properties.kind).toBe("yard");
  });
  it("marks out-of-service and abandoned track as inactive", () => {
    const inactive = out.filter((f) => f.properties.kind === "inactive").map((f) => f.properties.details?.network);
    expect(inactive).toEqual(expect.arrayContaining(["Out of service line (X)", "Abandoned rail line (A)"]));
  });
  it("labels Amtrak service from the passenger code", () => {
    const amtrak = out.find((f) => f.properties.details?.["passenger service"] === "Amtrak");
    expect(amtrak?.properties.kind).toBe("passenger");
  });
  it("names a line by its subdivision or yard, never by the railroad", () => {
    expect(out[0].properties.name).toBe("CORPUS CHRISTI subdivision");
    expect(out.some((f) => f.properties.name === "ALAMO JUNCTION RAIL PARK YARD")).toBe(true);
    expect(out[0].properties.details?.["owning railroads (reporting marks)"]).toBe("UP");
    operatorsStayOutOfNames(out, ["owning railroads (reporting marks)", "trackage rights"]);
  });
});

describe("FAA airports", () => {
  it("keeps public-use facilities only", () => {
    const out = buildAirports(rows(airports));
    expect(out).toHaveLength(airports.features.length);
    expect(out[0].properties.name).toBe("Devine Muni (23R)");
    expect(out[0].properties.details?.["FAA location id"]).toBe("23R");
    expect(out[0].properties.details?.use).toBe("public use");
    // The same real row marked private use is dropped, not shown.
    const priv = JSON.parse(JSON.stringify(airports.features[0]));
    priv.properties.PRIVATEUSE = 1;
    expect(buildAirports([priv])).toHaveLength(0);
    // A row with no PRIVATEUSE at all is not assumed public.
    delete priv.properties.PRIVATEUSE;
    expect(buildAirports([priv])).toHaveLength(0);
  });
});

describe("USACE National Inventory of Dams", () => {
  const out = buildDams(rows(dams));
  it("relays hazard potential, condition and size as published", () => {
    const braunig = out.find((f) => f.properties.name === "Victor Braunig Dam")!;
    expect(braunig.properties.id).toBe("nid:TX01432");
    expect(braunig.properties.details?.["hazard potential"]).toBe("High");
    expect(braunig.properties.details?.["condition assessment"]).toBe("Satisfactory");
    expect(braunig.properties.details?.["NID height"]).toBe("76 ft");
    expect(braunig.properties.details?.["NID storage"]).toBe("32,324 acre-ft");
    expect(braunig.properties.details?.["owner type"]).toBe("Local Government");
  });
  it("never carries an owner, designer or representative name", () => {
    for (const f of out) {
      const keys = Object.keys(f.properties.details ?? {}).map((k) => k.toLowerCase());
      for (const k of keys) expect(k).not.toMatch(/owner name|designer|representative|other names|former names/);
    }
  });
  it("labels a privately owned dam by its NID id; its name is in the record but not the label", () => {
    const blueWing = out.find((f) => f.properties.id === "nid:TX01456")!;
    expect(blueWing.properties.name).toBe("Dam TX01456");
    expect(blueWing.properties.details?.["published name"]).toBe("Blue Wing Lake Dam");
    expect(searchableDetail("published name")).toBe(false);
    expect(out.find((f) => f.properties.id === "nid:TX01432")!.properties.details?.["published name"]).toBeUndefined();
  });
  it("says 'not rated by source' when NID publishes no hazard class", () => {
    const row = JSON.parse(JSON.stringify(dams.features[0]));
    row.properties.HAZARD_POTENTIAL = null;
    const [f] = buildDams([row]);
    expect(f.properties.details?.["hazard potential"]).toBe("not rated by source");
    expect(f.properties.kind).toBe("not rated");
  });
});

describe("USGS Quaternary faults", () => {
  it("classes a fault by USGS's own age legend, unspecified never as the oldest", () => {
    expect(faultAgeClass("historic")).toBe("historic");
    expect(faultAgeClass("latest Quaternary")).toBe("latest");
    expect(faultAgeClass("Late Quaternary")).toBe("late");
    expect(faultAgeClass("middle and late Quaternary")).toBe("middle-late");
    expect(faultAgeClass("undifferentiated Quaternary")).toBe("undifferentiated");
    expect(faultAgeClass("class B")).toBe("unspecified");
    expect(faultAgeClass(undefined)).toBe("unspecified");
  });
  it("names a fault by its fault and section", () => {
    const out = buildFaults(rows(faults));
    expect(out[0].properties.name).toBe("San Andreas fault zone, Peninsula section");
    expect(out[0].properties.details?.["age of most recent deformation"]).toBe("historic · Historic (< 150 years)");
    expect(out[0].properties.details?.["USGS fault report"]).toContain("fault_id=1&section_id=c");
  });
});

describe("USGS landslide inventory", () => {
  const out = buildLandslides(rows(landslides));
  it("gives the date range the inventory publishes", () => {
    expect(out[0].properties.details?.date).toBe("between 2017-01-01 and 2017-03-11");
    expect(out[0].properties.name).toBe("Landslide · shallow landslide");
  });
  it("shows the confidence on USGS's scale without inventing a label for it", () => {
    expect(String(out[0].properties.details?.confidence)).toMatch(/^8 \(USGS's confidence/);
  });
  it("never relays the inventory's free-text Notes, which can name homeowners and give addresses", () => {
    const withNotes = rows(landslides).map((r) => ({ ...r, properties: { ...r.properties, Notes: "Originated from the backyard of residence of A. Person at 123 Example Road" } }));
    const built = buildLandslides(withNotes);
    expect(built.length).toBe(out.length);
    for (const f of built) expect(f.properties.details?.notes).toBeUndefined();
    expect(JSON.stringify(built)).not.toMatch(/residence|Example Road/);
    // The captured payload is what the route now asks for: no Notes field at all.
    for (const r of rows(landslides)) expect(Object.keys(r.properties)).not.toContain("Notes");
  });
});

describe("BLM PLSS", () => {
  it("labels townships and sections with BLM's own labels", () => {
    const t = buildPlss("township", rows(townships));
    expect(t[0].properties.name).toBe("T12N R4W · OK");
    expect(t[0].properties.details?.["principal meridian"]).toBe("Indian Meridian");
    const s = buildPlss("section", rows(sections));
    expect(s[0].properties.name).toBe("Section 24");
    expect(s[0].properties.details?.["first division id"]).toBe("OK170120N0040W0SN240");
  });
});
