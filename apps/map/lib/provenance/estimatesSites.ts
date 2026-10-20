// Where provenance entries labelled "published" sit in source, found by reading the code and not by grepping it.
//
// estimates.ts judges an entry in a reply (any JSON). This judges the entry where it is written: every object
// literal with `kind: "published"` under apps/map/lib and apps/map/app, with the text of its `method`, so a
// published entry that says it computed its value fails a test before it ships, whether or not a fixture or a route
// test happens to reach it. provenance-kinds.test.ts walks the tree with it.
//
// What it reads: a small lexer that knows line and block comments, quoted strings, template literals (with their
// ${...} parts) and regex literals, so a brace or a quote inside text cannot hide an entry or move its edges. It
// finds each `kind: "published"` property, the object literal around it, and that object's top-level properties.
// What it cannot see, and the test says so: a published entry built by spreading another object (`...base`), a kind
// held in a variable, and a method that is not a literal (reported as methodIsDynamic, which the test refuses).
// Relative imports only, so a plain-Node script can load it (scripts/cite-load.mjs registers the resolve hook).

import { COMPUTED_METHOD } from "./estimates";

export interface PublishedSite {
  file: string;
  /** 1-based line of the `kind: "published"` property. */
  line: number;
  /** The id in `source("id")` when the object is the argument after it, else null. */
  sourceId: string | null;
  /** The text of a literal `method` (string, template without its ${...} parts, or literals joined by +); null when the object has none. */
  method: string | null;
  /** The object has a `method` that is not a plain literal (a variable, a property read, a call). */
  methodIsDynamic: boolean;
  /** The object names `inputs`: an entry that says what it was computed from. */
  hasInputs: boolean;
}

export interface SourceScan {
  /** Object literals with `kind: "published"`. */
  sites: PublishedSite[];
  /** `kind: "published"` in a type position (`kind: "published" | "estimate"`, an interface member): not an entry. */
  typeMembers: number;
}

interface Frame {
  open: string;
  start: number;
  commas: number[];
}

interface Hit {
  /** Index of the opening quote of "published". */
  at: number;
  /** Index of the `{` of the innermost brace around it, or -1. */
  object: number;
  /**
   * The first character after the string that is neither whitespace nor part of a comment, or "as" when a type
   * assertion (`as const`, `as T`, `satisfies T`) follows: only an expression can carry one, so the string is a value.
   */
  after: string;
}

interface Lexed {
  /** For each `{`: the index of its `}` and the commas between them that sit directly in it. */
  objects: Map<number, { end: number; commas: number[] }>;
  hits: Hit[];
}

/** After one of these words a `/` starts a regex, not a division. */
const REGEX_AFTER_WORD = new Set(["return", "typeof", "case", "in", "of", "delete", "void", "throw", "new", "else", "do", "yield", "await"]);
const REGEX_AFTER_CHAR = "(,=:[!&|?{};+-*%<>~^";
const isWordChar = (c: string) => /[A-Za-z0-9_$]/.test(c);
/** `as const`, `as T`, `satisfies T` after a value; not a type member that happens to be named `as` or `satisfies` (`as: string`, `as?: string`). */
const ASSERTION = /^(?:as|satisfies)\b(?!\s*[:?])/;

/**
 * What follows the value that ends at index k: the first character past whitespace and line and block comments, or
 * "as" when a type assertion follows. `kind: "published" as const,`, `kind: "published" satisfies Kind,` and a last
 * property with a trailing comment (`kind: "published" // note` then `}`) are entries; reading only the next
 * character filed all three as type members, where nothing judges them.
 */
function afterValue(src: string, from: number): string {
  const n = src.length;
  let k = from;
  while (k < n) {
    if (/\s/.test(src[k])) k++;
    else if (src.startsWith("//", k)) {
      const e = src.indexOf("\n", k);
      k = e < 0 ? n : e;
    } else if (src.startsWith("/*", k)) {
      const e = src.indexOf("*/", k + 2);
      k = e < 0 ? n : e + 2;
    } else break;
  }
  if (k >= n) return "";
  return ASSERTION.test(src.slice(k, k + 12)) ? "as" : src[k];
}

