// Repo guard: the README's rules as a check, run on every pull request and push to master.
// Plain Node, no install. Reads only tracked files (git ls-files), so it judges what would ship.
//
//   node scripts/guard.mjs            check the repo it runs in
//   node scripts/guard.mjs <dir>      check another git checkout (used by the self-test)
//
// Fails on:
//   size       a tracked file over 5 MB (large data, caches and weights live outside git)
//   weights    a model, tensor or dataframe file by extension (.pt .pth .safetensors .gguf .onnx .h5 .keras
//              .tflite .pb .ckpt .npz .npy .pkl .joblib .parquet .arrow)
//   env        a tracked .env, .env.<x> or .envrc file other than .env.example
//   crlf       a carriage return in a text file (this repo is LF only; UTF-16 text is decoded first)
//   mojibake   UTF-8 read as Windows-1252 and written back, in the same text files crlf reads: U+00C3, U+00C2 or
//              U+00E2 followed by U+0080-U+00BF or by Windows-1252's image of a byte 0x80-0x9F (the e-acute family;
//              the middle dot, no-break space, degree and section family; the quote, dash, star, circle and arrow
//              family), or U+FFFD. A capital A-tilde, a capital A-circumflex or an a-circumflex before a letter, space,
//              digit or ASCII mark is a letter and passes. The finding names the file, the first
//              line, its code points and how many more lines carry one. Waived by a guard.allow.json entry for
//              the exact bytes, as size is. Cause: a Get-Content/Set-Content round trip of a UTF-8 file in
//              Windows PowerShell 5.1; edit with an editor tool, or ReadAllText/WriteAllText with UTF8Encoding($false).
//   secret     a token-shaped string: AWS (AKIA/ASIA), GitHub, Hugging Face, sk- and sk_live_ keys,
//              Slack, Google API keys, private key blocks (RSA, EC, OpenSSH, DSA, encrypted, PGP).
//              Binary files are scanned for these too.
//   path       a Windows home path in any spelling: C:\Users\<name>, C:/Users/<name>, file:///C:/Users/<name>,
//              c:\users\<name>, /c/Users/<name>, /C/Users/<name> (internal machine paths stay out of a public
//              repo). A literal <placeholder> right after Users is not a path, so docs can show the shape.
//   submodule  a tracked directory (gitlink); this repo has none
//   pin        a "uses:" line in .github/workflows/*.yml or *.yaml whose action isn't pinned to a full
//              40-hex commit sha. A tag or branch can be moved under us; a sha can't. Local ./ actions are
//              exempt. Write the tag as a trailing comment (@<sha> # v4) so Dependabot can bump both.
//              Idea: trimstray/the-book-of-secret-knowledge (MIT, reviewed at 7d37069), which points to
//              GitHub's supply-chain hardening; the trivy-action tag force-push (GHSA-69fq-xp46-6x23) is
//              the case it guards. No text or code copied.
//   eval-leak  a tracked file named like the v4 eval's sealed material (gold, KEY or split, with or without a
//              data extension: gold.json, KEY.json, split.v4.json, grades/key_blind.csv) or any text file carrying
//              the header marker the eval kit puts in its gold, key and split files. The sealed files live outside
//              the repo until scoring is done (writeups PREREG-TEMPLATE rule 6); code such as eval/split.mjs is
//              not flagged.
//   rules      a "Checked here" or "Tested here" row of AGENTS.md's rules table that names no path, names a path
//              that is not tracked, or names a workflow that does not exist. Both kinds are read the same way:
//              every path-looking word in the backticks of the Enforced-by cell is judged, and a path that is not
//              in this repo (eye's) is written without backticks. A bare basename (no directory) counts when it
//              matches exactly one tracked file; two matches or none is a finding. A mutant is asked of a Checked
//              row only, and by scripts/rules-table.test.mjs, not here.
//   angle      a bare tag-looking token (<word>, <word attr="x">, <word/>) in a table row of a tracked .md file. GitHub drops
//              a tag it does not know from a cell (a row holding <outdir> renders without it) and keeps <br>. A row is a line
//              whose first non-blank character is a pipe. The row is split into cells on unescaped pipes first, because
//              GitHub does that before it reads a code span (a span cannot cross a pipe), and then each cell is read with
//              its code spans and backslash-escaped punctuation blanked. A token inside a code span, an escaped \<x\>, an
//              autolink (<https://...>, <mailto:...>, <a@b.c>: a colon or an at-sign is not part of a tag name) and a
//              <br> (<br/>, <br />, any case; by name) pass; every other tag fails, known HTML tags included, because this
//              check keeps no list of what GitHub allows. The finding is one line per row naming file:line and every token.
//              Fenced code blocks are skipped. Waived like mojibake, by a guard.allow.json entry for the exact bytes. Scope:
//              table rows only. A bare token in prose, a closing tag, and a table inside a blockquote are not judged.
//              The MCP doc table (apps/map/docs/MCP.md) is generated, and its emitter (toolTable in
//              apps/map/lib/mcp/server.ts) writes the same kind of token in backticks; it reads cells the way this rule does
//              (lib/mcp compiles alone, so the scan is written twice), and this rule runs over the file it writes.
// Exit 0 when clean, 1 with one line per finding. No file is exempt, the guard's own included: its
// patterns and test fixtures are written so they never match themselves.
//
// An intended large or model file (a model the browser loads, a baked bundle) is allowed only by its
// exact bytes: guard.allow.json lists {path, sha256, reason}, and the size, weights, mojibake and angle rules are
// waived for a file whose sha256 matches. The other content scans still run on it. Changed bytes fail again until the new
// hash is reviewed in; an entry whose file is gone fails too.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? ".");
const allowFile = path.join(root, "guard.allow.json");
const ALLOW = new Map(
  (existsSync(allowFile) ? JSON.parse(readFileSync(allowFile, "utf8")) : []).map((a) => [a.path, a]),
);
const MAX_BYTES = 5 * 1024 * 1024;
const WEIGHTS = /\.(pt|pth|safetensors|gguf|onnx|h5|keras|tflite|pb|ckpt|npz|npy|pkl|joblib|parquet|arrow)$/i;
const SECRETS = [
  ["aws key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["github token", /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{40,}/],
  ["hugging face token", /\bhf_[A-Za-z0-9]{30,}\b/],
  ["api key", /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}\b|\bsk_live_[A-Za-z0-9]{20,}\b/],
  ["slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ["google api key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED |PGP )?PRIVATE KEY(?: BLOCK)?-----/],
];
// Drive-letter paths match in any case. The Git Bash form needs "Users" capitalized and a single drive letter
// that isn't part of a longer path (except the WSL /mnt and Cygwin /cygdrive mounts), so web routes like
// /c/users/42 or /api/r/Users/top are not flagged but /mnt/c/Users/<name> is. Lowercase /c/users/<name>
// is accepted as a miss: Git Bash itself prints /c/Users.
const HOME_PATH = /[A-Za-z]:(?:\\+|\/+)Users(?:\\+|\/+)[^\\/\s"'<>]+|(?:(?<![\w/.-])|(?<=\/mnt|\/cygdrive))\/[A-Za-z]\/Users\/[^/\s"'<>]+/i;
const GITBASH_CASE = /\/[A-Za-z]\/Users\//;
const EVAL_DATA_EXT = /\.(?:json|jsonl|ndjson|csv|tsv|txt|sqlite|db)$/i;
const EVAL_STEM = /^(?:gold|key|split)(?:[._-]|$)/i;
const EVAL_MARKER = /groundtruth-eval-(?:gold|key|split)-v\d/;
function evalLeakName(base) {
  return /^(?:gold|key|split)$/i.test(base) || (EVAL_DATA_EXT.test(base) && EVAL_STEM.test(base));
}
// UTF-8 read as Windows-1252 and saved again. The lead byte of a multi-byte sequence comes back as a letter: U+00C3 (0xC3)
// for e-acute, a-acute, n-tilde, u-diaeresis and the rest of U+00C0-U+00FF; U+00C2 (0xC2) for U+0080-U+00BF (middle dot,
// no-break space, degree, section, copyright, guillemets); U+00E2 (0xE2) for U+2000-U+2FFF (curly quotes, dashes, stars,
// circles, arrows, the euro). The byte after it (0x80-0xBF) comes back as U+0080-U+00BF, or as Windows-1252's image of
// 0x80-0x9F (euro, low and curly quotes, ellipsis, dagger, per mille, trade mark, dashes and the Latin letters it holds).
// Any of the three leads before one of those matches. Before a letter, space, digit or ASCII mark each is a letter
// (Portuguese capitals, French and Romanian a-circumflex) and does not. U+FFFD is what a decoder writes for bytes that
// were not UTF-8. The other lead bytes (U+00C4-U+00DF, U+00E0-U+00E1, U+00E3-U+00F4) are not read. Written as escapes so
// this file never matches its own rule.
const MOJIBAKE = /[\u00C2\u00C3\u00E2][\u0080-\u00BF\u0152\u0153\u0160\u0161\u0178\u017D\u017E\u0192\u02C6\u02DC\u2013\u2014\u2018\u2019\u201A\u201C\u201D\u201E\u2020\u2021\u2022\u2026\u2030\u2039\u203A\u20AC\u2122]|\uFFFD/gu;
const WORKFLOW = /^\.github\/workflows\/[^/]+\.ya?ml$/;
const USES = /^\s*(?:-\s+)?uses:\s*["']?([^"'\s#]+)/;
const SHA_PIN = /@[0-9a-f]{40}$/;

// Every unpinned "uses:" in one workflow's text, as [line number, value].
function unpinned(text) {
  const out = [];
  text.split("\n").forEach((line, i) => {
    const m = USES.exec(line);
    if (m && !m[1].startsWith("./") && !SHA_PIN.test(m[1])) out.push([i + 1, m[1]]);
  });
  return out;
}

// "line 3: U+00C3 U+00A9" for the first mojibake in a text, with " (+2 more lines)" when other lines carry one; null when none.
function mojibake(text) {
  let first = null;
  let line = 1;
  let at = 0;
  const lines = new Set();
  for (const m of text.matchAll(MOJIBAKE)) {
    line += text.slice(at, m.index).split("\n").length - 1;
    at = m.index;
    lines.add(line);
    first ??= [line, m[0]];
  }
  if (!first) return null;
  const codes = [...first[1]].map((c) => "U+" + c.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")).join(" ");
  const more = lines.size - 1;
  return `line ${first[0]}: ${codes}${more ? ` (+${more} more line${more > 1 ? "s" : ""})` : ""}`;
}

// ---- angle ----------------------------------------------------------------------------------------------------
// A tag-looking token: "<", a letter, name characters, then optional whitespace and anything but < or > (attributes), an
// optional "/" and ">". A colon or an at-sign after the name ends the match, so <https://x> and <a@b.c> are not tokens.
// Group 1 is the tag name.
const ANGLE_TAG = /<([A-Za-z][A-Za-z0-9._-]*)(?:\s[^<>]*)?\/?>/g;
const ASCII_PUNCT = /[!-\/:-@[-`{-~]/;
const FENCE = /^\s*(`{3,}|~{3,})(.*)$/;
const ANGLE_MSG = "GitHub drops a bare tag it does not know and keeps <br>; write the token in backticks or escape it";

// The cell with its code spans and its backslash-escaped punctuation blanked to spaces (same length, so an offset in the
// result is an offset in the cell). One left-to-right pass: a backslash escapes the ASCII punctuation after it, and a run
// of n backticks opens a span that the next run of exactly n backticks closes; a run with no closer is literal text.
function blankSpans(cell) {
  const out = cell.split("");
  let i = 0;
  while (i < cell.length) {
    if (cell[i] === "\\" && i + 1 < cell.length && ASCII_PUNCT.test(cell[i + 1])) {
      out[i] = out[i + 1] = " ";
      i += 2;
    } else if (cell[i] === "`") {
      let n = 1;
      while (cell[i + n] === "`") n++;
      let close = -1;
      for (let j = i + n; j < cell.length; ) {
        if (cell[j] !== "`") {
          j++;
          continue;
        }
        let m = 1;
        while (cell[j + m] === "`") m++;
        if (m === n) {
          close = j;
          break;
        }
        j += m;
      }
      if (close < 0) {
        i += n;
      } else {
        for (let k = i; k < close + n; k++) out[k] = " ";
        i = close + n;
      }
    } else i++;
  }
  return out.join("");
}

// The cells of a table row, split on pipes that no backslash escapes, before any code span is read (GitHub's order). A
// backslash before a pipe escapes it whatever precedes the backslash: GitHub reads `a \\| <x>` as one cell.
function tableCells(line) {
  const t = line.replace(/^\s*\|/, "");
  const cells = [];
  let cur = "";
  for (let i = 0; i < t.length; i++) {
    if (t[i] === "\\" && t[i + 1] === "|") {
      cur += "\\|";
      i++;
    } else if (t[i] === "|") {
      cells.push(cur);
      cur = "";
    } else cur += t[i];
  }
  cells.push(cur);
  return cells;
}

// [line number, tokens] for each table row of a Markdown text that holds a bare tag other than <br>. Fenced code blocks
// are skipped (a backtick fence's info string holds no backtick; a fence closes on a run of the same mark at least as long,
// and an unclosed one runs to the end, as in CommonMark). CRLF lines are read as LF.
function angleRows(text) {
  const out = [];
  let fence = null;
  text.split(/\r?\n/).forEach((line, i) => {
    const f = FENCE.exec(line);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length && !f[2].trim()) fence = null;
      return;
    }
    if (f && !(f[1][0] === "`" && f[2].includes("`"))) {
      fence = f[1];
      return;
    }
    if (!/^\s*\|/.test(line)) return;
    const toks = [];
    for (const cell of tableCells(line))
      for (const m of blankSpans(cell).matchAll(ANGLE_TAG))
        if (m[1].toLowerCase() !== "br") toks.push(cell.slice(m.index, m.index + m[0].length));
    if (toks.length) out.push([i + 1, toks]);
  });
  return out;
}
// ---- end angle ------------------------------------------------------------------------------------------------

function textOf(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString("utf16le");
  if (buf[0] === 0xfe && buf[1] === 0xff) return Buffer.from(buf.subarray(2)).swap16().toString("utf16le");
  if (buf.subarray(0, 8000).includes(0)) return null; // binary
  return buf.toString("utf8");
}

// A word in an "Enforced by" cell that reads as a file path: path characters ending in an extension, and either
// with a directory in it or with an extension files here use. `fieldStyle.colorFor` and `Date.now` are
// identifiers, not paths; `*Style`, `outFields=*` and `apps/map/lib` (no extension) do not match either.
const PATH_WORD = /^[\w@.\-/]+\.\w+$/;
const FILE_EXT = /\.(?:mjs|cjs|js|jsx|ts|tsx|mts|py|sh|json|jsonl|md|ya?ml|toml|csv|tsv|txt|html|css|svg|sql|ipynb|sha256)$/i;
const WORKFLOW_PATH = /^\.github\/workflows\/[^/]+\.ya?ml$/;

// Every path-looking word inside the backticks of an "Enforced by" cell, once each. A span may carry a command
// (`node scripts/x.mjs`), so each word of it is read, not only the first.
function pathWords(by) {
  const words = [...by.matchAll(/`([^`]+)`/g)].flatMap((m) => m[1].split(/\s+/)).map((w) => w.replace(/^[("']+|[)"',;:.]+$/g, ""));
  return [...new Set(words.filter((w) => PATH_WORD.test(w) && (w.includes("/") || FILE_EXT.test(w))))];
}

// The findings for one "Checked here" or "Tested here" row (without the "rules    AGENTS.md:N  " prefix); kind
// is the word its Status starts with. It must name at least one path, and every path it names must resolve. A
// word with a directory resolves only to that exact tracked path; a bare basename also resolves to the one
// tracked file of that name, and is a finding when two or none carry it. A workflow, found by either route,
// must exist in the working tree.
function pathFindings(kind, label, by, root, tracked, byName) {
  const words = pathWords(by);
  if (!words.length) return [`"${label}" is marked ${kind} but names no path`];
  const out = [];
  for (const w of words) {
    let at = w;
    if (!tracked.has(w)) {
      const same = w.includes("/") ? [] : byName.get(w) ?? [];
      if (same.length === 1) at = same[0];
      else if (same.length > 1) {
        out.push(`"${label}" names ${w}, which matches ${same.length} tracked files (${same.slice(0, 5).join(", ")}${same.length > 5 ? `, and ${same.length - 5} more` : ""}); write the full path`);
        continue;
      } else {
        out.push(WORKFLOW_PATH.test(w) ? `"${label}" names workflow ${w}, which does not exist` : `"${label}" names ${w}, which is not tracked`);
        continue;
      }
    }
    if (WORKFLOW_PATH.test(at) && !existsSync(path.join(root, at))) out.push(`"${label}" names workflow ${at}, which does not exist`);
  }
  return out;
}

// rules: AGENTS.md's "Record rules and what enforces them" table. Every row whose Status starts with "Checked"
// or "Tested" and says "here" (this repo enforces it) is held to one path and workflow reading, see
// pathFindings: it must name at least one path in the backticks of its "Enforced by" cell, every path-looking
// word there must be tracked (a bare basename only when exactly one tracked file carries it), and each workflow
// it names must exist. The two kinds differ in what else is asked, and not here: a Checked row must also name a
// mutant its tests kill, which scripts/rules-table.test.mjs reads and this case does not. A path that is not in
// this repo, eye's among them, is written without backticks (AGENTS.md says so), so it is not read. Reads the
// table, not the prose around it. A repo with no AGENTS.md has no table and is not judged.
function rulesFindings(root, tracked) {
  const f = path.join(root, "AGENTS.md");
  if (!existsSync(f)) return [];
  const lines = readFileSync(f, "utf8").split("\n");
  const at = lines.findIndex((l) => /^#+\s*Record rules and what enforces them\s*$/.test(l));
  if (at < 0) return ["rules    AGENTS.md  no \"Record rules and what enforces them\" heading"];
  const out = [];
  const byName = new Map(); // basename to every tracked path that carries it
  for (const p of tracked) byName.set(path.posix.basename(p), [...(byName.get(path.posix.basename(p)) ?? []), p]);
  let rows = 0;
  for (let i = at + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^#+\s/.test(l)) break;
    if (!l.startsWith("|")) continue;
    const cells = l.replace(/^\||\|\s*$/g, "").split("|").map((c) => c.trim());
    if (cells[0] === "Rule" || /^:?-+:?$/.test(cells[0])) continue;
    rows++;
    if (cells.length !== 3) {
      out.push(`rules    AGENTS.md:${i + 1}  row has ${cells.length} cells, not 3`);
      continue;
    }
    const [rule, by, status] = cells;
    const label = rule.slice(0, 50);
    const kind = /^(Checked|Tested)/.exec(status)?.[1];
    if (!kind || !/\bhere\b/i.test(status)) continue;
    for (const msg of pathFindings(kind, label, by, root, tracked, byName)) out.push(`rules    AGENTS.md:${i + 1}  ${msg}`);
  }
  if (!rows) out.push("rules    AGENTS.md  the table has no rows");
  return out;
}

const files = execFileSync("git", ["-C", root, "ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const findings = [];
for (const f of files) {
  const full = path.join(root, f);
  let st;
  try {
    st = statSync(full);
  } catch {
    if (ALLOW.has(f)) findings.push(`allow    ${f}  listed in guard.allow.json but missing from the working tree`);
    continue; // deleted in the working tree
  }
  if (st.isDirectory()) {
    findings.push(`submodule ${f}`);
    continue;
  }
  const buf = readFileSync(full);
  const allowed = ALLOW.get(f);
  let pinned = false; // an allow entry whose sha256 is these exact bytes
  if (allowed) {
    const sha = createHash("sha256").update(buf).digest("hex");
    if (sha !== allowed.sha256) findings.push(`allow    ${f}  sha256 ${sha.slice(0, 12)} is not the reviewed ${String(allowed.sha256).slice(0, 12)}`);
    else pinned = true;
  } else {
    if (st.size > MAX_BYTES) findings.push(`size     ${f}  ${(st.size / 1048576).toFixed(1)} MB > 5 MB`);
    if (WEIGHTS.test(f)) findings.push(`weights  ${f}`);
  }
  const base = path.posix.basename(f);
  if ((/^\.env(\..+)?$/.test(base) && base !== ".env.example") || base === ".envrc") findings.push(`env      ${f}`);
  const text = textOf(buf);
  const scan = text ?? buf.toString("latin1");
  for (const [name, re] of SECRETS) if (re.test(scan)) findings.push(`secret   ${f}  (${name})`);
  if (evalLeakName(base) || EVAL_MARKER.test(scan)) findings.push(`eval-leak ${f}`);
  if (text === null) continue;
  if (text.includes("\r")) findings.push(`crlf     ${f}`);
  const garbled = pinned ? null : mojibake(text);
  if (garbled) findings.push(`mojibake ${f}  ${garbled}`);
  if (!pinned && /\.md$/i.test(f))
    for (const [n, toks] of angleRows(text)) findings.push(`angle    ${f}:${n}  ${toks.map((t) => (t.length > 60 ? t.slice(0, 57) + "..." : t)).join("  ")}  ${ANGLE_MSG}`);
  const m = [...text.matchAll(new RegExp(HOME_PATH.source, "gi"))].find(
    (h) => /^[A-Za-z]:/.test(h[0]) || GITBASH_CASE.test(h[0]),
  );
  if (m) findings.push(`path     ${f}  (${m[0].slice(0, 40)})`);
  if (WORKFLOW.test(f)) for (const [n, v] of unpinned(text)) findings.push(`pin      ${f}  line ${n}: ${v}`);
}
const tracked = new Set(files);
for (const p of ALLOW.keys()) if (!tracked.has(p)) findings.push(`allow    ${p}  listed in guard.allow.json but not tracked`);
findings.push(...rulesFindings(root, tracked));
for (const line of findings) console.log(line);
console.log(findings.length ? `\n${findings.length} finding(s) in ${files.length} tracked files` : `clean: ${files.length} tracked files`);
process.exitCode = findings.length ? 1 : 0;
