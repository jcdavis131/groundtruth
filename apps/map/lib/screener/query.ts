// The screener's filter / sort language. Two equivalent forms:
//
//   JSON    { where: [{ field: "home.yoyPct", op: ">", value: 5 },
//                     { or: [{ field: "state", op: "==", value: "TX" }, ...] }],
//             sort: [{ field: "momentum", dir: "desc" }], limit: 50, offset: 0 }
//
//   string  home.yoyPct > 5 AND jobs.yoy.emp < 0 SORT momentum DESC LIMIT 50
//
// The string form is a hand-written tokenizer and recursive-descent parser
// (no eval, no RegExp built from input) so it is safe to accept from a URL.
// AND binds tighter than OR; parentheses group. `where` entries are ANDed;
// a group `{ or: [...] }` / `{ and: [...] }` may hold conditions or further
// groups up to MAX_DEPTH, which is what the grammar can produce.
//
// Validation is separate from parsing: parse() only knows the grammar,
// validate() knows the field registry, so a query can be checked against a
// different entity kind without re-parsing.

import type { FieldDef, FieldKind } from "./fields";

/** What validation needs to know about a field: works with FieldDef on the server and FieldMeta in the browser. */
export type FieldLike = Pick<FieldDef, "key" | "kind">;

export type Op = ">" | ">=" | "<" | "<=" | "==" | "!=" | "between" | "in" | "contains";
export const OPS: Op[] = [">", ">=", "<", "<=", "==", "!=", "between", "in", "contains"];

export type Scalar = number | string;

export interface Condition {
  field: string;
  op: Op;
  /** A scalar for comparison ops, [lo, hi] for between, a list for in. */
  value: Scalar | Scalar[];
}

export interface Group {
  and?: Clause[];
  or?: Clause[];
}

export type Clause = Condition | Group;

export interface SortKey {
  field: string;
  dir: "asc" | "desc";
}

export interface Query {
  where?: Clause[];
  sort?: SortKey[];
  limit?: number;
  offset?: number;
}

export interface QueryError {
  code: "syntax" | "unknown_field" | "invalid_op" | "invalid_value" | "too_deep" | "too_long" | "invalid_limit" | "invalid_shape";
  message: string;
  field?: string;
  /** Character offset in the string form when known. */
  position?: number;
}

export type ParseResult = { ok: true; query: Query } | { ok: false; errors: QueryError[] };

export const MAX_QUERY_CHARS = 2048;
export const MAX_LIMIT = 1000;
export const MAX_DEPTH = 3;
export const MAX_CLAUSES = 64;

export function isCondition(c: Clause): c is Condition {
  return typeof (c as Condition).field === "string";
}

// ---------------------------------------------------------------- tokenizer

type Tok =
  | { t: "ident"; v: string; pos: number }
  | { t: "num"; v: number; pos: number }
  | { t: "str"; v: string; pos: number }
  | { t: "op"; v: string; pos: number }
  | { t: "punct"; v: "(" | ")" | ","; pos: number }
  | { t: "end"; pos: number };

const KEYWORDS = new Set(["AND", "OR", "SORT", "ORDER", "BY", "ASC", "DESC", "LIMIT", "OFFSET", "BETWEEN", "IN", "CONTAINS", "NOT"]);

