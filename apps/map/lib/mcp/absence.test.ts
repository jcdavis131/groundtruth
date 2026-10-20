import { describe, expect, it } from "vitest";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { countyPoint } from "../places/registry";
import { ABSENCE_ACTIONS, ABSENCE_BASIS_SCHEMA, ABSENCE_CODES, ABSENCE_SCHEMA, absence, codeForRouteEntry, coverageReasonCode, ROUTE_REASON_CODE, type AbsenceCode } from "./absence";
import { ERROR_CODES } from "./errors";
import { toolByName, type FetchJson, type JsonObject } from "./tools";
import { worldContext, type WorldSection } from "./world";

const validateEntry = new AjvJsonSchemaValidator().getValidator(ABSENCE_SCHEMA as never);
const validateBasis = new AjvJsonSchemaValidator().getValidator(ABSENCE_BASIS_SCHEMA as never);

/**
 * The outside vocabulary: HL7 FHIR R4 CodeSystem data-absent-reason
 * (http://terminology.hl7.org/CodeSystem/data-absent-reason). Written here, not imported, so the
 * table below is checked against FHIR's list and not against our own.
 */
const FHIR_DATA_ABSENT_REASON = ["unknown", "asked-unknown", "temp-unknown", "not-asked", "asked-declined", "masked", "not-applicable", "unsupported", "as-text", "error", "not-a-number", "negative-infinity", "positive-infinity", "not-performed", "not-permitted"];

/** Each code and the FHIR code it is nearest to (null: FHIR has no such notion). The test's copy of the table. */
const EXPECTED: Record<AbsenceCode, { fhir: string | null; action: string; retryable: boolean }> = {
  not_published: { fhir: "unsupported", action: "abstain", retryable: false },
  not_in_release: { fhir: "unknown", action: "abstain", retryable: false },
  withheld: { fhir: "masked", action: "abstain", retryable: false },
  join_gap: { fhir: null, action: "narrow", retryable: false },
  filed_under_other_code: { fhir: null, action: "redirect", retryable: false },
  not_asked: { fhir: "not-asked", action: "narrow", retryable: false },
  not_loaded: { fhir: null, action: "narrow", retryable: false },
  cut_by_route_limit: { fhir: null, action: "narrow", retryable: false },
  cut_by_max_records: { fhir: null, action: "narrow", retryable: false },
  cut_by_byte_cap: { fhir: null, action: "narrow", retryable: false },
  failed: { fhir: "error", action: "retry", retryable: true },
  timeout: { fhir: "temp-unknown", action: "retry", retryable: true },
  no_citation: { fhir: null, action: "none", retryable: false },
  about_eye: { fhir: "not-applicable", action: "none", retryable: false },
};

