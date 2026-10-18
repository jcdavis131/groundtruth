import { describe, expect, it } from "vitest";
import { csvCell, csvColumns, csvComments, toCsv } from "./csv";

describe("csvCell", () => {
  it("leaves plain values alone and blanks null / undefined / NaN", () => {
    expect(csvCell("Travis")).toBe("Travis");
    expect(csvCell(42)).toBe("42");
    expect(csvCell(-1.5)).toBe("-1.5");
    expect(csvCell(true)).toBe("true");
    expect(csvCell(false)).toBe("false");
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(NaN)).toBe("");
    expect(csvCell(Infinity)).toBe("");
  });
  it("quotes commas, quotes and newlines per RFC 4180", () => {
    expect(csvCell("Austin, TX")).toBe('"Austin, TX"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("a\nb")).toBe('"a\nb"');
    expect(csvCell("a\r\nb")).toBe('"a\r\nb"');
  });
  it("serialises dates, arrays and objects so nothing is silently dropped", () => {
    expect(csvCell(new Date("2026-09-11T00:00:00Z"))).toBe("2026-09-11T00:00:00.000Z");
    expect(csvCell(["a", "b"])).toBe('"[""a"",""b""]"');
    expect(csvCell({ k: 1 })).toBe('"{""k"":1}"');
  });
});

describe("csvColumns", () => {
  it("uses the caller's list or the union of keys in first-seen order", () => {
    expect(csvColumns([{ b: 1, a: 2 }], ["a", "b"])).toEqual(["a", "b"]);
    expect(csvColumns([{ b: 1, a: 2 }, { c: 3, a: 1 }])).toEqual(["b", "a", "c"]);
    expect(csvColumns([])).toEqual([]);
  });
});

describe("toCsv", () => {
  it("writes a header, CRLF records and no trailing newline", () => {
    const out = toCsv([{ geoid: "48453", name: "Travis", v: 1 }, { geoid: "48029", name: "Bexar", v: null }]);
    expect(out).toBe("geoid,name,v\r\n48453,Travis,1\r\n48029,Bexar,");
  });
  it("honours the column order and blanks missing keys", () => {
    const out = toCsv([{ a: 1 }, { b: 2 }], ["b", "a", "z"]);
    expect(out).toBe("b,a,z\r\n,1,\r\n2,,");
  });
  it("quotes the header when a column name needs it", () => {
    expect(toCsv([{ "avg wage, weekly": 1 }])).toBe('"avg wage, weekly"\r\n1');
  });
  it("round-trips through the project's own RFC 4180 reader", async () => {
    const { parseCsv } = await import("@/lib/economy/csv");
    const rows = [{ name: 'Port "A", TX', v: "x\ny" }, { name: "plain", v: "" }];
    const parsed = parseCsv(toCsv(rows));
    expect(parsed[0]).toEqual(["name", "v"]);
    expect(parsed[1]).toEqual(['Port "A", TX', "x\ny"]);
    expect(parsed[2]).toEqual(["plain", ""]);
  });
  it("handles an empty table", () => {
    expect(toCsv([])).toBe("");
    expect(toCsv([], ["a"])).toBe("a");
  });
});

describe("csvComments", () => {
  it("prefixes each line with '# ' and collapses embedded newlines", () => {
    expect(csvComments(["one", "two\nlines"])).toBe("# one\r\n# two lines");
    expect(csvComments([])).toBe("");
  });
});
