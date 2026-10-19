import { describe, expect, it } from "vitest";
import { adsbPointUrl, callsignPrefix, CARGO_HUBS, cargoFlightsCollector, countAircraft, hubOutputs } from "./cargoFlights";
import type { CollectorContext } from "./types";

const NOW = Date.UTC(2026, 8, 11, 3, 0, 0);

/** adsb.lol /v2/point fixture (readsb aircraft.json shape). */
const ADSB_FIXTURE = {
  ac: [
    { hex: "a1b2c3", flight: "FDX1234 ", r: "N123FE", t: "B77L", alt_baro: 3200, gs: 180, lat: 35.1, lon: -89.9, seen: 0.2 },
    { hex: "A1B2C3", flight: "FDX1234 ", lat: 35.1, lon: -89.9 },
    { hex: "d4e5f6", flight: "UPS2910", t: "B748", alt_baro: "ground", lat: 35.04, lon: -89.98 },
    { hex: "0a0b0c", flight: "DAL118", t: "A321", alt_baro: 35000, lat: 35.5, lon: -90.2 },
    { hex: "111111", flight: "N45KL", t: "C172", alt_baro: 2500, lat: 35.2, lon: -90.0 },
    { hex: "222222", t: "GLF6", alt_baro: 41000, lat: 35.0, lon: -89.5 },
    { flight: "GTI8000", lat: 35, lon: -90 },
  ],
  msg: "No error",
  now: NOW,
  total: 7,
  ctime: NOW,
  ptime: 12,
};

describe("callsignPrefix", () => {
  it("returns the three-letter designator or null", () => {
    expect(callsignPrefix("FDX1234 ")).toBe("FDX");
    expect(callsignPrefix("ups2910")).toBe("UPS");
    expect(callsignPrefix("N45KL")).toBeNull();
    expect(callsignPrefix("")).toBeNull();
    expect(callsignPrefix(undefined)).toBeNull();
    expect(callsignPrefix("AB")).toBeNull();
  });
});

describe("countAircraft", () => {
  it("dedupes by hex (case-insensitive), skips hex-less rows and flags cargo-only carriers", () => {
    expect(countAircraft(ADSB_FIXTURE)).toEqual({ all: 5, cargo: 2 });
  });
  it("handles an empty or malformed payload", () => {
    expect(countAircraft({})).toEqual({ all: 0, cargo: 0 });
    expect(countAircraft({ ac: [] })).toEqual({ all: 0, cargo: 0 });
  });
});

describe("hubOutputs / urls", () => {
  it("emits two count series per hub with adsb.lol snapshot provenance", () => {
    const mem = CARGO_HUBS[0];
    const out = hubOutputs(mem, { all: 5, cargo: 2 }, NOW);
    expect(out.map((o) => o.meta.id)).toEqual(["snapshot:hub-aircraft:MEM", "snapshot:hub-cargo-aircraft:MEM"]);
    expect(out.map((o) => o.points[0])).toEqual([
      { t: NOW, v: 5 },
      { t: NOW, v: 2 },
    ]);
    expect(out[1].meta.provenance.source.id).toBe("adsb-lol");
    expect(out[1].meta.provenance.kind).toBe("snapshot");
    expect(out[1].meta.provenance.method).toMatch(/FDX/);
    expect(out[0].meta.geo?.lat).toBeCloseTo(35.042, 3);
  });
  it("builds the point query", () => {
    expect(adsbPointUrl(CARGO_HUBS[0])).toBe("https://api.adsb.lol/v2/point/35.042/-89.977/60");
  });
  it("has unique IATA codes", () => {
    expect(new Set(CARGO_HUBS.map((h) => h.iata)).size).toBe(CARGO_HUBS.length);
  });
});

function ctx(fetchJson: CollectorContext["fetchJson"], log?: (l: string) => void): CollectorContext {
  return { now: NOW, keys: {}, fetchJson, politeDelayMs: 0, log };
}

describe("cargoFlightsCollector", () => {
  it("queries every hub and stores counts only", async () => {
    const urls: string[] = [];
    const out = await cargoFlightsCollector.collect(
      ctx(async <T>(url: string) => {
        urls.push(url);
        return ADSB_FIXTURE as unknown as T;
      }),
    );
    expect(urls).toHaveLength(CARGO_HUBS.length);
    expect(out).toHaveLength(CARGO_HUBS.length * 2);
    expect(JSON.stringify(out)).not.toMatch(/a1b2c3|FDX1234|N123FE/);
  });
  it("keeps going when one hub fails and reports it", async () => {
    const lines: string[] = [];
    const out = await cargoFlightsCollector.collect(
      ctx(async <T>(url: string) => {
        if (url.includes("/35.042/")) throw new Error("api.adsb.lol 429");
        return { ac: [] } as unknown as T;
      }, (l) => lines.push(l)),
    );
    expect(out).toHaveLength((CARGO_HUBS.length - 1) * 2);
    expect(lines.some((l) => /MEM failed: .*429/.test(l))).toBe(true);
  });
  it("throws only when every hub fails", async () => {
    await expect(
      cargoFlightsCollector.collect(
        ctx(async () => {
          throw new Error("down");
        }),
      ),
    ).rejects.toThrow(/down/);
  });
  it("stops when aborted", async () => {
    const ctrl = new AbortController();
    let calls = 0;
    const c = ctx(async <T>() => {
      calls++;
      ctrl.abort();
      return { ac: [] } as unknown as T;
    });
    await expect(cargoFlightsCollector.collect({ ...c, signal: ctrl.signal, politeDelayMs: 1 })).rejects.toThrow(/aborted/);
    expect(calls).toBe(1);
  });
});
