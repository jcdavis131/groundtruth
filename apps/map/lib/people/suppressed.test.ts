// T12: withholding. A withheld CIK leaves every store answer with no count and
// no marker, so the answer reads the same as for an owner who never filed; the
// list lives in server-side environment variables as keyed digests; a bad
// setting fails closed; and nothing in the repository holds a withheld list.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPeopleStore, type PeopleBundle } from "./store";
import { isWithheld, withheldCheck, withheldDigest, WithheldConfigError, WITHHELD_ENV, WITHHELD_KEY_ENV } from "./suppressed";

const root = path.resolve(__dirname, "../..");
const FIXTURE = path.join(__dirname, "fixtures", "insiders.fixture.json");
const fixture = (): PeopleBundle => JSON.parse(readFileSync(FIXTURE, "utf8")) as PeopleBundle;

const A = "0009100001";
const C = "0009100003";
const KEY = "test-key-not-a-secret";
/** The director who files about issuers A and C. */
const DIRECTOR = "0009000002";

function withhold(ciks: Array<string | number>, key = KEY) {
  vi.stubEnv(WITHHELD_ENV, ciks.map((c) => withheldDigest(c, key)).join(",\n "));
  vi.stubEnv(WITHHELD_KEY_ENV, key);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the digest", () => {
  it("is HMAC-SHA256 of the padded CIK, the same for padded and unpadded input", () => {
    const d = withheldDigest(9000002, KEY);
    expect(d).toMatch(/^[0-9a-f]{64}$/);
    expect(withheldDigest("9000002", KEY)).toBe(d);
    expect(withheldDigest(DIRECTOR, KEY)).toBe(d);
  });

  it("depends on the key, so the list cannot be read back by hashing every CIK", () => {
    expect(withheldDigest(DIRECTOR, "another-key")).not.toBe(withheldDigest(DIRECTOR, KEY));
  });

  it("refuses an empty key and a CIK that is not 1 to 10 digits", () => {
    expect(() => withheldDigest(DIRECTOR, "")).toThrow(WithheldConfigError);
    expect(() => withheldDigest("x", KEY)).toThrow();
  });
});

