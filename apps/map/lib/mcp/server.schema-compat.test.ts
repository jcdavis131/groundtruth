// The versioning promise, second half (docs/MCP.md "Versioning promise"): world/N is additive within N. The
// published outputSchema of world_context may gain properties and enum values, but within one N it may not lose a
// property, change a type, stop requiring a field it required, change a const or drop an enum value. The baseline
// is the schema as first published under that N (server.world-2.schema.json), committed once and never edited:
// the current schema is compared with the baseline, not with the previous commit, so small steps cannot add up to a
// break. A break goes in as world/N+1, served beside N for 90 days.
//
// Both schemas are flattened to property paths ($.topics.*.items[].sourceId). allOf, anyOf, oneOf, then and else
// are merged into the node they sit on, so reordering rules is not a break and a rule that only lives in a branch
// still counts; `if` and `not` are not read. Not seen: a changed pattern, minItems or maxLength, and a field that
// was required only under a condition becoming required nowhere else. The other tools relay route JSON verbatim and
// publish no schema, so there is nothing to compare for them.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { WORLD_OUTPUT_SCHEMA, WORLD_SCHEMA_VERSION } from "./worldSchema";

interface Flat {
  types: Set<string>;
  enums: Set<string>;
  consts: Set<string>;
}
interface Surface {
  nodes: Map<string, Flat>;
  required: Set<string>;
}
type Json = { [k: string]: unknown };

function visit(schema: unknown, at: string, out: Surface): void {
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) return;
  const s = schema as Json;
  let node = out.nodes.get(at);
  if (!node) {
    node = { types: new Set(), enums: new Set(), consts: new Set() };
    out.nodes.set(at, node);
  }
  const t = s.type;
  for (const x of Array.isArray(t) ? t : t === undefined ? [] : [t]) node.types.add(String(x));
  if (Array.isArray(s.enum)) for (const v of s.enum) node.enums.add(JSON.stringify(v));
  if ("const" in s) node.consts.add(JSON.stringify(s.const));
  if (Array.isArray(s.required)) for (const r of s.required) out.required.add(`${at}.${String(r)}`);
  if (s.properties !== null && typeof s.properties === "object") {
    for (const [k, v] of Object.entries(s.properties as Json)) visit(v, `${at}.${k}`, out);
  }
  if (s.items !== undefined) visit(s.items, `${at}[]`, out);
  if (s.additionalProperties !== null && typeof s.additionalProperties === "object") visit(s.additionalProperties, `${at}.*`, out);
  for (const key of ["allOf", "anyOf", "oneOf"]) {
    const list = s[key];
    if (Array.isArray(list)) for (const sub of list) visit(sub, at, out);
  }
  visit(s.then, at, out);
  visit(s.else, at, out);
}

function surface(schema: unknown): Surface {
  const out: Surface = { nodes: new Map(), required: new Set() };
  visit(schema, "$", out);
  return out;
}

const sameSet = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));

/** What `current` took away from, or changed in, `baseline`. Additions are not breaks. */
function schemaBreaks(baseline: unknown, current: unknown): string[] {
  const b = surface(baseline);
  const c = surface(current);
  const out: string[] = [];
  for (const [at, was] of b.nodes) {
    const now = c.nodes.get(at);
    if (!now) {
      out.push(`removed: ${at}`);
      continue;
    }
    if (was.types.size > 0 && !sameSet(was.types, now.types)) {
      out.push(`retyped: ${at} was ${[...was.types].sort().join("|")}, now ${[...now.types].sort().join("|") || "(no type)"}`);
    }
    for (const e of was.enums) if (!now.enums.has(e)) out.push(`enum value removed: ${at} ${e}`);
    for (const k of was.consts) if (!now.consts.has(k)) out.push(`const changed: ${at} was ${k}`);
  }
  for (const r of b.required) if (!c.required.has(r)) out.push(`no longer required: ${r}`);
  return out;
}

const here = __dirname;
const baselineFile = (n: number) => path.join(here, `server.world-${n}.schema.json`);
const readJson = (file: string): unknown => JSON.parse(readFileSync(file, "utf8"));