class SyntaxError_ extends Error {
  constructor(
    message: string,
    public readonly position: number,
  ) {
    super(message);
  }
}

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }
    const pos = i;
    if (ch === "(" || ch === ")" || ch === ",") {
      out.push({ t: "punct", v: ch, pos });
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      let v = "";
      let closed = false;
      while (j < n) {
        const c = src[j];
        if (c === "\\" && j + 1 < n) {
          v += src[j + 1];
          j += 2;
          continue;
        }
        if (c === ch) {
          closed = true;
          j++;
          break;
        }
        v += c;
        j++;
      }
      if (!closed) throw new SyntaxError_("unterminated string", pos);
      out.push({ t: "str", v, pos });
      i = j;
      continue;
    }
    if (ch === ">" || ch === "<" || ch === "=" || ch === "!") {
      const two = src.slice(i, i + 2);
      if (two === ">=" || two === "<=" || two === "==" || two === "!=") {
        out.push({ t: "op", v: two, pos });
        i += 2;
        continue;
      }
      if (ch === ">" || ch === "<" || ch === "=") {
        out.push({ t: "op", v: ch === "=" ? "==" : ch, pos });
        i++;
        continue;
      }
      throw new SyntaxError_(`unexpected "${ch}"`, pos);
    }
    // Numbers: optional sign only when the previous token cannot end a value,
    // so "a>-5" works and "a-5" is still an error rather than "a" then "-5".
    if (/[0-9]/.test(ch) || ((ch === "-" || ch === "+") && /[0-9.]/.test(src[i + 1] ?? "") && !endsValue(out))) {
      let j = i + 1;
      while (j < n && /[0-9._eE+-]/.test(src[j])) {
        // Stop at a sign that is not part of an exponent.
        if ((src[j] === "+" || src[j] === "-") && !/[eE]/.test(src[j - 1])) break;
        j++;
      }
      const raw = src.slice(i, j).replace(/_/g, "");
      const v = Number(raw);
      if (!Number.isFinite(v)) throw new SyntaxError_(`bad number "${src.slice(i, j)}"`, pos);
      out.push({ t: "num", v, pos });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_.\-]/.test(src[j])) j++;
      out.push({ t: "ident", v: src.slice(i, j), pos });
      i = j;
      continue;
    }
    throw new SyntaxError_(`unexpected "${ch}"`, pos);
  }
  out.push({ t: "end", pos: n });
  return out;
}

function endsValue(toks: Tok[]): boolean {
  const last = toks[toks.length - 1];
  return !!last && (last.t === "num" || last.t === "str" || (last.t === "punct" && last.v === ")"));
}

function isKw(tok: Tok, kw: string): boolean {
  return tok.t === "ident" && tok.v.toUpperCase() === kw;
}

// ---------------------------------------------------------------- parser

class Parser {
  private i = 0;
  constructor(private readonly toks: Tok[]) {}

  private peek(): Tok {
    return this.toks[this.i];
  }
  private next(): Tok {
    return this.toks[this.i++];
  }
  private atTail(): boolean {
    const t = this.peek();
    return t.t === "end" || isKw(t, "SORT") || isKw(t, "ORDER") || isKw(t, "LIMIT") || isKw(t, "OFFSET");
  }

  parse(): Query {
    const q: Query = {};
    if (!this.atTail()) {
      const where = this.orExpr();
      // A top-level OR stays one group; a top-level AND flattens into the list.
      q.where = isCondition(where) ? [where] : where.and ? where.and : [where];
    }
    if (isKw(this.peek(), "SORT") || isKw(this.peek(), "ORDER")) {
      this.next();
      if (isKw(this.peek(), "BY")) this.next();
      q.sort = [];
      for (;;) {
        const f = this.next();
        if (f.t !== "ident" || KEYWORDS.has(f.v.toUpperCase())) throw new SyntaxError_("field name expected after SORT", f.pos);
        let dir: SortKey["dir"] = "asc";
        if (isKw(this.peek(), "ASC") || isKw(this.peek(), "DESC")) dir = this.next().t === "ident" && isKw(this.toks[this.i - 1], "DESC") ? "desc" : "asc";
        q.sort.push({ field: f.v, dir });
        const sep = this.peek();
        if (sep.t === "punct" && sep.v === ",") {
          this.next();
          continue;
        }
        break;
      }
    }
    if (isKw(this.peek(), "LIMIT")) {
      this.next();
      const t = this.next();
      if (t.t !== "num") throw new SyntaxError_("number expected after LIMIT", t.pos);
      q.limit = t.v;
    }
    if (isKw(this.peek(), "OFFSET")) {
      this.next();
      const t = this.next();
      if (t.t !== "num") throw new SyntaxError_("number expected after OFFSET", t.pos);
      q.offset = t.v;
    }
    const end = this.peek();
    if (end.t !== "end") throw new SyntaxError_(`unexpected "${end.t === "punct" || end.t === "op" || end.t === "ident" ? end.v : end.t}"`, end.pos);
    return q;
  }

  private orExpr(): Clause {
    const parts: Clause[] = [this.andExpr()];
    while (isKw(this.peek(), "OR")) {
      this.next();
      parts.push(this.andExpr());
    }
    return parts.length === 1 ? parts[0] : { or: parts };
  }