describe("absence codes", () => {
  it("are the closed list of 14, each with an action, a retry answer and its nearest FHIR data-absent-reason", () => {
    expect(Object.keys(ABSENCE_CODES)).toEqual(Object.keys(EXPECTED));
    expect(Object.keys(ABSENCE_CODES)).toHaveLength(14);
    for (const [code, want] of Object.entries(EXPECTED)) {
      const got = ABSENCE_CODES[code as AbsenceCode];
      expect(got.fhir, `${code}: FHIR code`).toBe(want.fhir);
      expect(got.action, `${code}: action`).toBe(want.action);
      expect(got.retryable, `${code}: retryable`).toBe(want.retryable);
      expect(ABSENCE_ACTIONS, code).toContain(got.action);
      if (got.fhir !== null) expect(FHIR_DATA_ABSENT_REASON, `${code}: a real FHIR code`).toContain(got.fhir);
    }
  });

  it("agree with errors.ts on what is retryable: failed, timeout and rate limit", () => {
    expect(ABSENCE_CODES.failed.retryable).toBe(ERROR_CODES.upstream_failure.retryable);
    expect(ABSENCE_CODES.failed.retryable).toBe(ERROR_CODES.rate_limited.retryable);
    expect(ABSENCE_CODES.timeout.retryable).toBe(ERROR_CODES.timeout.retryable);
  });

  it("never tell an agent to retry something that is not retryable, nor to abstain from something retryable", () => {
    for (const [code, c] of Object.entries(ABSENCE_CODES)) {
      expect(c.action === "retry", `${code}: retry iff retryable`).toBe(c.retryable);
    }
    for (const code of ["not_published", "withheld"] as const) {
      expect(ABSENCE_CODES[code].retryable, code).toBe(false);
      expect(ABSENCE_CODES[code].action, code).toBe("abstain");
    }
  });

  it("not_published and withheld come only from a route's own entry: the reason table maps one route code to not_published and none to withheld", () => {
    expect(Object.entries(ROUTE_REASON_CODE).filter(([, c]) => c === "not_published").map(([k]) => k)).toEqual(["source:not_published_for_puerto_rico"]);
    expect(Object.values(ROUTE_REASON_CODE)).not.toContain("withheld");
    // a reason code the table has never seen is a failure to say why, never a claim about the publisher
    expect(codeForRouteEntry({ reason: "source:something_new" })).toBe("failed");
    expect(codeForRouteEntry({})).toBe("failed");
    expect(codeForRouteEntry({ reason: "source:not_published_for_puerto_rico" })).toBe("not_published");
    expect(codeForRouteEntry({ reason: "source:failed", detail: "The operation was aborted due to timeout" })).toBe("timeout");
  });

  it("every route reason code in the repo maps to a code", () => {
    for (const [k, c] of Object.entries(ROUTE_REASON_CODE)) expect(Object.keys(ABSENCE_CODES), k).toContain(c);
    for (const k of ["join:area_not_placed", "join:boundary_changed_since_2010", "join:filed_under_other_code", "join:legacy_ct_counties", "join:multi_county", "join:ncei_areas_not_counties", "join:no_source_row", "join:unplaced_property_in_state", "source:failed", "source:not_in_release", "source:not_published_for_puerto_rico", "source:null_in_county_layer"]) {
      expect(ROUTE_REASON_CODE[k], `${k} is mapped`).toBeDefined();
    }
  });
});

describe("ABSENCE_SCHEMA", () => {
  const entry = () => absence("FEMA declarations", "join_gap", "the route reports a boundary gap");

  it("accepts an entry built by absence() and an entry with `to`", () => {
    expect(validateEntry(entry()).valid).toBe(true);
    expect(validateEntry(absence("FEMA declarations", "filed_under_other_code", "filed elsewhere", "02261")).valid).toBe(true);
    expect(absence("x", "failed", "y")).toEqual({ what: "x", code: "failed", reason: "y", action: "retry" });
  });

  it("rejects an entry with no code, an unknown code, or an action that is not the code's", () => {
    const { code: _code, ...noCode } = entry();
    void _code;
    expect(validateEntry(noCode).valid, "no code").toBe(false);
    expect(validateEntry(noCode).errorMessage).toContain("code");
    expect(validateEntry({ ...entry(), code: "made_up" }).valid, "unknown code").toBe(false);
    expect(validateEntry(absence("x", "not_published", "y")).valid).toBe(true);
    expect(validateEntry({ ...absence("x", "not_published", "y"), action: "retry" }).valid, "not_published must abstain").toBe(false);
    expect(validateEntry({ ...absence("x", "withheld", "y"), action: "narrow" }).valid, "withheld must abstain").toBe(false);
    expect(validateEntry({ ...entry(), reason: "" }).valid, "empty reason").toBe(false);
  });

  it("validates a basis line of {code, text} and rejects a bare string", () => {
    expect(validateBasis({ code: "cut_by_byte_cap", text: "the reply was cut" }).valid).toBe(true);
    expect(validateBasis("the reply was cut").valid).toBe(false);
    expect(validateBasis({ text: "no code" }).valid).toBe(false);
    expect(validateBasis({ code: "nope", text: "x" }).valid).toBe(false);
  });
});

