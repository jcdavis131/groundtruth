import { describe, expect, it } from "vitest";
import { source, SOURCES } from "./sources";

describe("source registry", () => {
  it("resolves the CES state-and-metro source", () => {
    expect(source("bls-ces-sm")).toEqual({
      id: "bls-ces-sm",
      name: "Current Employment Statistics, State and Metro Area",
      publisher: "U.S. Bureau of Labor Statistics",
      url: "https://www.bls.gov/sae/",
      license: "public domain",
    });
  });
  it("resolves the Census population estimates source", () => {
    expect(source("census-popest")).toEqual({
      id: "census-popest",
      name: "Population Estimates Program, metro and micro totals",
      publisher: "U.S. Census Bureau",
      url: "https://www.census.gov/programs-surveys/popest.html",
      license: "public domain",
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
