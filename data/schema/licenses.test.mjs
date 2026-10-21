// Tests for data/LICENSES.md: one row per publisher, each with the terms URL(s) it was read from, what the publisher's
// own page grants (a quote of under 25 words, or that the page states no licence, or that no terms page was found), and
// what we grant on top (nothing). Plain Node, no install, no network.
//   node data/schema/licenses.test.mjs
// data/schema/validate.test.mjs runs this file, so the data.yml "schema and fixture tests" step does too.
//
// The checker is in this file on purpose: the rule is the table's shape and its coverage of data/manifests, and a
// reader should see both in one place. Nothing here fetches a page. data/licenses.lock.json holds what
// data/pipeline/licenses_fetch.py found when it did (status, bytes, sha256, and whether each quote was on the page);
// these tests hold LICENSES.md to that lock, and the lock's own fetch is by hand, not in CI.
//
// What "covered" means. A manifest names its source by id (sources[].sourceId) and not by publisher, so
// SOURCE_PUBLISHERS below is the one place the id is tied to a publisher. For every (collection, source id) in
// data/manifests, the row of that source's publisher must exist and must name the collection in its Collections cell.
// A row naming a collection in that cell for a source it does not publish fails (the Census Bureau is not the source of
// a collection because the county join uses its boundaries: that goes under "Also used for"). A publisher that a
// manifest's joins[].boundary names must have a row that names the collection under "Also used for".
//
// The files the Hugging Face dataset ships that no manifest lists (the companies file: SEC and Census) are held by
// shipped file. data/hf/publish.py's EXTRA_FILES says what is shipped; EXTRA_FILE_PUBLISHERS below says whose data each
// file is drawn from; for every publisher of every shipped file, a row must exist and name the file under "Also used
// for". A shipped file with no line in EXTRA_FILE_PUBLISHERS fails, and so does a line for a file no longer shipped.
// publish.py is Python, so EXTRA_FILES is read by scanning its one `EXTRA_FILES = [...]` statement (extraFilesOf), not by
// importing the file. The scan fails by name, rather than reading an empty list, when that statement is not a list of
// plain quoted strings ending its line (or a comment), or when the name is assigned or changed again anywhere in the file.
// It does not follow the list under another name (an alias, plan()'s extra argument, globals()) or see another module
// change it: a scan of one statement, not a proof of what is shipped.
//
// A "what they grant" statement that says the service's copyrightText is empty (the USACE FeatureServer row) is held to
// the lock: the lock entry must record copyrightText as the empty string, which licenses_fetch.py reads off the response.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "..");
const MANIFESTS = path.join(ROOT, "data", "manifests");
const LICENSES = path.join(ROOT, "data", "LICENSES.md");
const LOCK = path.join(ROOT, "data", "licenses.lock.json");
const HF_README = path.join(ROOT, "data", "hf", "README.md");
const PIPELINE_MD = path.join(ROOT, "data", "PIPELINE.md");
const SERVER_TS = path.join(ROOT, "apps", "map", "lib", "mcp", "server.ts");
const MCP_MD = path.join(ROOT, "apps", "map", "docs", "MCP.md");
const PUBLISH_PY = path.join(ROOT, "data", "hf", "publish.py");

/** Cam's open decision (board cam_asks licence-line): the line is written as given, with a plain apostrophe. */
export const COMPILATION_LINE =
  "Compilation licence: not yet chosen (Cam decides; until then the bundle carries no licence of its own and each record stays under its publisher's terms)";
export const LICENSES_URL = "https://github.com/jcdavis131/groundtruth/blob/master/data/LICENSES.md";
const ON_TOP = "nothing beyond their terms";

/**
 * A manifest's sources[].sourceId -> words the Publisher cell of its row must contain. The manifests carry the id and
 * the licence string and no publisher name, so this is where the link is made. A source id with no entry here fails,
 * naming its collection: a new source needs a line here and a row in data/LICENSES.md.
 */
export const SOURCE_PUBLISHERS = {
  "usace-nid": "U.S. Army Corps of Engineers",
  "nces-edge-public": "National Center for Education Statistics",
  "nps-nrhp": "National Park Service",
};

/**
 * A file the Hugging Face dataset ships that no manifest lists (EXTRA_FILES in data/hf/publish.py, a path relative to the
 * data root) -> words the Publisher cell of each row that must name it contains: the publishers whose data the file is
 * drawn from. For each of them a row must exist and name the file under "Also used for". A file in EXTRA_FILES with no
 * line here fails, naming the file: a new shipped file needs a line here and a row. Not keyed to the card's prose list.
 */
export const EXTRA_FILE_PUBLISHERS = {
  "companies/companies.full.2026-10-20.us-placed.json": ["U.S. Securities and Exchange Commission", "U.S. Census Bureau"],
};

// One space or hyphen, in the spellings a page or a paste produces: any whitespace (the no-break space included), any
// hyphen or dash (U+2010 to U+2015, the non-breaking hyphen U+2011 among them) and the minus sign (U+2212). Built from
// character codes and never typed: the mojibake guard reads every tracked text file.
const code = (n) => String.fromCharCode(n);
/** A string with every character outside printable ASCII written as <U+XXXX>, so a no-break space shows in a failure line. */
const visible = (s) => s.replace(/[^\x20-\x7e]/g, (c) => `<U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}>`);
const SEP = `[\\s${code(0xa0)}${code(0x2010)}-${code(0x2015)}${code(0x2212)}-]`;
/**
 * Names of licences. A "what they grant" cell may carry one only inside the quote the lock found on the page (a page
 * may say "public domain"); a remark after the quote, or the words of a stated absence, may not. Word-bounded and
 * case-insensitive, so "(MIT)", "cc-by-sa", "CC-0" and "Public-Domain" are seen and "permit" and "submitted" are not.
 * Where the name has a space or a hyphen, SEP stands for it, so a no-break space or a non-breaking hyphen does not slip
 * a name past. A list, not a proof: a name this list does not know passes.
 */
export const LICENCE_NAMES = new RegExp(
  `\\b(?:CC${SEP}*0|CC${SEP}*BY|Creative${SEP}+Commons|MIT|Apache|ODbL|ODC|Open${SEP}+Data${SEP}+(?:Commons|Licen[cs]e)|Open${SEP}+Government${SEP}+Licen[cs]e|OGL|A?L?GPL|BSD|MPL|Mozilla${SEP}+Public|PDDL|Unlicense|Public${SEP}+Domain|ISC|EUPL|WTFPL|Zlib)\\b`,
  "i",
);
const licenceName = (s) => LICENCE_NAMES.exec(s)?.[0] ?? null;

