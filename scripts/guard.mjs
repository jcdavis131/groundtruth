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
//   mojibake   UTF-8 read as Windows-1252 and written back, in the same text files crlf reads: U+00C3 followed by
//              U+0080-U+00BF or by Windows-1252's image of a byte 0x80-0x9F (the e-acute, a-acute, a-tilde family),
//              the pair U+00E2 U+20AC (the smart-quote and dash family), or U+FFFD. A capital A-tilde before a
//              letter, space, digit or ASCII mark is a letter and passes. The finding names the file, the first
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
//   rules      a "Checked here" row of AGENTS.md's rules table names no tracked path or a missing workflow file.
//              A "Tested here" row is held to a stricter reading of the same thing: it names at least one path,
//              every path it names is tracked, and every workflow it names exists. A bare basename (no directory)
//              counts when it matches exactly one tracked file; two matches or none is a finding. No mutant is
//              asked of a Tested row (scripts/rules-table.test.mjs reads Checked rows only).
// Exit 0 when clean, 1 with one line per finding. No file is exempt, the guard's own included: its
// patterns and test fixtures are written so they never match themselves.
//
// An intended large or model file (a model the browser loads, a baked bundle) is allowed only by its
// exact bytes: guard.allow.json lists {path, sha256, reason}, and the size, weights and mojibake rules are
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
// UTF-8 read as Windows-1252 and saved again. U+00C3 is the lead byte (0xC3) of e-acute, a-acute, n-tilde, u-diaeresis
// and the rest; the byte after it (0x80-0xBF) comes back as U+0080-U+00BF, or as Windows-1252's image of 0x80-0x9F
// (euro, low and curly quotes, ellipsis, dagger, per mille, trade mark, dashes and the Latin letters it holds). A
// capital A-tilde before a letter, space, digit or ASCII mark is a letter (Portuguese capitals) and does not match.
// U+00E2 U+20AC is the lead of a curly quote or dash. U+FFFD is what a decoder writes for bytes that were not UTF-8.
// Written as escapes so this file never matches its own rule.
const MOJIBAKE = /\u00C3[\u0080-\u00BF\u0152\u0153\u0160\u0161\u0178\u017D\u017E\u0192\u02C6\u02DC\u2013\u2014\u2018\u2019\u201A\u201C\u201D\u201E\u2020\u2021\u2022\u2026\u2030\u2039\u203A\u20AC\u2122]|\u00E2\u20AC|\uFFFD/gu;
const WORKFLOW = /^\.github\/workflows\/[^/]+\.ya?ml$/;
const USES =/^\s*(?:-\s+)?uses:\s*["']?([^"'\s#]+)/;
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

// The findings for one "Tested here" row (without the "rules    AGENTS.md:N  " prefix): it must name at least
// one path, and every path it names must resolve. A word with a directory resolves only to that exact tracked
// path; a bare basename also resolves to the one tracked file of that name, and is a finding when two or none
// carry it. A workflow, found by either route, must exist in the working tree.
function testedFindings(label, by, root, tracked, byName) {
  const words = pathWords(by);
  if (!words.length) return [`"${label}" is marked Tested but names no path`];
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

// rules: AGENTS.md's "Record rules and what enforces them" table. Every row whose Status starts with
// "Checked" and says "here" (this repo enforces it) must name at least one tracked path in its "Enforced by"
// cell, and each workflow file it names must be tracked under .github/workflows. A row whose Status starts with
// "Tested" and says "here" (a test enforces it, no mutant yet) is held to the path and workflow check alone,
// and to a stricter reading of it: see testedFindings. The two differ on purpose. A Checked row may cite eye's
// paths beside its own (it needs one tracked path), where a Tested row must not name a path that is not here.
// Reads the table, not the prose around it. A repo with no AGENTS.md has no table and is not judged.
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
    if (/^Tested/.test(status) && /\bhere\b/i.test(status)) {
      for (const msg of testedFindings(label, by, root, tracked, byName)) out.push(`rules    AGENTS.md:${i + 1}  ${msg}`);
      continue;
    }
    if (!/^Checked/.test(status) || !/\bhere\b/i.test(status)) continue;
    const named = [...by.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim().split(/\s+/)[0]).filter((s) => /^[\w@.\-/]+\.\w+$/.test(s));
    if (!named.some((p) => tracked.has(p))) out.push(`rules    AGENTS.md:${i + 1}  "${label}" is marked Checked but names no tracked path`);
    for (const p of named.filter((s) => /\.ya?ml$/.test(s) && s.includes(".github/workflows/")))
      if (!tracked.has(p) || !existsSync(path.join(root, p))) out.push(`rules    AGENTS.md:${i + 1}  "${label}" names workflow ${p}, which does not exist`);
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