describe("isWithheld", () => {
  it("withholds nobody when the list is unset or empty", () => {
    expect(isWithheld(DIRECTOR)).toBe(false);
    vi.stubEnv(WITHHELD_ENV, "  ");
    expect(isWithheld(DIRECTOR)).toBe(false);
  });

  it("matches a listed CIK, padded or not, and nobody else", () => {
    withhold([DIRECTOR]);
    expect(isWithheld(DIRECTOR)).toBe(true);
    expect(isWithheld(9000002)).toBe(true);
    expect(isWithheld("9000001")).toBe(false);
  });

  it("follows a change in the environment without a reload", () => {
    withhold([DIRECTOR]);
    expect(isWithheld(DIRECTOR)).toBe(true);
    withhold(["9000001"]);
    expect(isWithheld(DIRECTOR)).toBe(false);
    expect(isWithheld(9000001)).toBe(true);
  });

  it("accepts upper-case digests and any mix of commas, spaces and newlines", () => {
    vi.stubEnv(WITHHELD_ENV, `\n${withheldDigest(DIRECTOR, KEY).toUpperCase()} ,\n\t${withheldDigest(9000001, KEY)}\n`);
    vi.stubEnv(WITHHELD_KEY_ENV, KEY);
    expect(isWithheld(DIRECTOR)).toBe(true);
    expect(isWithheld(9000001)).toBe(true);
  });

  it("fails closed on an entry that is not a digest, naming a count and never the entry", () => {
    vi.stubEnv(WITHHELD_ENV, `${withheldDigest(DIRECTOR, KEY)},9000002`);
    vi.stubEnv(WITHHELD_KEY_ENV, KEY);
    let err: unknown;
    try {
      isWithheld(9000001);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(WithheldConfigError);
    expect((err as Error).message).toBe(`${WITHHELD_ENV} holds 1 of 2 entries that are not 64-character hex digests`);
    expect((err as Error).message).not.toContain("9000002");
  });

  it("fails closed on a list with no key", () => {
    vi.stubEnv(WITHHELD_ENV, withheldDigest(DIRECTOR, KEY));
    vi.stubEnv(WITHHELD_KEY_ENV, "");
    expect(() => withheldCheck()).toThrow(WithheldConfigError);
  });
});

describe("the store leaves a withheld owner out, with no count", () => {
  it("drops them from a roster so it equals the roster of a bundle they were never in", () => {
    const without = fixture();
    without.issuers[A] = without.issuers[A].filter((r) => r[0] !== 9000002);
    const expected = createPeopleStore(without).roster(A);

    withhold([DIRECTOR]);
    const s = createPeopleStore(fixture());
    const rows = s.roster(A);
    expect(rows).toEqual(expected);
    expect(rows).toHaveLength(7);
    expect(JSON.stringify(rows)).not.toContain("9000002");
  });

  it("answers an issuer whose only owner is withheld with the empty roster of an issuer with none", () => {
    withhold([DIRECTOR]);
    const s = createPeopleStore(fixture());
    expect(s.roster(C)).toEqual([]);
    expect(s.roster(C)).toEqual(s.roster("0009999999"));
    expect(s.isIssuer(C)).toBe(true);
  });

  it("gives the same null for a withheld owner as for an unknown one, both ways", () => {
    withhold([DIRECTOR]);
    const s = createPeopleStore(fixture());
    expect(s.owner(DIRECTOR)).toBeNull();
    expect(s.owner(DIRECTOR)).toEqual(s.owner(9000099));
    expect(s.link(A, DIRECTOR)).toBeNull();
    expect(s.link(A, DIRECTOR)).toEqual(s.link(A, 9000099));
    expect(s.owner(9000001)!.links.map((l) => l.issuerCik)).toEqual([A, "0009100002"]);
  });

  it("still refuses their CIK for an EDGAR fetch (G13)", () => {
    withhold([DIRECTOR]);
    expect(createPeopleStore(fixture()).isReportingOwner(DIRECTOR)).toBe(true);
  });

  it("carries no withheld count or marker anywhere in what it returns", () => {
    withhold([DIRECTOR, 9000006]);
    const s = createPeopleStore(fixture());
    const answers = JSON.stringify([s.meta, s.roster(A), s.roster(C), s.owner(9000001), s.link(A, 9000001)]);
    expect(answers).not.toMatch(/withh|suppress|omit|hidden|redact/i);
    expect(s.roster(A)).toHaveLength(fixture().issuers[A].length - 2);
    vi.unstubAllEnvs();
    expect(s.meta).toEqual(createPeopleStore(fixture()).meta);
  });

  it("refuses to answer at all while the setting is malformed", () => {
    vi.stubEnv(WITHHELD_ENV, "not-a-digest");
    vi.stubEnv(WITHHELD_KEY_ENV, KEY);
    const s = createPeopleStore(fixture());
    expect(() => s.roster(A)).toThrow(WithheldConfigError);
    expect(() => s.owner(9000001)).toThrow(WithheldConfigError);
    expect(() => s.link(A, 9000001)).toThrow(WithheldConfigError);
    // Unknown CIKs too, so a bad setting cannot be told apart by which CIKs still answer.
    expect(() => s.roster("0009999999")).toThrow(WithheldConfigError);
    expect(() => s.owner(9000099)).toThrow(WithheldConfigError);
    expect(() => s.link("x", "y")).toThrow(WithheldConfigError);
  });
});

describe("no withheld list in the repository", () => {
  const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);

  it("tracks no data file named like a withheld list, and nothing in lib/people but the hook", () => {
    expect(tracked.length).toBeGreaterThan(100);
    const named = (f: string) => /withh|suppress|takedown|opt-?out|removal/i.test(path.basename(f));
    const data = (f: string) => /\.(json|jsonl|csv|tsv|txt|ya?ml|env)$/i.test(f);
    const hook = new Set(["lib/people/suppressed.ts", "lib/people/suppressed.test.ts"]);
    // lib/parcels/suppressed.ts is the parcels' own in-repo list, under the README's published channel (C3, C4).
    const lists = tracked.filter((f) => named(f) && (data(f) || f.startsWith("lib/people/")) && !hook.has(f));
    expect(lists).toEqual([]);
  });

  it("tracks no env file and no assignment of the withholding variables", () => {
    expect(tracked.filter((f) => /(^|\/)\.env/.test(f))).toEqual([]);
    let hits = "";
    try {
      hits = execFileSync("git", ["grep", "-n", "-I", "-E", "GEV_PEOPLE_WITHHELD(_KEY)?[\"']?[[:space:]]*[:=][[:space:]]*[\"']?[0-9A-Za-z]"], { cwd: root, encoding: "utf8" });
    } catch (e) {
      // git grep exits 1 when nothing matches.
      if ((e as { status?: number }).status !== 1) throw e;
    }
    expect(hits).toBe("");
  });

  it("keeps no CIK or digest literal in the withholding module", () => {
    const src = readFileSync(path.join(__dirname, "suppressed.ts"), "utf8");
    expect(src).not.toMatch(/\b[0-9a-fA-F]{64}\b/);
    expect(src).not.toMatch(/\b\d{7,10}\b/);
  });
});
