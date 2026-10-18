// The people store over the hand-written fixture (placeholder CIKs above
// EDGAR's range, names removed) and, once, over the committed bundle:
// issuer to people, owner to issuers, padded and unpadded CIK lookups,
// vehicles with no name or CIK, and a load that refuses a bundle whose layout
// it does not know.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createPeopleStore,
  getPeopleStore,
  loadPeopleStore,
  PeopleBundleError,
  type BundleRow,
  type PeopleBundle,
} from "./store";

const FIXTURE = path.join(__dirname, "fixtures", "insiders.fixture.json");
const fixture = (): PeopleBundle => JSON.parse(readFileSync(FIXTURE, "utf8")) as PeopleBundle;

/** Issuer A has eight owners: four individuals, an entity, a vehicle, an officer titled in the remarks, a listed company. */
const A = "0009100001";
const B = "0009100002";
const C = "0009100003";

describe("loadPeopleStore", () => {
  it("reads the fixture and reports its window", async () => {
    const s = await loadPeopleStore(FIXTURE);
    expect(s.meta).toEqual({
      built: true,
      source: "sec-form345",
      quarters: ["2024q3", "2024q4", "2025q1", "2025q2", "2025q3", "2025q4", "2026q1", "2026q2"],
      periodFrom: "2024-07-01",
      periodTo: "2026-06-30",
      pulled: null,
    });
  });

  it("gives an empty, not-built store for a missing file, not an answer that a company has no insiders", async () => {
    const s = await loadPeopleStore(path.join(__dirname, "fixtures", "no-such-bundle.json"));
    expect(s.meta.built).toBe(false);
    expect(s.meta.quarters).toEqual([]);
    expect(s.roster(A)).toEqual([]);
    expect(s.owner(9000001)).toBeNull();
    expect(s.isIssuer(A)).toBe(false);
    expect(s.isReportingOwner(9000001)).toBe(false);
  });
});

