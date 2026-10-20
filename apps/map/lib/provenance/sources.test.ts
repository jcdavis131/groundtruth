import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RECORD_HOSTS } from "../mcp/worldHosts";
import { lintLicences } from "./licenceTerms";
import { source, SOURCES } from "./sources";

describe("source registry", () => {
  it("resolves the CES state-and-metro source", () => {
    expect(source("bls-ces-sm")).toEqual({
      id: "bls-ces-sm",
      name: "Current Employment Statistics, State and Metro Area",
      publisher: "U.S. Bureau of Labor Statistics",
      url: "https://www.bls.gov/sae/",
      license: "public domain",
      licenseId: "us-gov-work",
    });
  });
  it("resolves the Census population estimates source", () => {
    expect(source("census-popest")).toEqual({
      id: "census-popest",
      name: "Population Estimates Program, metro and micro totals",
      publisher: "U.S. Census Bureau",
      url: "https://www.census.gov/programs-surveys/popest.html",
      license: "public domain",
      licenseId: "us-gov-work",
    });
  });
  it("cites BankFind at its current host", () => {
    expect(source("fdic-bankfind").url).toBe("https://api.fdic.gov/banks/docs/");
  });
  it("every entry is keyed by its own id and links over https", () => {
    for (const [key, ref] of Object.entries(SOURCES)) {
      expect(ref.id, key).toBe(key);
      expect(ref.url.startsWith("https://"), key).toBe(true);
    }
  });
});

// The licence lint reports a source without a licenseId; for the sources world_context relays it fails. Those are the
// ones a caller gets a number from, so a bundle never carries a source whose terms nobody wrote down.
const registry: Record<string, { license: string; licenseId?: string }> = SOURCES;

/** The source ids world_context can cite: the record-host table, every registered id world.ts spells out, and every sourceId in the recorded replies. */
function relayedSourceIds(): string[] {
  const ids = new Set<string>(Object.keys(RECORD_HOSTS));
  const mcp = path.resolve(__dirname, "../mcp");
  const world = readFileSync(path.join(mcp, "world.ts"), "utf8");
  for (const id of Object.keys(SOURCES)) if (world.includes(`"${id}"`)) ids.add(id);
  const fixtures = path.join(mcp, "__fixtures__", "world");
  for (const f of readdirSync(fixtures)) {
    if (!f.endsWith(".json")) continue;
    for (const m of readFileSync(path.join(fixtures, f), "utf8").matchAll(/"sourceId"\s*:\s*"([^"]+)"/g)) ids.add(m[1]);
  }
  return [...ids].sort();
}

describe("source licences, strict for what world_context relays", () => {
  const relayed = relayedSourceIds();

  it("finds the relayed sources: the record hosts, ids world.ts names, ids in the recorded replies", () => {
    expect(relayed.length).toBeGreaterThan(20);
    for (const id of ["usace-nid", "sec-edgar", "fema-nri", "zillow-zhvi", "noaa-cag", "eye-catalog"]) expect(relayed, id).toContain(id);
  });

  it("every relayed source has a licenseId from the vocabulary", () => {
    const r = lintLicences(SOURCES, relayed);
    expect(r.unknown).toEqual([]);
    expect(r.strict).toEqual({ missing: [], unregistered: [] });
  });

  it("keeps the repo's own us-gov-work rule: a federal compilation of others' records does not carry it", () => {
    // the sources licenceTerms.ts names as not us-gov-work
    for (const id of ["usace-nid", "sec-edgar", "usgs-padus", "usdot-nad", "usgs-landslides", "usgs-qfaults", "nasa-eonet"]) {
      expect(registry[id], id).toBeDefined();
      expect(registry[id].licenseId, id).not.toBe("us-gov-work");
    }
  });

  it("the sources filled from their publishers' own pages name the page, the day it was read and the sentence", () => {
    for (const id of ["fema-nri", "cms-provider-data", "usdm", "sec-edgar", "usgs-wbd", "epa-ucmr5-pat", "hifld-hospitals", "usace-nid", "bts-supply-chain"]) {
      const note = registry[id].license;
      expect(note, id + " names a page").toMatch(/https:\/\/\S+/);
      expect(note, id + " says when it was read").toMatch(/read 2026-10-20/);
      expect(note, id + " quotes a sentence").toMatch(/"[^"]{12,}"/);
    }
  });
});