function lex(src: string): Lexed {
  const n = src.length;
  const objects = new Map<number, { end: number; commas: number[] }>();
  const hits: Hit[] = [];
  const stack: Frame[] = [];
  let i = 0;
  let prev = "";
  let prevWord = "";

  /** A quoted string from the quote at i; ends at the closing quote or the end of the line (an apostrophe in JSX text must not run on). */
  const skipQuoted = (q: string): void => {
    i++;
    while (i < n && src[i] !== q && src[i] !== "\n") {
      if (src[i] === "\\") i++;
      i++;
    }
    if (src[i] === q) i++;
  };

  const skipRegex = (): void => {
    i++;
    let inClass = false;
    while (i < n) {
      const c = src[i];
      if (c === "\n") return;
      if (c === "\\") i++;
      else if (c === "[") inClass = true;
      else if (c === "]") inClass = false;
      else if (c === "/" && !inClass) {
        i++;
        while (i < n && /[a-z]/.test(src[i])) i++;
        return;
      }
      i++;
    }
  };

  // Template text from just after the opening backtick; each ${ opens a code region that code() reads to its closing }.
  const template = (): void => {
    while (i < n) {
      const c = src[i];
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === "`") {
        i++;
        return;
      }
      if (c === "$" && src[i + 1] === "{") {
        stack.push({ open: "$", start: i, commas: [] });
        i += 2;
        code();
        continue;
      }
      i++;
    }
  };

  const code = (): void => {
    while (i < n) {
      const c = src[i];
      const d = src[i + 1];
      if (c === "/" && d === "/") {
        while (i < n && src[i] !== "\n") i++;
        continue;
      }
      if (c === "/" && d === "*") {
        const end = src.indexOf("*/", i + 2);
        i = end < 0 ? n : end + 2;
        continue;
      }
      if (c === '"' || c === "'") {
        const start = i;
        skipQuoted(c);
        const body = src.slice(start + 1, i - 1);
        if (body === "published" && /\bkind\s*:\s*$/.test(src.slice(Math.max(0, start - 40), start))) {
          const top = stack[stack.length - 1];
          hits.push({ at: start, object: top && top.open === "{" ? top.start : -1, after: afterValue(src, i) });
        }
        prev = c;
        prevWord = "";
        continue;
      }
      if (c === "`") {
        i++;
        template();
        prev = "`";
        prevWord = "";
        continue;
      }
      if (c === "/") {
        if (prev === "" || REGEX_AFTER_CHAR.includes(prev) || REGEX_AFTER_WORD.has(prevWord)) skipRegex();
        else i++;
        prev = "/";
        prevWord = "";
        continue;
      }
      if (c === "{" || c === "(" || c === "[") {
        stack.push({ open: c, start: i, commas: [] });
        i++;
        prev = c;
        prevWord = "";
        continue;
      }
      if (c === "}" || c === ")" || c === "]") {
        const top = stack.pop();
        i++;
        prev = c;
        prevWord = "";
        if (c === "}" && top && top.open === "$") return;
        if (c === "}" && top && top.open === "{") objects.set(top.start, { end: i - 1, commas: top.commas });
        continue;
      }
      if (c === ",") {
        const top = stack[stack.length - 1];
        if (top && top.open === "{") top.commas.push(i);
        i++;
        prev = c;
        prevWord = "";
        continue;
      }
      if (isWordChar(c)) {
        const start = i;
        while (i < n && isWordChar(src[i])) i++;
        prevWord = src.slice(start, i);
        prev = src[i - 1];
        continue;
      }
      if (!/\s/.test(c)) {
        prev = c;
        prevWord = "";
      }
      i++;
    }
  };

  code();
  return { objects, hits };
}