  private andExpr(): Clause {
    const parts: Clause[] = [this.term()];
    while (isKw(this.peek(), "AND")) {
      this.next();
      parts.push(this.term());
    }
    return parts.length === 1 ? parts[0] : { and: parts };
  }

  private term(): Clause {
    const t = this.peek();
    if (t.t === "punct" && t.v === "(") {
      this.next();
      const inner = this.orExpr();
      const close = this.next();
      if (close.t !== "punct" || close.v !== ")") throw new SyntaxError_('")" expected', close.pos);
      return inner;
    }
    return this.condition();
  }

  private condition(): Condition {
    const f = this.next();
    if (f.t !== "ident" || KEYWORDS.has(f.v.toUpperCase())) throw new SyntaxError_("field name expected", f.pos);
    const o = this.next();
    if (o.t === "op") {
      const v = this.scalar();
      return { field: f.v, op: o.v as Op, value: v };
    }
    if (isKw(o, "BETWEEN")) {
      const lo = this.scalar();
      if (!isKw(this.peek(), "AND")) throw new SyntaxError_("AND expected in BETWEEN", this.peek().pos);
      this.next();
      const hi = this.scalar();
      return { field: f.v, op: "between", value: [lo, hi] };
    }
    if (isKw(o, "IN")) {
      const open = this.next();
      if (open.t !== "punct" || open.v !== "(") throw new SyntaxError_('"(" expected after IN', open.pos);
      const list: Scalar[] = [];
      for (;;) {
        list.push(this.scalar());
        const sep = this.next();
        if (sep.t === "punct" && sep.v === ",") continue;
        if (sep.t === "punct" && sep.v === ")") break;
        throw new SyntaxError_('"," or ")" expected in IN list', sep.pos);
      }
      return { field: f.v, op: "in", value: list };
    }
    if (isKw(o, "CONTAINS")) {
      const v = this.scalar();
      return { field: f.v, op: "contains", value: String(v) };
    }
    throw new SyntaxError_("operator expected (> >= < <= == != BETWEEN IN CONTAINS)", o.pos);
  }

  private scalar(): Scalar {
    const t = this.next();
    if (t.t === "num") return t.v;
    if (t.t === "str") return t.v;
    // Bare words are strings ("state == TX"); keywords are not values.
    if (t.t === "ident" && !KEYWORDS.has(t.v.toUpperCase())) return t.v;
    throw new SyntaxError_("value expected", t.pos);
  }
}

/** Parse the compact string form. Never throws; syntax errors come back structured with a position. */
export function parseQuery(text: string): ParseResult {
  if (text.length > MAX_QUERY_CHARS) return { ok: false, errors: [{ code: "too_long", message: `query longer than ${MAX_QUERY_CHARS} characters` }] };
  try {
    const q = new Parser(tokenize(text)).parse();
    return { ok: true, query: q };
  } catch (err) {
    if (err instanceof SyntaxError_) return { ok: false, errors: [{ code: "syntax", message: err.message, position: err.position }] };
    throw err;
  }
}

// ---------------------------------------------------------------- JSON form

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isScalar(v: unknown): v is Scalar {
  return (typeof v === "number" && Number.isFinite(v)) || typeof v === "string";
}

