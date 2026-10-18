import { describe, expect, it } from "vitest";
import { compileQuery, fieldsInQuery, formatQuery, MAX_LIMIT, MAX_QUERY_CHARS, parseQuery, queryFromJson, validateQuery, type Condition, type Group, type Query } from "./query";
import { fieldsFor } from "./fields";

const ok = (text: string): Query => {
  const r = parseQuery(text);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.query;
};
const bad = (text: string) => {
  const r = parseQuery(text);
  if (r.ok) throw new Error("expected a syntax error for: " + text);
  return r.errors[0];
};

describe("parseQuery", () => {
  it("parses the brief's example", () => {
    const q = ok("home.yoyPct>5 AND jobs.yoy.emp<0 SORT momentum DESC LIMIT 50");
    expect(q.where).toEqual([
      { field: "home.yoyPct", op: ">", value: 5 },
      { field: "jobs.yoy.emp", op: "<", value: 0 },
    ]);
    expect(q.sort).toEqual([{ field: "momentum", dir: "desc" }]);
    expect(q.limit).toBe(50);
    expect(q.offset).toBeUndefined();
  });

  it("accepts every comparison operator, = as ==, and negative and decimal numbers", () => {
    const q = ok("a >= 1.5 AND b <= -2 AND c == 3 AND d = 4 AND e != 5 AND f < 6e2");
    expect(q.where!.map((c) => [(c as Condition).op, (c as Condition).value])).toEqual([[">=", 1.5], ["<=", -2], ["==", 3], ["==", 4], ["!=", 5], ["<", 600]]);
  });

  it("gives AND precedence over OR and honours parentheses", () => {
    const q = ok("a > 1 OR b > 2 AND c > 3");
    expect(q.where).toHaveLength(1);
    const g = q.where![0] as Group;
    expect(g.or).toHaveLength(2);
    expect((g.or![0] as Condition).field).toBe("a");
    expect((g.or![1] as Group).and!.map((c) => (c as Condition).field)).toEqual(["b", "c"]);

    const p = ok("(a > 1 OR b > 2) AND c > 3");
    expect(p.where).toHaveLength(2);
    expect((p.where![0] as Group).or).toHaveLength(2);
    expect((p.where![1] as Condition).field).toBe("c");
  });

  it("quotes strings with double or single quotes, escapes, and bare words", () => {
    const q = ok(`name CONTAINS "New York" AND state == 'TX' AND metro == "Austin-Round Rock, TX" AND border != Canada AND x == "say \\"hi\\""`);
    const vals = q.where!.map((c) => (c as Condition).value);
    expect(vals).toEqual(["New York", "TX", "Austin-Round Rock, TX", "Canada", 'say "hi"']);
  });

  it("parses BETWEEN, IN and CONTAINS", () => {
    const q = ok("teu BETWEEN 1000 AND 5000 AND state IN (TX, 'CA', \"NY\") AND name CONTAINS port");
    expect(q.where).toEqual([
      { field: "teu", op: "between", value: [1000, 5000] },
      { field: "state", op: "in", value: ["TX", "CA", "NY"] },
      { field: "name", op: "contains", value: "port" },
    ]);
  });

  it("parses multi-key sorts, ORDER BY, default asc, LIMIT and OFFSET, and keywords in any case", () => {
    const q = ok("sort a desc, b, c ASC limit 10 offset 20");
    expect(q.where).toBeUndefined();
    expect(q.sort).toEqual([
      { field: "a", dir: "desc" },
      { field: "b", dir: "asc" },
      { field: "c", dir: "asc" },
    ]);
    expect(q.limit).toBe(10);
    expect(q.offset).toBe(20);
    expect(ok("ORDER BY a DESC").sort).toEqual([{ field: "a", dir: "desc" }]);
  });

  it("parses the empty query", () => {
    expect(ok("")).toEqual({});
    expect(ok("   ")).toEqual({});
  });

  it("reports syntax errors with a position", () => {
    expect(bad('name CONTAINS "open')).toMatchObject({ code: "syntax", message: "unterminated string", position: 14 });
    expect(bad("a > ")).toMatchObject({ code: "syntax", message: "value expected" });
    expect(bad("a 5")).toMatchObject({ code: "syntax" });
    expect(bad("a > 5 b > 6")).toMatchObject({ code: "syntax", position: 6 });
    expect(bad("(a > 5")).toMatchObject({ code: "syntax", message: '")" expected' });
    expect(bad("a IN 5")).toMatchObject({ code: "syntax" });
    expect(bad("a BETWEEN 1 2")).toMatchObject({ code: "syntax" });
    expect(bad("SORT")).toMatchObject({ code: "syntax", message: "field name expected after SORT" });
    expect(bad("LIMIT x")).toMatchObject({ code: "syntax", message: "number expected after LIMIT" });
    expect(bad("a > 5 AND")).toMatchObject({ code: "syntax" });
    expect(bad("a ! 5")).toMatchObject({ code: "syntax" });
    expect(bad("a > 5 $")).toMatchObject({ code: "syntax", position: 6 });
    expect(bad("AND > 5")).toMatchObject({ code: "syntax" });
  });

  it("rejects text longer than the cap without tokenizing it", () => {
    expect(bad("a > 1 AND ".repeat(400))).toMatchObject({ code: "too_long" });
    expect(MAX_QUERY_CHARS).toBe(2048);
  });

  it("never evaluates input: a value that looks like code stays a string", () => {
    const q = ok('name == "process.exit(1)"');
    expect((q.where![0] as Condition).value).toBe("process.exit(1)");
  });
});

