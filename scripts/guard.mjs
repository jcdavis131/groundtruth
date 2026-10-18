// Repo guard: the README's rules as a check, run on every pull request and push to master.
// Plain Node, no install. Reads only tracked files (git ls-files), so it judges what would ship.
//
//   node scripts/guard.mjs            check the repo it runs in
//   node scripts/guard.mjs <dir>      check another git checkout (used by the self-test)
//
// Fails on:
//   size      a tracked file over 5 MB (large data, caches and weights live outside git)
//   weights   a model or dataframe file by extension (.pt .safetensors .npz .pkl .parquet .ckpt .onnx .h5)
//   env       a tracked .env file other than .env.example
//   crlf      a carriage return in a text file (this repo is LF only)
//   secret    a token-shaped string (AWS, GitHub, Hugging Face, OpenAI-style, private key blocks)
//   path      a Windows home path or Git Bash /c/Users path (internal machine paths stay out of a public repo)
// Exit 0 when clean, 1 with one line per finding.
//
// An intended large file (a model the browser loads, a baked bundle) is allowed only by its exact bytes:
// guard.allow.json lists {path, sha256, reason}, and the size rule is waived for a file whose sha256 matches.
// A changed file fails again until its new hash is reviewed in. A listed file that no longer matches fails too.
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
const WEIGHTS = /\.(pt|safetensors|npz|pkl|parquet|ckpt|onnx|h5)$/i;
const SECRETS = [
  ["aws key", /AKIA[0-9A-Z]{16}/],
  ["github token", /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|github_pat_[A-Za-z0-9_]{40,}/],
  ["hugging face token", /\bhf_[A-Za-z0-9]{30,}\b/],
  ["api key", /\bsk-[A-Za-z0-9_-]{20,}\b/],
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
];
const HOME_PATH = /[A-Za-z]:\\+Users\\+[^\\\s"']+|\/c\/Users\/[^/\s"']+/;
// The guard's own patterns and its self-test fixtures name these shapes on purpose.
const SELF = new Set(["scripts/guard.mjs", "scripts/guard.test.mjs"]);

const files = execFileSync("git", ["-C", root, "ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const findings = [];
for (const f of files) {
  const full = path.join(root, f);
  let size;
  try {
    size = statSync(full).size;
  } catch {
    continue; // deleted in the working tree
  }
  const allowed = ALLOW.get(f);
  if (allowed) {
    const sha = createHash("sha256").update(readFileSync(full)).digest("hex");
    if (sha !== allowed.sha256) findings.push(`allow    ${f}  sha256 ${sha.slice(0, 12)} is not the reviewed ${String(allowed.sha256).slice(0, 12)}`);
  } else if (size > MAX_BYTES) findings.push(`size     ${f}  ${(size / 1048576).toFixed(1)} MB > 5 MB`);
  if (WEIGHTS.test(f)) findings.push(`weights  ${f}`);
  const base = path.posix.basename(f);
  if (/^\.env(\..+)?$/.test(base) && base !== ".env.example") findings.push(`env      ${f}`);
  if (size > MAX_BYTES) continue;
  const buf = readFileSync(full);
  if (buf.subarray(0, 8000).includes(0)) continue; // binary
  const text = buf.toString("utf8");
  if (text.includes("\r")) findings.push(`crlf     ${f}`);
  if (SELF.has(f)) continue;
  for (const [name, re] of SECRETS) if (re.test(text)) findings.push(`secret   ${f}  (${name})`);
  const m = text.match(HOME_PATH);
  if (m) findings.push(`path     ${f}  (${m[0].slice(0, 40)})`);
}
const tracked = new Set(files);
for (const p of ALLOW.keys()) if (!tracked.has(p)) findings.push(`allow    ${p}  listed in guard.allow.json but not tracked`);
for (const line of findings) console.log(line);
console.log(findings.length ? `\n${findings.length} finding(s) in ${files.length} tracked files` : `clean: ${files.length} tracked files`);
process.exitCode = findings.length ? 1 : 0;
