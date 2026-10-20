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
// Exit 0 when clean, 1 with one line per finding. No file is exempt, the guard's own included: its
// patterns and test fixtures are written so they never match themselves.
//
// An intended large or model file (a model the browser loads, a baked bundle) is allowed only by its
// exact bytes: guard.allow.json lists {path, sha256, reason}, and the size and weights rules are waived
// for a file whose sha256 matches. Content scans still run on it. Changed bytes fail again until the new
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

function textOf(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString("utf16le");
  if (buf[0] === 0xfe && buf[1] === 0xff) return Buffer.from(buf.subarray(2)).swap16().toString("utf16le");
  if (buf.subarray(0, 8000).includes(0)) return null; // binary
  return buf.toString("utf8");
}

// rules: AGENTS.md's "Record rules and what enforces them" table. Every row whose Status starts with
// "Checked" and says "here" (this repo enforces it) must name at least one tracked path in its "Enforced by"
// cell, and each workflow file it names must be tracked under .github/workflows. Reads the table, not the
// prose around it. A repo with no AGENTS.md has no table and is not judged.
function rulesFindings(root, tracked) {
  const f = path.join(root, "AGENTS.md");
  if (!existsSync(f)) return [];
  const lines = readFileSync(f, "utf8").split("\n");
  const at = lines.findIndex((l) => /^#+\s*Record rules and what enforces them\s*$/.test(l));
  if (at < 0) return ["rules    AGENTS.md  no \"Record rules and what enforces them\" heading"];
  const out = [];
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
    if (!/^Checked/.test(status) || !/\bhere\b/i.test(status)) continue;
    const label = rule.slice(0, 50);
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
  if (allowed) {
    const sha = createHash("sha256").update(buf).digest("hex");
    if (sha !== allowed.sha256) findings.push(`allow    ${f}  sha256 ${sha.slice(0, 12)} is not the reviewed ${String(allowed.sha256).slice(0, 12)}`);
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