let passed = 0;
let failed = 0;
const check = (ok, msg, detail = "") => {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  licenses: ${msg}${!ok && detail ? `\n      ${detail}` : ""}`);
};
/** Runs fn; it returns true, or a string saying what was wrong. A throw is a failure with the message as detail. */
const attempt = (msg, fn) => {
  try {
    const r = fn();
    check(r === true, msg, typeof r === "string" ? r : "");
  } catch (e) {
    check(false, msg, String(e?.message ?? e));
  }
};

// ---------------------------------------------------------------- the checker

const COLUMNS = ["publisher", "collections", "also used for", "terms url", "what they grant", "what we grant on top", "retrieved"];
const entries = (cell) => cell.split(/<br\s*\/?>/i).map((s) => s.trim()).filter(Boolean);
const words = (s) => s.trim().split(/\s+/).filter(Boolean).length;
const ticked = (cell) => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);

/** The table's rows, by header name. Returns { rows, problems }. */
export function parseTable(md) {
  const problems = [];
  const lines = md.split(/\r?\n/);
  const at = lines.findIndex((l) => /^\|/.test(l) && /publisher/i.test(l) && /terms url/i.test(l));
  if (at < 0) return { rows: [], problems: ["no table with Publisher and Terms URL columns"] };
  const split = (l) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
  const head = split(lines[at]).map((h) => h.toLowerCase());
  const col = Object.fromEntries(COLUMNS.map((c) => [c, head.indexOf(c)]));
  for (const c of COLUMNS) if (col[c] < 0) problems.push(`the table has no "${c}" column`);
  if (problems.length) return { rows: [], problems };
  const rows = [];
  for (let i = at + 2; i < lines.length && /^\|/.test(lines[i]); i++) {
    const cells = split(lines[i]);
    if (cells.length !== head.length) {
      problems.push(`row ${i - at - 1} has ${cells.length} cells, the header has ${head.length} (a "|" inside a cell?)`);
      continue;
    }
    rows.push({
      publisher: cells[col.publisher],
      collectionsCell: cells[col.collections],
      collections: ticked(cells[col.collections]),
      alsoCell: cells[col["also used for"]],
      also: ticked(cells[col["also used for"]]),
      urls: entries(cells[col["terms url"]]),
      grants: entries(cells[col["what they grant"]]),
      onTop: cells[col["what we grant on top"]],
      retrieved: cells[col.retrieved],
    });
  }
  return { rows, problems };
}

/**
 * What data/manifests says, read from every manifest: { collections, sources: [{ collection, sourceId }],
 * joins: [{ collection, publisher }], problems }. A collection is a folder; its sources are the union of the
 * sources[].sourceId of its manifests, its joins the union of joins[].boundary.publisher.
 */
export function manifestFacts(dir) {
  const collections = [];
  const sources = new Map();
  const joins = new Map();
  const problems = [];
  const folders = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  for (const name of folders) {
    collections.push(name);
    const files = readdirSync(path.join(dir, name)).filter((f) => f.endsWith(".json")).sort();
    if (files.length === 0) problems.push(`licenses: collection ${name} has no manifest`);
    let seen = 0;
    for (const f of files) {
      const m = JSON.parse(readFileSync(path.join(dir, name, f), "utf8"));
      for (const s of m.sources ?? []) {
        if (typeof s?.sourceId !== "string" || !s.sourceId) problems.push(`licenses: ${name}/${f} has a sources[] entry with no sourceId`);
        else {
          seen++;
          sources.set(`${name}\n${s.sourceId}`, { collection: name, sourceId: s.sourceId });
        }
      }
      for (const j of m.joins ?? []) {
        const p = j?.boundary?.publisher;
        if (typeof p !== "string" || !p) problems.push(`licenses: ${name}/${f} has a joins[] entry with no boundary.publisher`);
        else joins.set(`${name}\n${p}`, { collection: name, publisher: p });
      }
    }
    if (files.length > 0 && seen === 0) problems.push(`licenses: collection ${name}: no manifest names a source, so no row can be required for it`);
  }
  return { collections, sources: [...sources.values()], joins: [...joins.values()], problems };
}

/** Each source of each collection has its publisher's row, which names the collection; and no row names one it does not publish. */
export function sourceProblems(rows, facts, sourcePublishers = SOURCE_PUBLISHERS) {
  const out = [];
  for (const { collection, sourceId } of facts.sources) {
    const name = sourcePublishers[sourceId];
    if (!name) {
      out.push(`licenses: collection ${collection}: its source ${sourceId} has no publisher in SOURCE_PUBLISHERS (data/schema/licenses.test.mjs), so no row can be required for it`);
      continue;
    }
    const theirs = rows.filter((r) => r.publisher.includes(name));
    if (theirs.length === 0) out.push(`licenses: collection ${collection} has no publisher row: no row is for ${name}, the publisher of its source ${sourceId}`);
    else if (!theirs.some((r) => r.collections.includes(collection))) out.push(`licenses: collection ${collection} is not named in the Collections cell of the ${name} row, the publisher of its source ${sourceId}`);
  }
  for (const r of rows) {
    for (const c of r.collections) {
      const ids = facts.sources.filter((s) => s.collection === c).map((s) => s.sourceId);
      if (!ids.some((id) => sourcePublishers[id] && r.publisher.includes(sourcePublishers[id]))) {
        out.push(`licenses: ${r.publisher || "(row with no publisher)"} names ${c} in its Collections cell, but it publishes no source of ${c}; a join or another use goes under "Also used for"`);
      }
    }
  }
  return out;
}

/** A publisher a manifest's joins[].boundary names has a row, and the row names the collection under "Also used for". */
export function joinProblems(rows, facts) {
  const out = [];
  for (const { collection, publisher } of facts.joins) {
    const theirs = rows.filter((r) => r.publisher.includes(publisher));
    if (theirs.length === 0) out.push(`licenses: ${publisher} has no publisher row, and joins[].boundary of a ${collection} manifest names it`);
    else if (!theirs.some((r) => r.also.includes(collection))) out.push(`licenses: the row for ${publisher} does not name ${collection} under "Also used for", and joins[].boundary of a ${collection} manifest names that publisher`);
  }
  return out;
}

// Where the name is assigned or changed in place, anywhere on a line: the name, then = or an augmented assignment, a
// method call or a subscript. == is not one, and neither is a plain read (in EXTRA_FILES, = EXTRA_FILES, len(EXTRA_FILES)).
const CHANGES_EXTRA_FILES = /\bEXTRA_FILES\b[ \t]*(?:(?:\/\/|\*\*|<<|>>|[-+*\/%&|^@])?=(?!=)|\.|\[)/g;

/** Whether idx sits after a # on its line (a # inside quotes does not count). */
function inComment(src, idx) {
  let quote = "";
  for (const ch of src.slice(src.lastIndexOf("\n", idx - 1) + 1, idx)) {
    if (quote) {
      if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "#") return true;
  }
  return false;
}

/**
 * The strings of EXTRA_FILES in data/hf/publish.py: { files, problems }. publish.py is Python, so this scans one statement
 * and does not import the file. It takes a single `EXTRA_FILES = [...]` (a type annotation is fine) whose list holds only
 * plain quoted strings and whose closing "]" is followed by nothing but blanks or a # comment to the end of its line. It
 * fails, naming the problem and returning no files, so that a reformat of publish.py cannot make the check read an empty
 * list and pass, on: no such statement; a right-hand side that is not a list; inside the list a string with an escape, a
 * line break or triple quotes, an f-string, a name, a comprehension, a stray comma or an unclosed list; anything after the
 * closing "]" (+, *, a method call, a subscript, ";" or a line continuation); and the name assigned or changed again
 * anywhere (a second assignment, +=, .extend(...) or another method call or subscript, at any indentation, after an
 * "if x:" or after a ";"). It does not see: the list reached under another name (an alias, plan()'s extra argument,
 * globals(), setattr, exec), another module changing it, or code that ships a file without naming EXTRA_FILES.
 */
export function extraFilesOf(py) {
  const none = { files: [], problems: [] };
  const fail = (m) => ({ ...none, problems: [`licenses: ${m}`] });
  const starts = [...py.matchAll(/^[ \t]*EXTRA_FILES\b/gm)];
  if (starts.length === 0) return fail("data/hf/publish.py has no EXTRA_FILES assignment, so the files the Hugging Face dataset ships beyond the manifests cannot be read");
  const changes = [...py.matchAll(CHANGES_EXTRA_FILES)].filter((m) => !inComment(py, m.index));
  if (starts.length > 1 || changes.length > 1) return fail("EXTRA_FILES in data/hf/publish.py is assigned more than once or changed in place (a second assignment, +=, .extend(...) or another method call, at any indentation, after an if x: or after a ;), so its files cannot be read as one list literal");
  const head = /^[ \t]*EXTRA_FILES[ \t]*(?::[^=\n]+)?=\s*\[/m.exec(py);
  if (!head) return fail("EXTRA_FILES in data/hf/publish.py is not a list literal (EXTRA_FILES = [...]), so its files cannot be read");
  const bad = (why) => fail(`EXTRA_FILES in data/hf/publish.py is not a plain list of string literals (${why}), so the files the Hugging Face dataset ships cannot be read`);
  const files = [];
  let i = head.index + head[0].length;
  let comma = false; // a string was just read, so a comma or the end must come next
  while (i < py.length) {
    const c = py[i];
    if (c === "]") {
      const eol = py.indexOf("\n", i);
      const rest = py.slice(i + 1, eol < 0 ? py.length : eol).replace(/\r$/, "");
      if (!/^[ \t]*(?:#[^\n]*)?$/.test(rest)) return bad(`the closing "]" is followed by "${visible([...rest].find((x) => x !== " " && x !== "\t"))}" instead of the end of the line or a comment`);
      return { files, problems: [] };
    }
    if (/\s/.test(c)) i++;
    else if (c === "#") while (i < py.length && py[i] !== "\n") i++;
    else if (c === ",") {
      if (!comma) return bad("a stray comma");
      comma = false;
      i++;
    } else if (c === '"' || c === "'") {
      if (comma) return bad("two strings with no comma between them");
      const end = py.indexOf(c, i + 1);
      const text = end < 0 ? "" : py.slice(i + 1, end);
      if (end < 0 || /[\\\n]/.test(text) || py.startsWith(c.repeat(3), i)) return bad("a string with an escape, a line break or triple quotes");
      files.push(text);
      comma = true;
      i = end + 1;
    } else return bad(`unexpected "${c}"`);
  }
  return bad("the list is not closed");
}

/**
 * Every file data/hf/publish.py ships beyond the manifests (EXTRA_FILES, read as `shipped`) has a line in
 * EXTRA_FILE_PUBLISHERS, and every publisher on that line has a row that names the file under "Also used for". A line for
 * a file that is no longer shipped fails too, so the constant cannot go stale.
 */
export function extraFileProblems(rows, shipped, publishers = EXTRA_FILE_PUBLISHERS) {
  const out = [];
  for (const file of shipped) {
    const names = publishers[file];
    if (!names?.length) {
      out.push(`licenses: data/hf/publish.py ships ${file} (EXTRA_FILES) and EXTRA_FILE_PUBLISHERS (data/schema/licenses.test.mjs) has no publisher for it, so no row can be required for it`);
      continue;
    }
    for (const name of names) {
      const theirs = rows.filter((r) => r.publisher.includes(name));
      if (theirs.length === 0) out.push(`licenses: ${name} has no publisher row, and data/hf/publish.py ships ${file} (EXTRA_FILES), which EXTRA_FILE_PUBLISHERS says is drawn from it`);
      else if (!theirs.some((r) => r.also.includes(file))) out.push(`licenses: the row for ${name} does not name ${file} under "Also used for", and data/hf/publish.py ships that file (EXTRA_FILES), which EXTRA_FILE_PUBLISHERS says is drawn from that publisher`);
    }
  }
  for (const file of Object.keys(publishers)) {
    if (!shipped.includes(file)) out.push(`licenses: EXTRA_FILE_PUBLISHERS names ${file}, which data/hf/publish.py's EXTRA_FILES does not ship; drop the line`);
  }
  return out;
}