/** Check that an untrusted JSON value has the Query shape (fields are checked later by validateQuery). */
export function queryFromJson(input: unknown): ParseResult {
  const errors: QueryError[] = [];
  if (!isPlainObject(input)) return { ok: false, errors: [{ code: "invalid_shape", message: "query must be an object" }] };
  const q: Query = {};
  let count = 0;
  const clause = (c: unknown, depth: number, path: string): Clause | null => {
    if (++count > MAX_CLAUSES) {
      errors.push({ code: "too_deep", message: `more than ${MAX_CLAUSES} clauses` });
      return null;
    }
    if (!isPlainObject(c)) {
      errors.push({ code: "invalid_shape", message: `${path}: clause must be an object` });
      return null;
    }
    if ("field" in c) {
      const { field, op, value } = c;
      if (typeof field !== "string" || !field) {
        errors.push({ code: "invalid_shape", message: `${path}.field must be a string` });
        return null;
      }
      if (typeof op !== "string" || !(OPS as string[]).includes(op)) {
        errors.push({ code: "invalid_op", message: `${path}.op "${String(op)}" is not one of ${OPS.join(" ")}`, field });
        return null;
      }
      if (Array.isArray(value) ? !value.every(isScalar) : !isScalar(value)) {
        errors.push({ code: "invalid_value", message: `${path}.value must be a number, a string or a list of them`, field });
        return null;
      }
      return { field, op: op as Op, value: value as Scalar | Scalar[] };
    }
    if (depth >= MAX_DEPTH) {
      errors.push({ code: "too_deep", message: `${path}: groups nest deeper than ${MAX_DEPTH}` });
      return null;
    }
    const key = "or" in c ? "or" : "and" in c ? "and" : null;
    if (!key || !Array.isArray(c[key])) {
      errors.push({ code: "invalid_shape", message: `${path}: expected { field, op, value } or { and: [...] } / { or: [...] }` });
      return null;
    }
    const kids = (c[key] as unknown[]).map((k, i) => clause(k, depth + 1, `${path}.${key}[${i}]`)).filter((x): x is Clause => !!x);
    return key === "or" ? { or: kids } : { and: kids };
  };
  if (input.where != null) {
    if (!Array.isArray(input.where)) errors.push({ code: "invalid_shape", message: "where must be an array" });
    else q.where = input.where.map((c, i) => clause(c, 1, `where[${i}]`)).filter((x): x is Clause => !!x);
  }
  if (input.sort != null) {
    if (!Array.isArray(input.sort)) errors.push({ code: "invalid_shape", message: "sort must be an array" });
    else {
      q.sort = [];
      input.sort.forEach((s, i) => {
        if (!isPlainObject(s) || typeof s.field !== "string") errors.push({ code: "invalid_shape", message: `sort[${i}] needs a field` });
        else q.sort!.push({ field: s.field, dir: s.dir === "desc" ? "desc" : "asc" });
      });
    }
  }
  for (const k of ["limit", "offset"] as const) {
    const v = input[k];
    if (v == null) continue;
    if (typeof v !== "number" || !Number.isFinite(v)) errors.push({ code: "invalid_limit", message: `${k} must be a number` });
    else q[k] = v;
  }
  return errors.length ? { ok: false, errors } : { ok: true, query: q };
}

// ---------------------------------------------------------------- validation

const NUMERIC: FieldKind[] = ["number", "pct", "estimate"];
const NUMERIC_OPS: Op[] = [">", ">=", "<", "<=", "between"];

/**
 * Check a parsed query against a field registry: every field exists, every
 * op fits the field's kind, limit and offset are sane. Returns a normalized
 * copy (limit clamped, offset floored) or the list of problems.
 */
export function validateQuery(q: Query, fields: FieldLike[]): ParseResult {
  const errors: QueryError[] = [];
  const byKey = new Map(fields.map((f) => [f.key, f]));
  let count = 0;
  const check = (c: Clause, depth: number) => {
    if (++count > MAX_CLAUSES) {
      if (count === MAX_CLAUSES + 1) errors.push({ code: "too_deep", message: `more than ${MAX_CLAUSES} clauses` });
      return;
    }
    if (isCondition(c)) {
      const f = byKey.get(c.field);
      if (!f) {
        errors.push({ code: "unknown_field", message: `unknown field "${c.field}"`, field: c.field });
        return;
      }
      if (!(OPS as string[]).includes(c.op)) {
        errors.push({ code: "invalid_op", message: `"${c.op}" is not an operator`, field: c.field });
        return;
      }
      const numeric = NUMERIC.includes(f.kind);
      if (NUMERIC_OPS.includes(c.op) && !numeric) errors.push({ code: "invalid_op", message: `"${c.op}" needs a numeric field; "${c.field}" is text`, field: c.field });
      if (c.op === "contains" && numeric) errors.push({ code: "invalid_op", message: `contains needs a text field; "${c.field}" is numeric`, field: c.field });
      if (c.op === "between") {
        if (!Array.isArray(c.value) || c.value.length !== 2 || !c.value.every((v) => typeof v === "number"))
          errors.push({ code: "invalid_value", message: `between needs two numbers for "${c.field}"`, field: c.field });
      } else if (c.op === "in") {
        if (!Array.isArray(c.value) || c.value.length === 0) errors.push({ code: "invalid_value", message: `in needs a non-empty list for "${c.field}"`, field: c.field });
      } else if (Array.isArray(c.value)) {
        errors.push({ code: "invalid_value", message: `"${c.op}" takes one value for "${c.field}"`, field: c.field });
      } else if (NUMERIC_OPS.includes(c.op) && typeof c.value !== "number") {
        errors.push({ code: "invalid_value", message: `"${c.op}" needs a number for "${c.field}"`, field: c.field });
      }
      return;
    }
    if (depth > MAX_DEPTH) {
      errors.push({ code: "too_deep", message: `groups nest deeper than ${MAX_DEPTH}` });
      return;
    }
    for (const k of c.and ?? c.or ?? []) check(k, depth + 1);
  };
  for (const c of q.where ?? []) check(c, 1);
  for (const s of q.sort ?? []) {
    if (!byKey.has(s.field)) errors.push({ code: "unknown_field", message: `unknown sort field "${s.field}"`, field: s.field });
    if (s.dir !== "asc" && s.dir !== "desc") errors.push({ code: "invalid_shape", message: `sort direction must be asc or desc`, field: s.field });
  }
  if (q.limit != null && (!Number.isFinite(q.limit) || q.limit < 0)) errors.push({ code: "invalid_limit", message: "limit must be a non-negative number" });
  if (q.offset != null && (!Number.isFinite(q.offset) || q.offset < 0)) errors.push({ code: "invalid_limit", message: "offset must be a non-negative number" });
  if (errors.length) return { ok: false, errors };
  const out: Query = { ...q };
  if (out.limit != null) out.limit = Math.min(MAX_LIMIT, Math.floor(out.limit));
  if (out.offset != null) out.offset = Math.floor(out.offset);
  return { ok: true, query: out };
}