/** The text of a run of string and template literals joined by +, without any ${...} part; null when the expression is anything else. */
export function literalText(expr: string): string | null {
  let s = expr.trim();
  let out = "";
  for (;;) {
    const q = s[0];
    let end = -1;
    let text = "";
    if (q === '"' || q === "'") {
      let k = 1;
      while (k < s.length && s[k] !== q) k += s[k] === "\\" ? 2 : 1;
      if (k >= s.length) return null;
      text = s.slice(1, k);
      end = k + 1;
    } else if (q === "`") {
      let k = 1;
      let depth = 0;
      while (k < s.length) {
        const c = s[k];
        if (depth === 0 && c === "`") break;
        if (c === "\\") {
          k += 2;
          continue;
        }
        if (depth === 0 && c === "$" && s[k + 1] === "{") {
          depth = 1;
          k += 2;
          continue;
        }
        if (depth > 0) {
          if (c === "{") depth++;
          else if (c === "}") depth--;
        } else text += c;
        k++;
      }
      if (k >= s.length) return null;
      end = k + 1;
    } else return null;
    out += text;
    s = s.slice(end).trim();
    // a comment after the value, before the comma
    while (s.startsWith("//") || s.startsWith("/*")) {
      if (s.startsWith("//")) s = s.slice(s.indexOf("\n") < 0 ? s.length : s.indexOf("\n")).trim();
      else s = s.slice(s.indexOf("*/") < 0 ? s.length : s.indexOf("*/") + 2).trim();
    }
    if (s === "") return out;
    if (s[0] !== "+") return null;
    s = s.slice(1).trim();
  }
}

/** A property chunk of an object literal: its key and the expression after the colon, or null for a spread, a shorthand or a method. */
function property(chunk: string): { key: string; value: string } | null {
  let s = chunk.trim();
  // leading comments belong to the property after them
  while (s.startsWith("//") || s.startsWith("/*")) {
    if (s.startsWith("//")) s = s.slice(s.indexOf("\n") < 0 ? s.length : s.indexOf("\n")).trim();
    else s = s.slice(s.indexOf("*/") < 0 ? s.length : s.indexOf("*/") + 2).trim();
  }
  const m = /^(?:"([^"]+)"|'([^']+)'|([A-Za-z_$][\w$]*))\s*(:?)([\s\S]*)$/.exec(s);
  if (!m) return null;
  const key = m[1] ?? m[2] ?? m[3];
  if (m[4] !== ":") return m[5].trim() === "" ? { key, value: "" } : null;
  return { key, value: m[5].trim() };
}

/** Every `kind: "published"` in one source file, and how many more sit in type positions. */
export function scanSource(src: string, file = ""): SourceScan {
  const { objects, hits } = lex(src);
  const out: SourceScan = { sites: [], typeMembers: 0 };
  for (const h of hits) {
    if (h.after !== "," && h.after !== "}" && h.after !== "as") {
      out.typeMembers++;
      continue;
    }
    const obj = h.object >= 0 ? objects.get(h.object) : undefined;
    if (!obj) continue;
    // split the object's top-level properties at its own commas
    const bounds = [h.object, ...obj.commas, obj.end];
    let method: string | null = null;
    let methodIsDynamic = false;
    let hasInputs = false;
    for (let k = 0; k + 1 < bounds.length; k++) {
      const p = property(src.slice(bounds[k] + 1, bounds[k + 1]));
      if (!p) continue;
      if (p.key === "inputs") hasInputs = true;
      if (p.key === "method") {
        const text = literalText(p.value);
        if (text === null) methodIsDynamic = true;
        else method = text;
      }
    }
    const before = src.slice(Math.max(0, h.object - 120), h.object);
    const sid = /source\(\s*["'`]([^"'`]+)["'`]\s*\)\s*,\s*$/.exec(before);
    out.sites.push({ file, line: src.slice(0, h.at).split("\n").length, sourceId: sid ? sid[1] : null, method, methodIsDynamic, hasInputs });
  }
  return out;
}

/** Why a published site breaks the rule ("published = relayed as-is"), or null when it does not. */
export function judgeSite(s: PublishedSite): string | null {
  if (s.hasInputs) return "it names inputs, so it was computed from them and is not relayed as-is";
  if (s.methodIsDynamic) return "its method is not a literal, so the words in it cannot be read";
  if (s.method !== null && COMPUTED_METHOD.test(s.method)) return `its method says it was computed here: "${s.method.replace(/\s+/g, " ").slice(0, 110)}"`;
  return null;
}