describe("coverage reasons in emergence.ts", () => {
  // emergence.ts builds its reasons inline, so the strings are read from its source (not edited).
  const src = readFileSync(path.join(__dirname, "..", "fabric", "emergence.ts"), "utf8");
  const reasons = [...src.matchAll(/reasons\.push\((`[^`]*`|"[^"]*")\)/g)].map((m) => m[1].slice(1, -1).replace(/\$\{[^}]*\}/g, "X"));

  it("finds the reason strings", () => {
    expect(reasons.length).toBeGreaterThanOrEqual(7);
  });

  it("maps every one to a code, so the globe and the MCP can say the same thing", () => {
    for (const r of reasons) {
      const code = coverageReasonCode(r);
      expect(code, `an absence code for: ${r}`).toBeDefined();
      expect(Object.keys(ABSENCE_CODES)).toContain(code);
    }
    expect(coverageReasonCode("a reason nobody wrote")).toBeUndefined();
  });
});

// ---- the recorded replies -------------------------------------------------------

interface Recorded {
  input: JsonObject;
  routes: Record<string, { status: number; body: JsonObject }>;
}

const FIXTURE_DIR = path.join(__dirname, "__fixtures__", "world");
const recorded: Array<[string, Recorded]> = readdirSync(FIXTURE_DIR)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => [f.replace(/\.json$/, ""), JSON.parse(readFileSync(path.join(FIXTURE_DIR, f), "utf8")) as Recorded]);

function replay(rec: Recorded): FetchJson {
  return async (p) => {
    const r = rec.routes[p];
    if (!r) return { status: 500, body: { error: `not recorded: ${p}` }, url: "http://t" + p };
    return { status: r.status, body: structuredClone(r.body), url: "http://t" + p };
  };
}

const runRecorded = (rec: Recorded) => worldContext(toolByName("world_context")!.inputSchema.parse(rec.input) as never, { fetchJson: replay(rec), countyPoint });

describe("absence entries in every recorded world reply", () => {
  it("ABSENCE_SCHEMA validates every missing[] entry and every coverageStatus.basis line, and removing `code` from one fails", async () => {
    let entries = 0;
    let lines = 0;
    for (const [label, rec] of recorded) {
      const r = await runRecorded(rec);
      const topics = r.payload.topics as Record<string, WorldSection>;
      for (const [t, sec] of Object.entries(topics)) {
        for (const m of sec.missing ?? []) {
          const v = validateEntry(m);
          expect(v.errorMessage, `${label} ${t}: ${JSON.stringify(m)}`).toBeUndefined();
          entries++;
          // the mutation: the same entry without its code is rejected
          const { code: _c, ...bare } = m;
          void _c;
          expect(validateEntry(bare).valid, `${label} ${t}: an entry without code`).toBe(false);
        }
        for (const b of sec.coverageStatus?.basis ?? []) {
          expect(validateBasis(b).errorMessage, `${label} ${t}: ${JSON.stringify(b)}`).toBeUndefined();
          lines++;
        }
      }
      const top = (r.payload.coverageStatus as { basis: unknown[] } | undefined)?.basis ?? [];
      for (const b of top) {
        expect(validateBasis(b).errorMessage, `${label}: ${JSON.stringify(b)}`).toBeUndefined();
        lines++;
      }
    }
    // the fixtures between them have both kinds of line, so the loops above checked something
    expect(entries).toBeGreaterThan(10);
    expect(lines).toBeGreaterThan(10);
  });

  it("the codes in them are ones the routes' own entries or the tool's own checks can justify: no withheld, and not_published only for a route-listed Puerto Rico", async () => {
    const seen = new Map<string, Set<string>>();
    for (const [label, rec] of recorded) {
      const r = await runRecorded(rec);
      for (const sec of Object.values(r.payload.topics as Record<string, WorldSection>)) {
        for (const m of sec.missing ?? []) (seen.get(m.code) ?? seen.set(m.code, new Set()).get(m.code)!).add(label);
      }
    }
    expect(seen.has("withheld")).toBe(false);
    for (const label of seen.get("not_published") ?? []) expect(label).toBe("pr_72127");
  });
});