/** Parse the string form and validate it against a registry in one step. */
export function compileQuery(text: string, fields: FieldLike[]): ParseResult {
  const p = parseQuery(text);
  return p.ok ? validateQuery(p.query, fields) : p;
}

// ---------------------------------------------------------------- printing

function quote(v: Scalar): string {
  if (typeof v === "number") return String(v);
  return /^[A-Za-z_][A-Za-z0-9_.\-]*$/.test(v) && !KEYWORDS.has(v.toUpperCase()) ? v : `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function printClause(c: Clause, parent: "and" | "or" | null): string {
  if (isCondition(c)) {
    if (c.op === "between" && Array.isArray(c.value)) return `${c.field} BETWEEN ${quote(c.value[0])} AND ${quote(c.value[1])}`;
    if (c.op === "in") return `${c.field} IN (${(Array.isArray(c.value) ? c.value : [c.value]).map(quote).join(", ")})`;
    if (c.op === "contains") return `${c.field} CONTAINS ${quote(Array.isArray(c.value) ? String(c.value[0]) : c.value)}`;
    return `${c.field} ${c.op} ${quote(Array.isArray(c.value) ? c.value[0] : c.value)}`;
  }
  const key = c.or ? "or" : "and";
  const kids = (c.or ?? c.and ?? []).map((k) => printClause(k, key));
  if (kids.length === 0) return "";
  const body = kids.filter(Boolean).join(key === "or" ? " OR " : " AND ");
  // An OR inside an AND needs parentheses; an AND inside an OR does not, but they read better with them.
  return parent && key !== parent ? `(${body})` : body;
}

/** The compact string form of a query, parseable back with parseQuery. */
export function formatQuery(q: Query): string {
  const parts: string[] = [];
  const where = (q.where ?? []).map((c) => printClause(c, "and")).filter(Boolean);
  if (where.length) parts.push(where.join(" AND "));
  if (q.sort?.length) parts.push("SORT " + q.sort.map((s) => `${s.field} ${s.dir.toUpperCase()}`).join(", "));
  if (q.limit != null) parts.push(`LIMIT ${q.limit}`);
  if (q.offset != null && q.offset > 0) parts.push(`OFFSET ${q.offset}`);
  return parts.join(" ");
}

/** Every field a query reads, in first-use order. */
export function fieldsInQuery(q: Query): string[] {
  const out: string[] = [];
  const add = (k: string) => {
    if (!out.includes(k)) out.push(k);
  };
  const walk = (c: Clause) => {
    if (isCondition(c)) add(c.field);
    else for (const k of c.and ?? c.or ?? []) walk(k);
  };
  for (const c of q.where ?? []) walk(c);
  for (const s of q.sort ?? []) add(s.field);
  return out;
}