describe("issuer to people", () => {
  const s = createPeopleStore(fixture());

  it("decodes each row by the header's layout", () => {
    const rows = s.roster(A);
    expect(rows).toHaveLength(8);
    expect(rows[0]).toEqual({
      issuerCik: A,
      ownerCik: "0009000001",
      ownerClass: "individual",
      name: "[removed from this fixture: an officer and director]",
      roles: ["director", "officer"],
      title: "Chief Executive Officer",
      titleInFiling: false,
      firstFiled: "2024-08-02",
      lastFiled: "2026-05-04",
      lastPeriod: "2026-05-01",
      nssFiled: null,
      lastForm: "4",
      lastAccession: "0009000001-26-000003",
      otherText: null,
    });
    const byOwner = new Map(rows.map((r) => [r.ownerCik, r]));
    expect(byOwner.get("0009000003")!.roles).toEqual(["ten-percent-owner"]);
    expect(byOwner.get("0009000004")!.otherText).toBe("Member of a Group");
    expect(byOwner.get("0009000004")!.roles).toEqual(["other"]);
    expect(byOwner.get("0009000005")!.ownerClass).toBe("entity");
    const titled = byOwner.get("0009000007")!;
    expect(titled).toMatchObject({ title: null, titleInFiling: true, nssFiled: "2026-02-20", lastForm: "4/A" });
    expect(byOwner.get("0009100003")!.ownerClass).toBe("business");
  });

  it("lists a vehicle by role only: no name, no CIK, no title", () => {
    const vehicles = s.roster(A).filter((r) => r.ownerClass === "vehicle");
    expect(vehicles).toHaveLength(1);
    expect(vehicles[0]).toMatchObject({ ownerCik: null, name: null, title: null, titleInFiling: false, roles: ["ten-percent-owner"] });
    // The accession stays: the filing link is where the roster sends a reader for the name (D3). A
    // self-filed accession starts with the filer's CIK, as EDGAR numbers it; no other field carries it.
    const { lastAccession, ...rest } = vehicles[0];
    expect(lastAccession).toBe("0009000006-25-000002");
    expect(JSON.stringify(rest)).not.toContain("9000006");
  });

  it("drops a vehicle's name even when a bundle carries one", () => {
    const b = fixture();
    b.issuers[A][5][1] = "[removed from this fixture: a family trust]";
    const v = createPeopleStore(b).roster(A).find((r) => r.ownerClass === "vehicle")!;
    expect(v.name).toBeNull();
  });

  it("serves no title for a vehicle, even when a bundle carries the grantor's", () => {
    // A trust can file with the grantor's Director, Officer and title on its own row.
    const b = fixture();
    const row = b.issuers[A][5];
    expect(row[2]).toBe("v");
    row[3] = 7;
    row[4] = "Chief Placeholder Officer of the trust";
    row[5] = 1;
    const s = createPeopleStore(b);
    const served = [
      s.roster(A),
      s.roster("9100001"),
      s.owner(9000006),
      s.link(A, 9000006),
      s.link(A, "0009000006"),
      ...[9000001, 9000002, 9000003, 9000004, 9000005, 9000007, 9000008, 9100003].map((o) => s.owner(o)),
    ];
    const v = s.roster(A).find((r) => r.ownerClass === "vehicle")!;
    expect(v).toMatchObject({ roles: ["director", "officer", "ten-percent-owner"], title: null, titleInFiling: false });
    expect(s.owner(9000006)).toBeNull();
    expect(s.link(A, 9000006)).toBeNull();
    expect(JSON.stringify(served)).not.toContain("Placeholder Officer of the trust");
  });

  it("looks issuers up padded, unpadded or as a number, and nothing else", () => {
    expect(s.roster("9100001")).toEqual(s.roster(A));
    expect(s.roster(9100001)).toEqual(s.roster(A));
    expect(s.roster("0009100002").map((r) => r.ownerCik)).toEqual(["0009000001", "0009000008"]);
    for (const bad of ["", "abc", " 9100001", "9100001 ", "-9100001", "0", "12345678901", "9.1e6", "CIK9100001"]) {
      expect(s.roster(bad), JSON.stringify(bad)).toEqual([]);
    }
    expect(s.roster(9_100_001.5)).toEqual([]);
    expect(s.roster("0009999999")).toEqual([]);
  });

  it("knows which CIKs are issuers in the bundle", () => {
    expect(s.isIssuer(A)).toBe(true);
    expect(s.isIssuer("9100003")).toBe(true);
    expect(s.isIssuer(9000001)).toBe(false);
    expect(s.isIssuer("0009999999")).toBe(false);
  });
});

describe("owner to issuers", () => {
  const s = createPeopleStore(fixture());

  it("lists every issuer an owner filed about, by issuer CIK", () => {
    const o = s.owner("9000001")!;
    expect(o.ownerCik).toBe("0009000001");
    expect(o.ownerClass).toBe("individual");
    expect(o.links.map((l) => l.issuerCik)).toEqual([A, B]);
    expect(o.links.map((l) => l.roles)).toEqual([["director", "officer"], ["director"]]);
    expect(s.owner("0009000002")!.links.map((l) => l.issuerCik)).toEqual([A, C]);
  });

  it("looks owners up padded, unpadded or as a number", () => {
    expect(s.owner(9000002)).toEqual(s.owner("0009000002"));
    expect(s.owner("9000002")).toEqual(s.owner("0009000002"));
    expect(s.owner("09000002")).toEqual(s.owner("0009000002"));
  });

  it("resolves a listed company that files as an owner as a business", () => {
    const o = s.owner(9100003)!;
    expect(o.ownerClass).toBe("business");
    expect(o.links.map((l) => l.issuerCik)).toEqual([A]);
  });

  it("returns the same null for a vehicle and for a CIK it never saw", () => {
    expect(s.owner(9000006)).toBeNull();
    expect(s.owner(9000099)).toBeNull();
    expect(s.owner("x")).toBeNull();
    expect(s.link(A, 9000006)).toBeNull();
  });

  it("finds one issuer-owner link and nothing across issuers", () => {
    expect(s.link("9100001", "9000001")).toEqual(s.roster(A)[0]);
    expect(s.link(B, 9000001)!.roles).toEqual(["director"]);
    expect(s.link(B, 9000003)).toBeNull();
    expect(s.link(9999999, 9000001)).toBeNull();
  });

  it("marks individual, entity and vehicle CIKs as reporting owners, and not a business or a stranger", () => {
    expect(s.isReportingOwner(9000001)).toBe(true);
    expect(s.isReportingOwner("0009000005")).toBe(true);
    expect(s.isReportingOwner("9000006")).toBe(true);
    expect(s.isReportingOwner(9100003)).toBe(false);
    expect(s.isReportingOwner(9000099)).toBe(false);
  });
});