describe("validateQuery", () => {
  const fields = fieldsFor("county");

  it("accepts the example against the county registry", () => {
    const r = compileQuery("home.yoyPct>5 AND jobs.yoy.emp<0 SORT momentum DESC LIMIT 50", fields);
    expect(r.ok).toBe(true);
  });

  it("names unknown fields in where and sort", () => {
    const r = compileQuery("nope > 1 SORT alsoNope", fields);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.map((e) => [e.code, e.field])).toEqual([
      ["unknown_field", "nope"],
      ["unknown_field", "alsoNope"],
    ]);
  });

  it("rejects numeric operators on text fields and contains on numeric fields", () => {
    const r = compileQuery("state > 1 AND home.latest CONTAINS x", fields);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.map((e) => e.code)).toEqual(["invalid_op", "invalid_op"]);
  });

  it("checks value shapes: between needs two numbers, in needs a list, > needs a number", () => {
    const r = validateQuery(
      {
        where: [
          { field: "home.latest", op: "between", value: [1] },
          { field: "state", op: "in", value: [] },
          { field: "home.latest", op: ">", value: "five" },
          { field: "state", op: "==", value: ["a", "b"] },
        ],
      },
      fields,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.map((e) => e.code)).toEqual(["invalid_value", "invalid_value", "invalid_value", "invalid_value"]);
  });

  it("clamps limit to the cap and floors offset; negatives are errors", () => {
    const r = validateQuery({ limit: 5000, offset: 3.7 }, fields);
    expect(r.ok && r.query.limit).toBe(MAX_LIMIT);
    expect(r.ok && r.query.offset).toBe(3);
    const neg = validateQuery({ limit: -1 }, fields);
    expect(neg.ok).toBe(false);
  });

  it("rejects an unknown op smuggled in through JSON", () => {
    const r = validateQuery({ where: [{ field: "home.latest", op: "~" as never, value: 1 }] }, fields);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0].code).toBe("invalid_op");
  });

  it("caps nesting depth", () => {
    const deep: Group = { or: [{ and: [{ or: [{ and: [{ field: "home.latest", op: ">", value: 1 }] }] }] }] };
    const r = validateQuery({ where: [deep] }, fields);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.code === "too_deep")).toBe(true);
  });
});

describe("queryFromJson", () => {
  it("accepts a well-formed body and normalizes sort direction", () => {
    const r = queryFromJson({ where: [{ field: "a", op: ">", value: 1 }, { or: [{ field: "b", op: "in", value: ["x", "y"] }] }], sort: [{ field: "a", dir: "DESC" }], limit: 10 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.query.sort).toEqual([{ field: "a", dir: "asc" }]);
    expect(r.query.limit).toBe(10);
  });

  it("rejects wrong shapes with paths", () => {
    const r = queryFromJson({ where: [{ field: 1 }, { field: "a", op: "like", value: 1 }, { field: "a", op: ">", value: { x: 1 } }, { nope: [] }, "str"], sort: "a", limit: "10" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.map((e) => e.code)).toEqual(["invalid_shape", "invalid_op", "invalid_value", "invalid_shape", "invalid_shape", "invalid_shape", "invalid_limit"]);
    expect(r.errors[0].message).toContain("where[0]");
    expect(queryFromJson(null).ok).toBe(false);
    expect(queryFromJson([]).ok).toBe(false);
  });

  it("rejects groups nested past the cap", () => {
    const r = queryFromJson({ where: [{ or: [{ and: [{ or: [{ field: "a", op: ">", value: 1 }] }] }] }] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0].code).toBe("too_deep");
  });
});

describe("formatQuery", () => {
  const cases = [
    "home.yoyPct > 5 AND jobs.yoy.emp < 0 SORT momentum DESC LIMIT 50",
    '(state == TX OR state == CA) AND name CONTAINS "New York" SORT home.latest DESC, name ASC LIMIT 10 OFFSET 20',
    "teu BETWEEN 1000 AND 5000 AND size IN (large, medium)",
    "a > 1 OR b > 2 AND c > 3",
    'metro == "Austin-Round Rock, TX"',
  ];
  it.each(cases)("round-trips %s", (text) => {
    const q = ok(text);
    const printed = formatQuery(q);
    expect(ok(printed)).toEqual(q);
  });
  it("quotes values that would otherwise read as keywords or contain spaces", () => {
    expect(formatQuery({ where: [{ field: "a", op: "==", value: "and" }] })).toBe('a == "and"');
    expect(formatQuery({ where: [{ field: "a", op: "==", value: "two words" }] })).toBe('a == "two words"');
  });
});

describe("fieldsInQuery", () => {
  it("lists every field once, where first then sort", () => {
    const q = ok("a > 1 AND (b < 2 OR a > 3) SORT c DESC, a");
    expect(fieldsInQuery(q)).toEqual(["a", "b", "c"]);
  });
});