describe("world_context outputSchema, additive within world/N", () => {
  const n = Number(/^world\/(\d+)$/.exec(WORLD_SCHEMA_VERSION)?.[1]);
  const current: unknown = JSON.parse(JSON.stringify(WORLD_OUTPUT_SCHEMA));

  it("has a committed baseline for the current WORLD_SCHEMA_VERSION", () => {
    expect(Number.isInteger(n), WORLD_SCHEMA_VERSION).toBe(true);
    const base = readJson(baselineFile(n)) as { properties: { schemaVersion: { const: string } } };
    expect(base.properties.schemaVersion.const).toBe(WORLD_SCHEMA_VERSION);
  });

  it("takes nothing away from, and retypes nothing in, the baseline (a break is world/N+1, served beside N for 90 days)", () => {
    expect(schemaBreaks(readJson(baselineFile(n)), current)).toEqual([]);
  });

  it("every baseline file states the schemaVersion its name gives", () => {
    const files = readdirSync(here).filter((f) => /^server\.world-\d+\.schema\.json$/.test(f));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const v = Number(/-(\d+)\./.exec(f)?.[1]);
      expect((readJson(path.join(here, f)) as { properties: { schemaVersion: { const: string } } }).properties.schemaVersion.const, f).toBe(`world/${v}`);
    }
  });
});

describe("schemaBreaks, on planted changes", () => {
  const mini = (): Json => ({
    type: "object",
    required: ["a"],
    properties: {
      a: { type: "string" },
      b: { type: ["number", "null"] },
      c: { type: "array", items: { type: "object", properties: { d: { type: "string", enum: ["x", "y"] }, k: { const: "fixed" } } } },
    },
    allOf: [
      { if: { required: ["b"] }, then: { required: ["c"], properties: { e: { type: "string" } } } },
      { if: { required: ["a"] }, then: { properties: { g: { type: "integer" } } } },
    ],
  });
  const edit = (f: (s: Json) => void): Json => {
    const s = mini();
    f(s);
    return s;
  };
  const props = (s: Json) => s.properties as Json;
  const itemProps = (s: Json) => ((props(s).c as Json).items as Json).properties as Json;
  const thenProps = (s: Json) => ((s.allOf as Json[])[0].then as Json).properties as Json;

  it("passes an identical schema and one that only gained", () => {
    expect(schemaBreaks(mini(), mini())).toEqual([]);
    const grown = edit((s) => {
      props(s).f = { type: "string" };
      itemProps(s).h = { type: "number" };
      (itemProps(s).d as Json).enum = ["x", "y", "z"];
    });
    expect(schemaBreaks(mini(), grown)).toEqual([]);
  });

  it("fails a removed property, at any depth and inside a rule", () => {
    expect(schemaBreaks(mini(), edit((s) => void delete props(s).b))).toEqual(["removed: $.b"]);
    expect(schemaBreaks(mini(), edit((s) => void delete itemProps(s).d))).toContain("removed: $.c[].d");
    expect(schemaBreaks(mini(), edit((s) => void delete thenProps(s).e))).toEqual(["removed: $.e"]);
  });

  it("fails a retyped property, a narrowed or widened type", () => {
    expect(schemaBreaks(mini(), edit((s) => void (props(s).a = { type: "number" })))).toEqual(["retyped: $.a was string, now number"]);
    expect(schemaBreaks(mini(), edit((s) => void (props(s).b = { type: ["number", "string", "null"] })))[0]).toContain("retyped: $.b");
    expect(schemaBreaks(mini(), edit((s) => void (props(s).b = { type: "number" })))[0]).toContain("retyped: $.b");
  });

  it("fails a field that stopped being required, a dropped enum value and a changed const", () => {
    expect(schemaBreaks(mini(), edit((s) => void (s.required = [])))).toEqual(["no longer required: $.a"]);
    expect(schemaBreaks(mini(), edit((s) => void ((itemProps(s).d as Json).enum = ["x"])))).toEqual(['enum value removed: $.c[].d "y"']);
    expect(schemaBreaks(mini(), edit((s) => void ((itemProps(s).k as Json).const = "other")))).toEqual(['const changed: $.c[].k was "fixed"']);
  });

  it("does not mind rules being reordered", () => {
    expect(schemaBreaks(mini(), edit((s) => void (s.allOf = [...(s.allOf as Json[])].reverse())))).toEqual([]);
  });
});
