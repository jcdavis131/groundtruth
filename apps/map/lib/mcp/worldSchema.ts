// The published outputSchema of world_context, schemaVersion "world/2".
//
// A hand-written JSON Schema (declared 2020-12; it uses only keywords draft-07 validators
// read too: type, required, enum, const, pattern, if/then, not, allOf) that encodes the
// rules the tool already keeps, so a client can check a bundle without trusting eye:
//   - every item has fact, value, sourceId, publisher, upstreamUrl, retrievedAt (ending Z) and link;
//   - a null value carries a note saying why (null, never a placeholder);
//   - an item with no upstreamRecordUrl says "no record-level URL: <why>" in its note;
//   - an upstreamRecordUrl sits on its own publisher's host (worldHosts.ts, the same table the test reads);
//   - kind is "about-eye" only on eye's own catalogue items, and those have no publisher record;
//   - a topic with missing[] entries has a coverageStatus; a reply that was cut (truncated) has one;
//   - missing[] entries and coverageStatus.basis lines are the typed ones of ./absence;
//   - coverageStatus.status is "partial" and nothing else ("complete" would be a claim eye cannot make).
// An isError reply carries the typed error envelope (./errors) instead of the bundle, and the
// SDK's client checks structuredContent against the tool's outputSchema even when isError is
// true, so the schema accepts that envelope too: a reply with an `error` key must carry the
// envelope fields; one without must be the bundle.
// Additive: schemaVersion is a new key; nothing else in the reply changed shape except that
// missing[] entries gained code and action and basis lines became { code, text }.
//
// Fully inlined (no $ref), so a client that does not resolve references still reads it.
// Relative imports only (see ./tools.ts for why).

import { ABSENCE_BASIS_SCHEMA, ABSENCE_SCHEMA } from "./absence";
import { ERROR_ENVELOPE_SCHEMA } from "./errors";
import { RECORD_HOSTS } from "./worldHosts";

export const WORLD_SCHEMA_VERSION = "world/2";

const nonEmpty = { type: "string", minLength: 1 } as const;

const NO_RECORD_NOTE = "no record-level URL: \\S";

const ITEM_SCHEMA = {
  type: "object",
  required: ["fact", "value", "sourceId", "publisher", "upstreamUrl", "retrievedAt", "link"],
  properties: {
    fact: nonEmpty,
    value: { type: ["string", "number", "boolean", "null"] },
    unit: { type: "string" },
    code: { type: "string" },
    period: { type: "string" },
    note: nonEmpty,
    point: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
    sourceId: nonEmpty,
    publisher: nonEmpty,
    upstreamUrl: { type: "string", pattern: "^https?://" },
    upstreamRecordUrl: { type: "string", pattern: "^https://" },
    retrievedAt: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}T[0-9:.]+Z$" },
    link: { type: "string", pattern: "^https?://" },
    kind: { type: "string", enum: ["about-eye"] },
    absence: { type: "string", enum: ["withheld"] },
  },
  allOf: [
    // null, never a placeholder: and the item says why
    { if: { properties: { value: { type: "null" } }, required: ["value"] }, then: { required: ["note"] } },
    // a value withheld by the publisher's own flag is null
    { if: { required: ["absence"] }, then: { required: ["value"], properties: { value: { type: "null" } } } },
    // no publisher record: the note says why
    { if: { not: { required: ["upstreamRecordUrl"] } }, then: { required: ["note"], properties: { note: { pattern: NO_RECORD_NOTE } } } },
    // a record URL is on the cited publisher's own host
    ...Object.entries(RECORD_HOSTS).map(([id, host]) => ({
      if: { properties: { sourceId: { const: id } }, required: ["sourceId"] },
      then: { properties: { upstreamRecordUrl: { pattern: host.source } } },
    })),
    // claims about eye's own catalogue are marked, and have no publisher record
    { if: { properties: { sourceId: { const: "eye-catalog" } }, required: ["sourceId"] }, then: { required: ["kind"] } },
    { if: { properties: { kind: { const: "about-eye" } }, required: ["kind"] }, then: { properties: { sourceId: { const: "eye-catalog" } }, not: { required: ["upstreamRecordUrl"] } } },
  ],
} as const;

const COVERAGE_SCHEMA = {
  type: "object",
  required: ["status", "basis"],
  properties: {
    status: { type: "string", const: "partial" },
    basis: { type: "array", minItems: 1, items: ABSENCE_BASIS_SCHEMA },
  },
  additionalProperties: false,
} as const;

const SECTION_SCHEMA = {
  type: "object",
  required: ["items"],
  properties: {
    items: { type: "array", items: ITEM_SCHEMA },
    missing: { type: "array", minItems: 1, items: ABSENCE_SCHEMA },
    coverageStatus: COVERAGE_SCHEMA,
  },
  additionalProperties: false,
  // a topic that lists what is missing also says its coverage is partial
  allOf: [{ if: { required: ["missing"] }, then: { required: ["coverageStatus"] } }],
} as const;

export const WORLD_OUTPUT_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "world_context reply, world/2",
  type: "object",
  properties: {
    schemaVersion: { type: "string", const: WORLD_SCHEMA_VERSION },
    place: { type: "object", required: ["kind"], properties: { kind: nonEmpty } },
    topics: { type: "object", required: ["identity"], additionalProperties: SECTION_SCHEMA },
    limits: { type: "object" },
    note: nonEmpty,
    truncated: { type: "object", required: ["droppedItems"], properties: { droppedItems: { type: "integer", minimum: 1 }, note: nonEmpty } },
    coverageStatus: COVERAGE_SCHEMA,
    // the error envelope, on an isError reply
    error: ERROR_ENVELOPE_SCHEMA.properties.error,
    code: ERROR_ENVELOPE_SCHEMA.properties.code,
    category: ERROR_ENVELOPE_SCHEMA.properties.category,
    retryable: ERROR_ENVELOPE_SCHEMA.properties.retryable,
    remediation: ERROR_ENVELOPE_SCHEMA.properties.remediation,
  },
  allOf: [
    {
      if: { required: ["error"] },
      then: { required: [...ERROR_ENVELOPE_SCHEMA.required] },
      else: { required: ["schemaVersion", "place", "topics", "limits", "note"] },
    },
    // a reply cut to its byte cap says so in coverageStatus
    { if: { required: ["truncated"] }, then: { required: ["coverageStatus"] } },
  ],
} as const;