/**
 * Everything wrong with a licences table, its lock and the manifests it must cover; empty when they agree. facts.shipped,
 * when present, is the files data/hf/publish.py ships beyond the manifests (extraFilesOf), held by extraFilePublishers.
 */
export function licenseProblems(md, facts, lock, sourcePublishers = SOURCE_PUBLISHERS, extraFilePublishers = EXTRA_FILE_PUBLISHERS) {
  const out = [];
  const { rows, problems } = parseTable(md);
  out.push(...problems.map((p) => `licenses: ${p}`));
  out.push(...(facts.problems ?? []));
  if (!md.includes(COMPILATION_LINE)) out.push(`licenses: the compilation licence line is missing or reworded ("${COMPILATION_LINE.slice(0, 60)}...")`);
  const seen = new Set();
  const byUrl = new Map((lock?.fetches ?? []).map((f) => [f.url, f]));
  for (const r of rows) {
    const who = r.publisher || "(row with no publisher)";
    if (!r.publisher) out.push("licenses: a row has no publisher");
    if (seen.has(r.publisher)) out.push(`licenses: ${who} is listed twice`);
    seen.add(r.publisher);
    if (r.collections.length === 0 && !/^none\b/i.test(r.collectionsCell)) out.push(`licenses: ${who}: the Collections cell names no collection and does not say "none"`);
    if (!r.alsoCell) out.push(`licenses: ${who}: "Also used for" is empty; say what else the publisher is used for, or "nothing"`);
    if (r.urls.length === 0) out.push(`licenses: ${who} has no terms URL`);
    for (const u of r.urls) {
      if (/^http:\/\//i.test(u)) out.push(`licenses: ${who}: terms URL is not https: ${u}`);
      else if (!/^https:\/\/[^\s<>]+$/.test(u)) out.push(`licenses: ${who}: terms URL is not a plain https URL: ${u}`);
    }
    if (r.grants.length !== r.urls.length) out.push(`licenses: ${who} has ${r.urls.length} terms URL(s) and ${r.grants.length} statement(s) of what they grant; one each, in the same order`);
    if (r.onTop !== ON_TOP) out.push(`licenses: ${who}: what we grant on top must read "${ON_TOP}", not "${r.onTop}"`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.retrieved)) out.push(`licenses: ${who}: retrieved is not a YYYY-MM-DD day: ${r.retrieved}`);
    r.urls.forEach((u, i) => {
      const g = r.grants[i];
      if (g === undefined) return;
      const f = byUrl.get(u);
      if (!f) out.push(`licenses: ${who}: ${u} has no entry in data/licenses.lock.json`);
      else {
        if (f.status !== 200) out.push(`licenses: ${who}: ${u} was last fetched with status ${f.status}, not 200`);
        if (!/^[0-9a-f]{64}$/.test(f.sha256 ?? "") || !(f.bytes > 0)) out.push(`licenses: ${who}: ${u} has no sha256 and byte count in the lock`);
        if (f.retrievedAt?.slice(0, 10) !== r.retrieved) out.push(`licenses: ${who}: retrieved ${r.retrieved} is not the lock's fetch day ${f.retrievedAt?.slice(0, 10)} for ${u}`);
      }
      const q = /^"([^"]+)"/.exec(g);
      const absence = /^(terms page states no licence|no terms page found)/.test(g);
      if (q) {
        if (words(q[1]) >= 25) out.push(`licenses: ${who}: the quote for ${u} is ${words(q[1])} words; under 25`);
        if (f && (f.kind !== "quote" || f.quote !== q[1] || f.quoteFound !== true)) out.push(`licenses: ${who}: the quote for ${u} is not the one the lock found on the page`);
      } else if (absence) {
        if (f && (f.kind !== "no-licence" || f.matches !== 0)) out.push(`licenses: ${who}: the lock does not show ${u} free of licence words`);
      } else {
        out.push(`licenses: ${who}: what they grant for ${u} is none of: a quote in double quotes, "terms page states no licence", "no terms page found" (${g.slice(0, 50)})`);
      }
      // A licence name no page gave is never written. Only the quote the lock found may carry one (a page can say
      // "public domain"); what follows the quote, or follows the words of a stated absence, may not.
      const outside = q ? g.slice(q[0].length) : g;
      const named = q || absence ? licenceName(outside) : null;
      if (named) out.push(`licenses: ${who}: the statement for ${u} names a licence ("${visible(named)}") outside the quote the lock found; a licence name no page gave is never written`);
      // "the service's copyrightText is empty" is a claim about the response, so the lock must hold it: the fetcher reads
      // the field off the response, and --check reads it again.
      if (f && /copyrightText\s+is\s+empty/i.test(g) && f.copyrightText !== "") {
        const what = f.copyrightText === undefined ? "the entry has no copyrightText" : `it has ${JSON.stringify(f.copyrightText)}`;
        out.push(`licenses: ${who}: the statement for ${u} says the service's copyrightText is empty, but the lock does not record copyrightText as the empty string (${what})`);
      }
    });
  }
  out.push(...sourceProblems(rows, facts, sourcePublishers));
  out.push(...joinProblems(rows, facts));
  if (Array.isArray(facts.shipped)) out.push(...extraFileProblems(rows, facts.shipped, extraFilePublishers));
  const cited = new Set(rows.flatMap((r) => r.urls));
  for (const f of lock?.fetches ?? []) if (!cited.has(f.url)) out.push(`licenses: ${f.url} is in the lock but in no row`);
  return out;
}

