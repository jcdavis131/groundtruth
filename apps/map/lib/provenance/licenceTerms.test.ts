import { describe, expect, it } from "vitest";
import { LICENCE_TERMS, licenceTerm, lintLicences } from "./licenceTerms";
import { SOURCES } from "./sources";

describe("licence vocabulary", () => {
  it("every entry is keyed by its own id and links to its terms over https", () => {
    for (const [key, term] of Object.entries(LICENCE_TERMS)) {
      expect(term.id, key).toBe(key);
      expect(term.url.startsWith("https://"), key).toBe(true);
      expect(term.name.length, key).toBeGreaterThan(0);
    }
  });
  it("named ids are lower-case so they can't be mistaken for SPDX ids", () => {
    for (const term of Object.values(LICENCE_TERMS)) {
      if (term.kind === "named") expect(term.id, term.id).toMatch(/^[a-z0-9][a-z0-9.-]*$/);
    }
  });
  it("looks an id up, and returns nothing for an unknown one", () => {
    expect(licenceTerm("CC-BY-4.0")?.url).toBe("https://spdx.org/licenses/CC-BY-4.0.html");
    expect(licenceTerm("not-a-licence")).toBeUndefined();
  });
  it("the lint fails an unknown id and reports a missing one", () => {
    const r = lintLicences({
      a: { id: "a", licenseId: "MIT" },
      b: { id: "b", licenseId: "made-up" },
      c: { id: "c" },
    });
    expect(r).toEqual({ unknown: [{ source: "b", licenseId: "made-up" }], missing: ["c"], mapped: 1 });
  });
});

describe("source licences", () => {
  const r = lintLicences(SOURCES);
  it("no source carries a licence id outside the vocabulary", () => {
    expect(r.unknown).toEqual([]);
  });
  it("lists sources with no licence id (reported, not failed)", () => {
    const total = Object.keys(SOURCES).length;
    console.info(`licence lint: ${r.mapped}/${total} sources mapped, ${r.unknown.length} unknown, ${r.missing.length} with no id:\n  ${r.missing.join("\n  ")}`);
    expect(r.mapped + r.missing.length + r.unknown.length).toBe(total);
  });
  it("a source with a licence id keeps its free-text licence as the note", () => {
    for (const [key, ref] of Object.entries(SOURCES) as Array<[string, { license: string; licenseId?: string }]>) {
      if (ref.licenseId) expect(ref.license.length, key).toBeGreaterThan(0);
    }
  });
});