describe("a bundle the reader does not know is refused", () => {
  const broken: Array<[string, (b: PeopleBundle) => void]> = [
    ["a reordered row layout", (b) => {
      [b.row[1], b.row[2]] = [b.row[2], b.row[1]];
    }],
    ["a new class code", (b) => {
      b.classes.x = "other";
    }],
    ["changed role bits", (b) => {
      b.roleBits.officer = 16;
    }],
    ["a free-text phrase list", (b) => {
      b.otherPhrases.push("anything");
    }],
    ["another source", (b) => {
      b.source = "sec-8k";
    }],
    ["a short row", (b) => {
      b.issuers[A][0].splice(11);
    }],
    ["an extra column", (b) => {
      (b.issuers[A][0] as unknown[]).push(null, "x");
    }],
    ["'other' text outside the phrase list", (b) => {
      b.issuers[A][3][12] = "free text from the filing";
    }],
    ["a name where a date goes", (b) => {
      b.issuers[A][0][6] = "[removed from this fixture: a name]";
    }],
    ["a null name on an individual", (b) => {
      b.issuers[A][0][1] = null;
    }],
    ["an unpadded issuer key", (b) => {
      b.issuers["9100004"] = [];
    }],
    ["one owner with two classes", (b) => {
      b.issuers[C][0][2] = "e";
    }],
    ["a role bit outside the four", (b) => {
      b.issuers[A][0][3] = 16;
    }],
  ];
  it.each(broken)("%s", (_label, mutate) => {
    const b = fixture();
    mutate(b);
    expect(() => createPeopleStore(b)).toThrow(PeopleBundleError);
  });

  it("names no value from the file in its error", () => {
    const b = fixture();
    (b.issuers[A][0] as BundleRow)[6] = "[removed from this fixture: a name]";
    expect(() => createPeopleStore(b)).toThrow(/^people bundle: issuer 0009100001 row 0: bad date$/);
  });
});

describe("the committed bundle", () => {
  it("loads once per process and indexes every row both ways", async () => {
    const s = await getPeopleStore();
    expect(await getPeopleStore()).toBe(s);
    expect(s.meta.built).toBe(true);
    expect(s.meta.quarters.at(-1)).toMatch(/^\d{4}q[1-4]$/);

    const bundle = JSON.parse(readFileSync(path.join(__dirname, "data", "insiders.json"), "utf8")) as PeopleBundle & {
      counts: { issuers: number; edges: number };
    };
    const keys = Object.keys(bundle.issuers);
    expect(keys).toHaveLength(bundle.counts.issuers);
    let edges = 0;
    for (const k of keys) edges += s.roster(k).length;
    expect(edges).toBe(bundle.counts.edges);

    const [issuer, rows] = Object.entries(bundle.issuers).find(([, rs]) => rs.some((r) => r[2] === "i"))!;
    const person = rows.find((r) => r[2] === "i")!;
    const o = s.owner(person[0])!;
    expect(o.ownerClass).toBe("individual");
    expect(o.links.map((l) => l.issuerCik)).toContain(issuer);
    expect(s.roster(Number(issuer))).toEqual(s.roster(issuer));
  });
});