// ---------------------------------------------------------------- fixtures (made-up names; nothing here is fetched)
const HEADER = "| Publisher | Collections | Also used for | Terms URL | What they grant | What we grant on top | Retrieved |\n|---|---|---|---|---|---|---|\n";
const Q = "Alpha data may be reused by anyone for any purpose";
const QP = "Everything on this site is in the public domain";
const row = (o = {}) => {
  const r = { publisher: "Alpha Agency", collections: "`alpha-things`", also: "nothing", urls: "https://example.org/alpha/terms", grants: `"${Q}"`, onTop: ON_TOP, retrieved: "2026-10-21", ...o };
  return `| ${r.publisher} | ${r.collections} | ${r.also} | ${r.urls} | ${r.grants} | ${r.onTop} | ${r.retrieved} |\n`;
};
const table = (...rows) => `# Licences\n\n${COMPILATION_LINE}\n\n${HEADER}${rows.join("")}`;
const fetched = (url, o = {}) => ({ url, kind: "quote", status: 200, bytes: 1234, sha256: "a".repeat(64), retrievedAt: "2026-10-21T05:00:00.000Z", quote: Q, quoteFound: true, quoteWords: words(Q), ...o });
const absent = (url, o = {}) => fetched(url, { kind: "no-licence", matches: 0, textChars: 400, quote: undefined, quoteFound: undefined, quoteWords: undefined, ...o });
const lockOf = (...fs) => ({ schemaVersion: "licenses-lock/1", fetches: fs });
const ALPHA = "https://example.org/alpha/terms";
const BETA = "https://example.org/beta/terms";
const GAMMA = "https://example.org/gamma/terms";
const goodLock = () => lockOf(fetched(ALPHA));
/** Fixture facts: sources are [collection, sourceId] pairs, joins are [collection, publisher] pairs. */
const facts = (sources, joins = []) => ({
  collections: [...new Set(sources.map((s) => s[0]))],
  sources: sources.map(([collection, sourceId]) => ({ collection, sourceId })),
  joins: joins.map(([collection, publisher]) => ({ collection, publisher })),
  problems: [],
});
const FIX_PUBLISHERS = { "alpha-src": "Alpha Agency", "beta-src": "Beta Bureau" };
const F_ALPHA = facts([["alpha-things", "alpha-src"]]);
/** licenseProblems with the fixtures' own source -> publisher table and the fixtures' own shipped-file -> publishers table. */
const problemsOf = (md, f, lock, sp = FIX_PUBLISHERS, xp = XPUB) => licenseProblems(md, f, lock, sp, xp);
const show = (errs) => (errs.length > 6 ? `${errs.slice(0, 6).join("; ")}; and ${errs.length - 6} more` : errs.join("; ") || "no problems");
const has = (errs, re) => errs.some((e) => re.test(e));
// A collection with two sources and two publishers, and a third publisher whose boundaries it joins (the Census shape).
const SHARED = facts([["shared-things", "alpha-src"], ["shared-things", "beta-src"]]);
const betaShared = (o = {}) => row({ publisher: "Beta Bureau", collections: "`shared-things`", urls: BETA, ...o });
const SHARED_LOCK = lockOf(fetched(ALPHA), fetched(BETA));
const JOINED = facts([["alpha-things", "alpha-src"]], [["alpha-things", "Gamma Bureau"]]);
const gammaRow = (o = {}) => row({ publisher: "Gamma Bureau", collections: "none", also: "the join of `alpha-things`", urls: GAMMA, ...o });
const JOINED_LOCK = lockOf(fetched(ALPHA), fetched(GAMMA));
// A file the Hugging Face dataset ships that no manifest lists (the SEC and Census shape): two publishers draw on it, and
// facts.shipped is what data/hf/publish.py's EXTRA_FILES says. Non-ASCII characters are built, never typed (the mojibake
// guard reads every tracked text file).
const XFILE = "extras/alpha-full.json";
const DELTA = "https://example.org/delta/terms";
const XPUB = { [XFILE]: ["Gamma Bureau", "Delta Office"] };
const F_X = { ...F_ALPHA, shipped: [XFILE] };
const alsoFile = "the file `" + XFILE + "`";
const gammaX = (o = {}) => gammaRow({ also: alsoFile, ...o });
const deltaX = (o = {}) => row({ publisher: "Delta Office", collections: "none", also: alsoFile, urls: DELTA, ...o });
const X_LOCK = lockOf(fetched(ALPHA), fetched(GAMMA), fetched(DELTA));
const NBSP = String.fromCharCode(0xa0);
const NBHY = String.fromCharCode(0x2011);
const ENDASH = String.fromCharCode(0x2013);

// ---------------------------------------------------------------- the rules, one fixture each
attempt("a faithful table (one row per publisher, https terms URLs, a quote or a stated absence for each, nothing granted on top) passes", () => {
  const beta = row({
    publisher: "Beta Bureau",
    collections: "`beta-things`",
    urls: `${BETA}<br>https://example.org/beta/data?f=json`,
    grants: `"${Q}" (said of the Beta site)<br>terms page states no licence: the service's copyrightText is empty`,
  });
  const lock = lockOf(fetched(ALPHA), fetched(BETA), absent("https://example.org/beta/data?f=json", { copyrightText: "" }), fetched(GAMMA));
  const f = facts([["alpha-things", "alpha-src"], ["beta-things", "beta-src"]], [["alpha-things", "Gamma Bureau"]]);
  const errs = problemsOf(table(row(), beta, gammaRow()), f, lock);
  return errs.length === 0 ? true : show(errs);
});
attempt("a manifest collection whose source's publisher has no row fails, naming the collection", () => {
  const f = facts([["alpha-things", "alpha-src"], ["beta-things", "beta-src"]]);
  const errs = problemsOf(table(row()), f, goodLock());
  return has(errs, /collection beta-things has no publisher row: no row is for Beta Bureau, the publisher of its source beta-src/) ? true : show(errs);
});
attempt("a second row that names the same collection does not stand in for the source publisher's row: dropping it fails, naming the collection and its source", () => {
  const both = problemsOf(table(row({ collections: "`shared-things`" }), betaShared()), SHARED, SHARED_LOCK);
  const noAlpha = problemsOf(table(betaShared()), SHARED, lockOf(fetched(BETA)));
  const noBeta = problemsOf(table(row({ collections: "`shared-things`" })), SHARED, lockOf(fetched(ALPHA)));
  return both.length === 0 && has(noAlpha, /collection shared-things has no publisher row: no row is for Alpha Agency, the publisher of its source alpha-src/) && has(noBeta, /collection shared-things has no publisher row: no row is for Beta Bureau, the publisher of its source beta-src/)
    ? true
    : `both rows: ${show(both)}; Alpha dropped: ${show(noAlpha)}; Beta dropped: ${show(noBeta)}`;
});
attempt("a join publisher's row that also names the collection does not stand in for the source publisher's row: dropping the source's row fails, naming the collection", () => {
  const withAlpha = problemsOf(table(row(), gammaRow()), JOINED, JOINED_LOCK);
  const noAlpha = problemsOf(table(gammaRow()), JOINED, lockOf(fetched(GAMMA)));
  return withAlpha.length === 0 && has(noAlpha, /collection alpha-things has no publisher row: no row is for Alpha Agency/) ? true : `with Alpha: ${show(withAlpha)}; Alpha dropped: ${show(noAlpha)}`;
});
attempt("a row that names a collection in its Collections cell without publishing a source of it fails, naming the row and the collection", () => {
  // The old shape of the Census row: the join publisher backticked every collection it joins. Dropping Alpha's row then passed.
  const old = problemsOf(table(row(), gammaRow({ collections: "`alpha-things`" })), JOINED, JOINED_LOCK);
  const oldNoAlpha = problemsOf(table(gammaRow({ collections: "`alpha-things`" })), JOINED, lockOf(fetched(GAMMA)));
  const typo = problemsOf(table(row({ collections: "`alpha-things`, `alpha-thing`" })), F_ALPHA, goodLock());
  return has(old, /Gamma Bureau names alpha-things in its Collections cell, but it publishes no source of alpha-things/) &&
    has(oldNoAlpha, /collection alpha-things has no publisher row: no row is for Alpha Agency/) &&
    has(typo, /Alpha Agency names alpha-thing in its Collections cell/)
    ? true
    : `old shape: ${show(old)}; old shape, Alpha dropped: ${show(oldNoAlpha)}; typo: ${show(typo)}`;
});
attempt("a source id that SOURCE_PUBLISHERS does not know fails, naming the collection and the source", () => {
  const errs = problemsOf(table(row()), facts([["alpha-things", "alpha-src"], ["alpha-things", "mystery-src"]]), goodLock());
  return has(errs, /collection alpha-things: its source mystery-src has no publisher in SOURCE_PUBLISHERS/) ? true : show(errs);
});
attempt("a publisher that a manifest's joins name fails when it has no row, or when its row does not name the collection under Also used for", () => {
  const noRow = problemsOf(table(row()), JOINED, goodLock());
  const notNamed = problemsOf(table(row(), gammaRow({ also: "nothing" })), JOINED, JOINED_LOCK);
  return has(noRow, /Gamma Bureau has no publisher row, and joins\[\]\.boundary of a alpha-things manifest names it/) &&
    has(notNamed, /the row for Gamma Bureau does not name alpha-things under "Also used for"/)
    ? true
    : `no row: ${show(noRow)}; not named: ${show(notNamed)}`;
});
attempt("a row with no collection must say none, and every row says what it is also used for", () => {
  const blank = problemsOf(table(row(), gammaRow({ collections: "" })), JOINED, JOINED_LOCK);
  const noneOk = problemsOf(table(row(), gammaRow({ collections: "none (not the source of a collection)" })), JOINED, JOINED_LOCK);
  const noAlso = problemsOf(table(row({ also: "" })), F_ALPHA, goodLock());
  return has(blank, /Gamma Bureau: the Collections cell names no collection and does not say "none"/) && noneOk.length === 0 && has(noAlso, /Alpha Agency: "Also used for" is empty/)
    ? true
    : `blank: ${show(blank)}; none: ${show(noneOk)}; empty also: ${show(noAlso)}`;
});
attempt("a faithful table with a shipped file that two publishers are drawn from (rows naming it under Also used for) passes", () => {
  const errs = problemsOf(table(row(), gammaX(), deltaX()), F_X, X_LOCK);
  return errs.length === 0 ? true : show(errs);
});
attempt("a publisher of a shipped file whose row is gone fails, naming the file and the publisher (the SEC row dropped with its lock entry)", () => {
  const noDelta = problemsOf(table(row(), gammaX()), F_X, lockOf(fetched(ALPHA), fetched(GAMMA)));
  const noGamma = problemsOf(table(row(), deltaX()), F_X, lockOf(fetched(ALPHA), fetched(DELTA)));
  return has(noDelta, /Delta Office has no publisher row, and data\/hf\/publish\.py ships extras\/alpha-full\.json/) &&
    has(noGamma, /Gamma Bureau has no publisher row, and data\/hf\/publish\.py ships extras\/alpha-full\.json/)
    ? true
    : `Delta dropped: ${show(noDelta)}; Gamma dropped: ${show(noGamma)}`;
});
attempt("a publisher's row that does not name the shipped file under Also used for fails, naming the file and the publisher, and another row naming it does not stand in", () => {
  const blank = problemsOf(table(row(), gammaX(), deltaX({ also: "nothing" })), F_X, X_LOCK);
  const elsewhere = problemsOf(table(row(), gammaX(), deltaX({ also: "the file `extras/other.json`" })), F_X, X_LOCK);
  const inCollections = problemsOf(table(row(), gammaX(), deltaX({ collections: "`" + XFILE + "`", also: "nothing" })), F_X, X_LOCK);
  const re = /the row for Delta Office does not name extras\/alpha-full\.json under "Also used for", and data\/hf\/publish\.py ships that file/;
  return has(blank, re) && has(elsewhere, re) && has(inCollections, re) ? true : `blank: ${show(blank)}; other file: ${show(elsewhere)}; in Collections: ${show(inCollections)}`;
});
attempt("a file data/hf/publish.py ships that EXTRA_FILE_PUBLISHERS has no line for fails, naming the file; so does a line for a file it no longer ships", () => {
  const unknown = problemsOf(table(row(), gammaX(), deltaX()), { ...F_ALPHA, shipped: [XFILE, "extras/beta-full.json"] }, X_LOCK);
  const stale = problemsOf(table(row(), gammaX(), deltaX()), { ...F_ALPHA, shipped: [] }, X_LOCK);
  return has(unknown, /data\/hf\/publish\.py ships extras\/beta-full\.json \(EXTRA_FILES\) and EXTRA_FILE_PUBLISHERS .* has no publisher for it/) &&
    has(stale, /EXTRA_FILE_PUBLISHERS names extras\/alpha-full\.json, which data\/hf\/publish\.py's EXTRA_FILES does not ship/)
    ? true
    : `unknown file: ${show(unknown)}; stale line: ${show(stale)}`;
});
attempt("manifestFacts reads sources and joins from every manifest of a collection,and reports a source with no sourceId, a join with no publisher and a collection that names no source", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "licenses-test-"));
  try {
    const put = (c, f, o) => {
      mkdirSync(path.join(dir, c), { recursive: true });
      writeFileSync(path.join(dir, c, f), JSON.stringify(o));
    };
    put("a-things", "a.1.json", { sources: [{ sourceId: "a-src" }] });
    put("a-things", "a.2.json", { sources: [{ sourceId: "a-src" }, { sourceId: "a-src-2" }], joins: [{ boundary: { publisher: "Gamma Bureau" } }] });
    put("b-things", "b.1.json", { sources: [{ licence: "x" }] });
    put("c-things", "c.1.json", { sources: [] });
    put("d-things", "d.1.json", { sources: [{ sourceId: "d-src" }], joins: [{ boundary: {} }] });
    const f = manifestFacts(dir);
    const ids = f.sources.map((s) => `${s.collection}/${s.sourceId}`).sort().join(" ");
    const js = f.joins.map((j) => `${j.collection}/${j.publisher}`).join(" ");
    const ps = f.problems.join("; ");
    const ok = ids === "a-things/a-src a-things/a-src-2 d-things/d-src" && js === "a-things/Gamma Bureau" && f.problems.length === 4 &&
      /b-things\/b\.1\.json has a sources\[\] entry with no sourceId/.test(ps) && /collection b-things: no manifest names a source/.test(ps) &&
      /collection c-things: no manifest names a source/.test(ps) && /d-things\/d\.1\.json has a joins\[\] entry with no boundary\.publisher/.test(ps);
    return ok ? true : `sources ${ids}; joins ${js}; problems ${ps}`;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
attempt("extraFilesOf reads EXTRA_FILES from publish.py's literal (one line, many lines with comments, single quotes, a type annotation) and fails by name on the shapes it does not take (no assignment, a tuple, a name, an f-string, an escape, triple quotes, a stray comma, an unclosed list, a second assignment)", () => {
  const good = [
    ['x = 1\nEXTRA_FILES = ["a/b.json"]\ny = 2\n', "a/b.json"],
    ["EXTRA_FILES: list[str] = [\n    \"a/b.json\",  # the companies file ]\n    'c/d.json',\n]\n", "a/b.json c/d.json"],
    ["EXTRA_FILES = []\n", ""],
  ];
  const bad = [
    ["x = 1\n", /has no EXTRA_FILES assignment/],
    ['EXTRA_FILES = ("a.json",)\n', /is not a list literal/],
    ['EXTRA_FILES = ["a.json"]\nEXTRA_FILES += ["b.json"]\n', /assigned more than once/],
    ['EXTRA_FILES = ["a" + ".json"]\n', /not a plain list of string literals \(unexpected "\+"\)/],
    ['EXTRA_FILES = ["a" "b"]\n', /two strings with no comma/],
    ['EXTRA_FILES = [f"a/{x}.json"]\n', /unexpected "f"/],
    ["EXTRA_FILES = [OTHER]\n", /unexpected "O"/],
    ['EXTRA_FILES = [p for p in ["a"]]\n', /unexpected "p"/],
    ['EXTRA_FILES = ["a\\\\b"]\n', /an escape, a line break or triple quotes/],
    ['EXTRA_FILES = ["""a"""]\n', /an escape, a line break or triple quotes/],
    ['EXTRA_FILES = [,"a"]\n', /a stray comma/],
    ['EXTRA_FILES = ["a.json",\n', /the list is not closed/],
  ];
  const wrong = [];
  for (const [py, want] of good) {
    const r = extraFilesOf(py);
    if (r.problems.length || r.files.join(" ") !== want) wrong.push(`${JSON.stringify(py.slice(0, 40))}: ${r.files.join(" ")} ${r.problems.join(";")}`);
  }
  for (const [py, re] of bad) {
    const r = extraFilesOf(py);
    if (r.files.length || !re.test(r.problems.join(";"))) wrong.push(`${JSON.stringify(py.slice(0, 40))} should fail ${re}: ${r.files.join(" ")} ${r.problems.join(";") || "no problem"}`);
  }
  return wrong.length === 0 ? true : wrong.join(" | ");
});
attempt("extraFilesOf fails by name when the closing bracket is followed by anything but a comment (+, *, a call, a subscript, ;, a line continuation) or EXTRA_FILES is assigned or changed again (indented, after if x: or after ;), and still reads a trailing comment, trailing blanks, CRLF and plain reads of the name", () => {
  const good = [
    ['EXTRA_FILES = ["a"]  # the companies file, not + ["b"] and not EXTRA_FILES += x\n', "a"],
    ['EXTRA_FILES = ["a"]   \t \n', "a"],
    ['EXTRA_FILES = ["a"]\r\nx = 1\r\n', "a"],
    ['EXTRA_FILES = ["a"]', "a"],
    ["# EXTRA_FILES.extend(x) is not a change\nEXTRA_FILES = [\n    \"a\",\n    \"b\",\n]  # end\n", "a b"],
    ['EXTRA_FILES = ["a"]\ndef plan(\n    extra: list[str] = EXTRA_FILES,\n):\n    for f in EXTRA_FILES:\n        print(f, len(EXTRA_FILES))\n', "a"],
  ];
  const trailing = [
    ['EXTRA_FILES = ["a"] + ["b"]\n', /closing "\]" is followed by "\+"/],
    ['EXTRA_FILES = ["a"] + OTHER\n', /closing "\]" is followed by "\+"/],
    ['EXTRA_FILES = ["a"] * 2\n', /closing "\]" is followed by "\*"/],
    ['EXTRA_FILES = ["a"].copy()\n', /closing "\]" is followed by "\."/],
    ['EXTRA_FILES = ["a"] if X else []\n', /closing "\]" is followed by "i"/],
    ['EXTRA_FILES = ["a"][0:1]\n', /closing "\]" is followed by "\["/],
    ['EXTRA_FILES = ["a"]; x = 1\n', /closing "\]" is followed by ";"/],
    ['EXTRA_FILES = ["a"] \\\n    + ["b"]\n', /closing "\]" is followed by "\\"/],
    ['EXTRA_FILES = [\n    "a",\n] + ["b"]\n', /closing "\]" is followed by "\+"/],
    ['EXTRA_FILES = ["a"] + ["b"]', /closing "\]" is followed by "\+"/],
  ];
  const again = [
    'EXTRA_FILES = ["a"]\nif cond:\n    EXTRA_FILES += ["b"]\n',
    'EXTRA_FILES = ["a"]\nif cond:\n    EXTRA_FILES.extend(["b"])\n',
    'EXTRA_FILES = ["a"]\nif cond:\n\tEXTRA_FILES.append("b")\n',
    'EXTRA_FILES = ["a"]\nif cond: EXTRA_FILES += ["b"]\n',
    'EXTRA_FILES = ["a"]\nx = 1; EXTRA_FILES.append("b")\n',
    'EXTRA_FILES = ["a"]; EXTRA_FILES += ["b"]\n',
    'EXTRA_FILES = ["a"]\nEXTRA_FILES = ["b"]\n',
    'EXTRA_FILES = ["a"]\nEXTRA_FILES[:] = ["b"]\n',
  ];
  const wrong = [];
  for (const [py, want] of good) {
    const r = extraFilesOf(py);
    if (r.problems.length || r.files.join(" ") !== want) wrong.push(`${JSON.stringify(py.slice(0, 50))} should read ${want}: ${r.files.join(" ")} ${r.problems.join(";")}`);
  }
  for (const [py, re] of trailing) {
    const r = extraFilesOf(py);
    if (r.files.length || !re.test(r.problems.join(";"))) wrong.push(`${JSON.stringify(py.slice(0, 50))} should fail ${re}: ${r.files.join(" ")} ${r.problems.join(";") || "no problem"}`);
  }
  for (const py of again) {
    const r = extraFilesOf(py);
    if (r.files.length || !/assigned more than once/.test(r.problems.join(";"))) wrong.push(`${JSON.stringify(py.slice(0, 50))} should fail as assigned or changed again: ${r.files.join(" ")} ${r.problems.join(";") || "no problem"}`);
  }
  return wrong.length === 0 ? true : wrong.join(" | ");
});
attempt("a terms URL that is not https fails, naming the publisher", () => {
  const url = "http://example.org/alpha/terms";
  const errs = problemsOf(table(row({ urls: url })), F_ALPHA, lockOf(fetched(url)));
  return has(errs, /Alpha Agency: terms URL is not https/) ? true : show(errs);
});
attempt("a row with no terms URL fails", () => {
  const errs = problemsOf(table(row({ urls: "" })), F_ALPHA, goodLock());
  return has(errs, /Alpha Agency has no terms URL/) ? true : show(errs);
});
attempt("a grant that is not a quote, 'terms page states no licence' or 'no terms page found' fails (no licence name is made up)", () => {
  const a = problemsOf(table(row({ grants: "CC BY 4.0" })), F_ALPHA, goodLock());
  const b = problemsOf(table(row({ grants: "public domain" })), F_ALPHA, goodLock());
  const c = problemsOf(table(row({ grants: "" })), F_ALPHA, goodLock());
  return has(a, /none of: a quote/) && has(b, /none of: a quote/) && c.length > 0 ? true : `CC BY: ${show(a)}; public domain: ${show(b)}; empty: ${show(c)}`;
});
attempt("a licence name written outside the quote the lock found fails, naming the publisher and the name (appended to a stated absence, after a closing quote, in parentheses)", () => {
  const lockNone = lockOf(absent(ALPHA));
  const cases = [
    ["after 'no terms page found'", row({ grants: "no terms page found CC0 1.0 Universal" }), lockNone, "CC0"],
    ["after a closing quote", row({ grants: `"${Q}" CC0` }), goodLock(), "CC0"],
    ["after 'terms page states no licence'", row({ grants: "terms page states no licence (MIT)" }), lockNone, "MIT"],
  ];
  const bad = [];
  for (const [label, r, lock, name] of cases) {
    const errs = problemsOf(table(r), F_ALPHA, lock);
    if (!has(errs, new RegExp(`Alpha Agency: the statement for ${ALPHA.replace(/[.]/g, "\\.")} names a licence \\("${name}"\\) outside the quote`))) bad.push(`${label}: ${show(errs)}`);
  }
  return bad.length === 0 ? true : bad.join(" | ");
});
attempt("a quote may say 'public domain' (the page's own words), but a remark after it may not", () => {
  const lockP = lockOf(fetched(ALPHA, { quote: QP, quoteWords: words(QP) }));
  const inside = problemsOf(table(row({ grants: `"${QP}" (said of the Alpha site)` })), F_ALPHA, lockP);
  const after = problemsOf(table(row({ grants: `"${QP}" (so public domain)` })), F_ALPHA, lockP);
  const second = problemsOf(table(row({ grants: `"${QP}" "CC0 1.0 Universal"` })), F_ALPHA, lockP);
  return inside.length === 0 && has(after, /names a licence \("public domain"\) outside the quote/) && has(second, /names a licence \("CC0"\) outside the quote/)
    ? true
    : `inside: ${show(inside)}; after: ${show(after)}; second quote: ${show(second)}`;
});
attempt("the licence names are seen in their usual spellings, and ordinary remarks are not mistaken for one", () => {
  const lockNone = lockOf(absent(ALPHA));
  const names = ["CC0", "CC BY 4.0", "cc-by-sa", "Creative Commons", "MIT", "Apache 2.0", "ODbL", "ODC-By", "GPL", "LGPL", "AGPL", "BSD", "MPL 2.0", "Open Data Commons", "open data licence", "open government license", "public domain", "Public-Domain", "PDDL", "Unlicense"];
  const missed = names.filter((n) => !has(problemsOf(table(row({ grants: `terms page states no licence: ${n}` })), F_ALPHA, lockNone), /names a licence/));
  const fine = ["the service's copyrightText is empty", "the page was submitted by the committee for permission and mitigation", "its visible text has no match for the lock's searched words", "the licence words, copyright and permission were searched for"];
  const wrong = fine.filter((n) => has(problemsOf(table(row({ grants: `terms page states no licence: ${n}` })), F_ALPHA, lockNone), /names a licence/));
  return missed.length === 0 && wrong.length === 0 ? true : `not seen: ${missed.join(", ")}; wrongly seen: ${wrong.join(", ")}`;
});
attempt("the licence names the first list missed are seen: CC-0, CC 0, OGL v3, ISC, EUPL, WTFPL, Zlib, Mozilla Public, and a no-break space, a non-breaking hyphen or an en dash where the list has a space or a hyphen", () => {
  const lockNone = lockOf(absent(ALPHA));
  const seen = (s) => has(problemsOf(table(row({ grants: `terms page states no licence: ${s}` })), F_ALPHA, lockNone), /names a licence/);
  const names = [
    "CC-0", "CC 0", "OGL v3", "OGL", "ISC", "EUPL 1.2", "WTFPL", "Zlib", "Mozilla Public License 2.0",
    `Creative${NBSP}Commons`, `CC${NBHY}BY`, `CC${NBHY}0`, `CC${ENDASH}BY`, `Open${NBSP}Data${NBSP}Commons`, `Public${NBHY}Domain`, `Open${NBHY}Government${NBHY}Licence`, `Mozilla${NBSP}Public`,
  ];
  const missed = names.filter((n) => !seen(n));
  const fine = ["a disc of records", "the oglala county office", "the Mozilla browser", "the CC field of the form", "a zlibrary index", "the iscsi target"];
  const wrong = fine.filter(seen);
  const shown = problemsOf(table(row({ grants: `terms page states no licence: Creative${NBSP}Commons` })), F_ALPHA, lockNone);
  if (!has(shown, /names a licence \("Creative<U\+00A0>Commons"\)/)) return `a no-break space is not shown as <U+00A0> in the failure line: ${show(shown)}`;
  return missed.length === 0 && wrong.length === 0 ? true : `not seen: ${missed.map(visible).join(", ")}; wrongly seen: ${wrong.join(", ")}`;
});
attempt("a quote of 25 words or more fails", () => {
  const long = Array.from({ length: 25 }, (_, i) => `word${i}`).join(" ");
  const errs = problemsOf(table(row({ grants: `"${long}"` })), F_ALPHA, lockOf(fetched(ALPHA, { quote: long, quoteWords: 25 })));
  const ok24 = problemsOf(table(row({ grants: `"${long.split(" ").slice(0, 24).join(" ")}"` })), F_ALPHA, lockOf(fetched(ALPHA, { quote: long.split(" ").slice(0, 24).join(" "), quoteWords: 24 })));
  return has(errs, /25 words; under 25/) && ok24.length === 0 ? true : `25: ${show(errs)}; 24: ${show(ok24)}`;
});
attempt("a row that grants anything on top of the publisher's terms fails", () => {
  const errs = problemsOf(table(row({ onTop: "CC BY 4.0" })), F_ALPHA, goodLock());
  return has(errs, /what we grant on top must read "nothing beyond their terms"/) ? true : show(errs);
});
attempt("a quote that is not the one the lock found on the page fails", () => {
  const errs = problemsOf(table(row()), F_ALPHA, lockOf(fetched(ALPHA, { quote: "Alpha data may be reused by anyone for some purpose" })));
  const notFound = problemsOf(table(row()), F_ALPHA, lockOf(fetched(ALPHA, { quoteFound: false })));
  return has(errs, /not the one the lock found/) && has(notFound, /not the one the lock found/) ? true : `reworded: ${show(errs)}; not found: ${show(notFound)}`;
});
attempt("a terms URL with no 200 in the lock fails", () => {
  const missing = problemsOf(table(row()), F_ALPHA, lockOf());
  const bad = problemsOf(table(row()), F_ALPHA, lockOf(fetched(ALPHA, { status: 404 })));
  const nohash = problemsOf(table(row()), F_ALPHA, lockOf(fetched(ALPHA, { sha256: "" })));
  return has(missing, /no entry in data\/licenses\.lock\.json/) && has(bad, /status 404/) && has(nohash, /no sha256/) ? true : `missing: ${show(missing)}; 404: ${show(bad)}; no hash: ${show(nohash)}`;
});
attempt("a stated absence the lock does not back fails", () => {
  const errs = problemsOf(table(row({ grants: "terms page states no licence" })), F_ALPHA, lockOf(absent(ALPHA, { matches: 3 })));
  return has(errs, /does not show .* free of licence words/) ? true : show(errs);
});
attempt("a statement that the service's copyrightText is empty needs the lock to record copyrightText as the empty string", () => {
  const url = "https://example.org/beta/data?f=json";
  const md = table(row({ urls: url, grants: "terms page states no licence: the service's copyrightText is empty" }));
  const held = problemsOf(md, F_ALPHA, lockOf(absent(url, { copyrightText: "" })));
  const re = /the statement for https:\/\/example\.org\/beta\/data\?f=json says the service's copyrightText is empty, but the lock does not record copyrightText as the empty string/;
  const none = problemsOf(md, F_ALPHA, lockOf(absent(url)));
  const full = problemsOf(md, F_ALPHA, lockOf(absent(url, { copyrightText: "Alpha 2026" })));
  const nul = problemsOf(md, F_ALPHA, lockOf(absent(url, { copyrightText: null })));
  return held.length === 0 && has(none, re) && has(full, re) && has(nul, re) ? true : `recorded empty: ${show(held)}; not recorded: ${show(none)}; non-empty: ${show(full)}; null: ${show(nul)}`;
});
attempt("a publisher listed twice fails", () => {
  const errs = problemsOf(table(row(), row()), F_ALPHA, goodLock());
  return has(errs, /Alpha Agency is listed twice/) ? true : show(errs);
});
attempt("a table without the compilation licence line fails", () => {
  const md = table(row()).replace(COMPILATION_LINE, "Compilation licence: CC BY 4.0");
  const errs = problemsOf(md, F_ALPHA, goodLock());
  return has(errs, /compilation licence line is missing or reworded/) ? true : show(errs);
});
attempt("a retrieved date that is not the lock's fetch day fails", () => {
  const errs = problemsOf(table(row({ retrieved: "2026-10-19" })), F_ALPHA, goodLock());
  return has(errs, /is not the lock's fetch day 2026-10-21/) ? true : show(errs);
});
attempt("a URL in the lock that no row cites fails", () => {
  const errs = problemsOf(table(row()), F_ALPHA, lockOf(fetched(ALPHA), fetched(BETA)));
  return has(errs, /example\.org\/beta\/terms is in the lock but in no row/) ? true : show(errs);
});
attempt("a row with a different number of URLs and statements fails", () => {
  const errs = problemsOf(table(row({ urls: `${ALPHA}<br>${BETA}` })), F_ALPHA, lockOf(fetched(ALPHA), fetched(BETA)));
  return has(errs, /2 terms URL\(s\) and 1 statement/) ? true : show(errs);
});

// ---------------------------------------------------------------- the committed files
const read = (p) => readFileSync(p, "utf8");
const committed = manifestFacts(MANIFESTS);
// What data/hf/publish.py ships beyond the manifests, read off its literal; a literal the reader cannot read is a problem here.
const shippedRead = extraFilesOf(read(PUBLISH_PY));
const committedFacts = { ...committed, shipped: shippedRead.files, problems: [...committed.problems, ...shippedRead.problems] };

attempt("the manifests read cleanly: every collection folder has manifests and names at least one source", () => {
  const n = committed.collections.length;
  const bare = committed.collections.filter((c) => !committed.sources.some((s) => s.collection === c));
  return n > 0 && committed.problems.length === 0 && bare.length === 0 ? true : `${n} collection folders; ${show(committed.problems)}; no source: ${bare.join(", ")}`;
});
attempt("data/LICENSES.md passes against the committed manifests and data/licenses.lock.json", () => {
  const errs = licenseProblems(read(LICENSES), committedFacts, JSON.parse(read(LOCK)));
  return errs.length === 0 ? true : show(errs);
});
attempt("every collection in data/manifests has a row from the publisher of each of its sources, naming it in the Collections cell, and no row names a collection it does not publish", () => {
  const { rows } = parseTable(read(LICENSES));
  const errs = sourceProblems(rows, committed);
  return committed.sources.length > 0 && errs.length === 0 ? true : show(errs.length ? errs : ["data/manifests names no source"]);
});
attempt("every publisher a manifest's joins[].boundary names has a row that names the collection under Also used for", () => {
  const { rows } = parseTable(read(LICENSES));
  const errs = joinProblems(rows, committed);
  return errs.length === 0 ? true : show(errs);
});
attempt("data/hf/publish.py ships at least one file beyond the manifests (EXTRA_FILES reads as a plain list), and EXTRA_FILE_PUBLISHERS has publishers for each", () => {
  const noLine = shippedRead.files.filter((f) => !EXTRA_FILE_PUBLISHERS[f]?.length);
  return shippedRead.problems.length === 0 && shippedRead.files.length > 0 && noLine.length === 0 ? true : `${shippedRead.files.length} files read from EXTRA_FILES; ${show(shippedRead.problems)}; no publisher line for: ${noLine.join(" ")}`;
});
attempt("the committed data/hf/publish.py with each of five escaping forms applied to EXTRA_FILES (+ a second list, + a name, * 2, an indented +=, an indented .extend) fails extraFilesOf by name", () => {
  const py = read(PUBLISH_PY);
  const clean = extraFilesOf(py);
  if (clean.problems.length || clean.files.length === 0) return `the committed file does not read cleanly first: ${clean.files.length} files; ${clean.problems.join(";")}`;
  const literal = /^(EXTRA_FILES\s*(?::[^=\n]+)?=\s*\[[^\]]*\])/m;
  if (!literal.test(py)) return "the committed publish.py has no EXTRA_FILES = [...] statement to apply the forms to";
  const forms = [
    ["+ a second list", py.replace(literal, '$1 + ["companies/other.json"]'), /closing "\]" is followed by "\+"/],
    ["+ a name", py.replace(literal, "$1 + OTHER"), /closing "\]" is followed by "\+"/],
    ["* 2", py.replace(literal, "$1 * 2"), /closing "\]" is followed by "\*"/],
    ["an indented +=", `${py}\nif True:\n    EXTRA_FILES += ["companies/other.json"]\n`, /assigned more than once/],
    ["an indented .extend", `${py}\nif True:\n    EXTRA_FILES.extend(["companies/other.json"])\n`, /assigned more than once/],
  ];
  const wrong = [];
  for (const [name, text, re] of forms) {
    const r = extraFilesOf(text);
    if (text === py) wrong.push(`${name}: the form did not change the file`);
    else if (r.files.length || !re.test(r.problems.join(";"))) wrong.push(`${name} should fail ${re}: ${r.files.join(" ")} ${r.problems.join(";") || "no problem"}`);
  }
  return wrong.length === 0 ? true : wrong.join(" | ");
});
attempt("every file data/hf/publish.py ships (EXTRA_FILES) has, for each publisher EXTRA_FILE_PUBLISHERS gives it, a row that names the file under Also used for, and the SEC and Census rows are among them", () => {
  const { rows } = parseTable(read(LICENSES));
  const errs = extraFileProblems(rows, shippedRead.files);
  const who = shippedRead.files.flatMap((f) => EXTRA_FILE_PUBLISHERS[f] ?? []);
  const both = ["U.S. Securities and Exchange Commission", "U.S. Census Bureau"].every((n) => who.includes(n));
  return shippedRead.files.length > 0 && errs.length === 0 && both ? true : show(errs.length ? errs : ["EXTRA_FILE_PUBLISHERS does not name both the SEC and the Census Bureau for the companies file"]);
});
attempt("the committed quotes that say 'public domain' (the NCES and NPS pages' own words) still pass: the licence-name rule reads only outside a quote, and some committed quote says it", () => {
  const { rows } = parseTable(read(LICENSES));
  const quoted = rows.flatMap((r) => r.grants).filter((g) => /^"[^"]*public domain/i.test(g));
  const errs = licenseProblems(read(LICENSES), committedFacts, JSON.parse(read(LOCK))).filter((e) => /names a licence/.test(e));
  return quoted.length >= 1 && errs.length === 0 ? true : `${quoted.length} committed quotes say public domain; ${show(errs)}`;
});
attempt("the committed lock records copyrightText as the empty string for each URL whose statement says the service's copyrightText is empty (and some statement does)", () => {
  const { rows } = parseTable(read(LICENSES));
  const lock = JSON.parse(read(LOCK));
  const urls = rows.flatMap((r) => r.urls.filter((u, i) => /copyrightText\s+is\s+empty/i.test(r.grants[i] ?? "")));
  const bad = urls.filter((u) => lock.fetches.find((f) => f.url === u)?.copyrightText !== "");
  if (urls.length === 0) return "no statement in data/LICENSES.md says copyrightText is empty: the USACE clause the lock holds is gone or reworded";
  return bad.length === 0 ? true : `the lock does not record copyrightText as "" for: ${bad.join(" ")}`;
});
attempt("data/LICENSES.md and data/licenses.lock.json name the same terms URLs", () => {
  const { rows } = parseTable(read(LICENSES));
  const a = new Set(rows.flatMap((r) => r.urls));
  const b = new Set(JSON.parse(read(LOCK)).fetches.map((f) => f.url));
  const onlyMd = [...a].filter((u) => !b.has(u));
  const onlyLock = [...b].filter((u) => !a.has(u));
  return a.size > 0 && !onlyMd.length && !onlyLock.length ? true : `only in LICENSES.md: ${onlyMd.join(" ")}; only in the lock: ${onlyLock.join(" ")}`;
});
attempt("the Hugging Face dataset card links data/LICENSES.md and carries the compilation licence line", () => {
  const md = read(HF_README);
  return md.includes(LICENSES_URL) && md.includes(COMPILATION_LINE) ? true : `link ${md.includes(LICENSES_URL)}, line ${md.includes(COMPILATION_LINE)}`;
});
attempt("the MCP server instructions link data/LICENSES.md, and docs/MCP.md carries it with them", () => {
  const m = /export const INSTRUCTIONS = \[([\s\S]*?)\]\.join\("\\n"\)/.exec(read(SERVER_TS));
  if (!m) return "INSTRUCTIONS not found in apps/map/lib/mcp/server.ts";
  if (!m[1].includes(LICENSES_URL)) return "INSTRUCTIONS does not name " + LICENSES_URL;
  return read(MCP_MD).includes(LICENSES_URL) ? true : "apps/map/docs/MCP.md does not carry the link";
});
attempt("data/PIPELINE.md has a Licences section naming data/LICENSES.md and this test", () => {
  const md = read(PIPELINE_MD);
  const at = md.search(/^## Licences\s*$/m);
  if (at < 0) return "no '## Licences' heading";
  const section = md.slice(at).split(/^## /m)[1] ?? "";
  return /LICENSES\.md/.test(section) && /licenses\.test\.mjs/.test(section) ? true : "the section does not name LICENSES.md and licenses.test.mjs";
});

console.log(`\nlicenses: ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
