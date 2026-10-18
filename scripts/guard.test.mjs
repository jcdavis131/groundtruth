// Self-test for scripts/guard.mjs: throwaway git repos with every kind of violation must fail on each, and clean
// ones (including look-alikes that must not be flagged) must pass. Plain Node, no install.
//   node scripts/guard.test.mjs
// Fixture strings are split with + so this file never matches the guard's own patterns.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const guard = path.join(path.dirname(fileURLToPath(import.meta.url)), "guard.mjs");
const git = (dir, ...a) => execFileSync("git", ["-C", dir, ...a], { stdio: "ignore" });
const made = [];
function repo(files) {
  const dir = mkdtempSync(path.join(tmpdir(), "guard-"));
  made.push(dir);
  git(dir, "init", "-q");
  git(dir, "config", "core.autocrlf", "false");
  for (const [name, body] of Object.entries(files)) writeFileSync(path.join(dir, name), body);
  git(dir, "add", "-A");
  return dir;
}
const run = (dir) => spawnSync(process.execPath, [guard, dir], { encoding: "utf8" });

let failed = 0;
const check = (ok, msg) => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${msg}`);
};
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const flags = (out, kind, file) => new RegExp(`^${kind}\\s+${esc(file)}(\\s|$)`, "m").test(out);

// Clean, with look-alikes that are not violations.
const clean = repo({
  "README.md": "# fine\nall LF\ndisk-usage task-runner sk-learn ~/repo %USERPROFILE%\\repo\n",
  "routes.js": 'get("/c/users/42"); get("/u/users/:id"); fetch("https://example.com/r/' + 'Users/top");\n',
  ".env.example": "KEY=\n",
});
const r0 = run(clean);
check(r0.status === 0, `a clean repo with look-alikes passes${r0.status ? ": " + r0.stdout.trim() : ""}`);

const caps = "ABCDEFGHIJKLMNOP";
const bad = repo({
  "big.json": "x".repeat(5 * 1024 * 1024 + 1),
  "model.safetensors": "w",
  "model.gguf": "w",
  ".env": "KEY=1\n",
  ".env.local": "KEY=1\n",
  ".envrc": "export KEY=1\n",
  "crlf.txt": "a\r\nb\r\n",
  "u16.txt": Buffer.from("﻿a\r\nb\r\n", "utf16le"),
  "aws.md": "key AKIA" + caps + "\n",
  "asia.md": "key ASIA" + caps + "\n",
  "gh.md": "ghp_" + "a".repeat(36) + "\n",
  "hf.md": "hf_" + "b".repeat(34) + "\n",
  "skp.md": "sk-proj-" + "c".repeat(30) + "\n",
  "live.md": "sk_live_" + "d".repeat(24) + "\n",
  "slack.md": "xoxb-" + "1234567890-abcdef\n",
  "goog.md": "AIza" + "e".repeat(35) + "\n",
  "pk.md": "-----BEGIN " + "PRIVATE KEY-----\n",
  "enc.md": "-----BEGIN " + "ENCRYPTED PRIVATE KEY-----\n",
  "pgp.md": "-----BEGIN " + "PGP PRIVATE KEY BLOCK-----\n",
  "bin.dat": Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from("AKIA" + caps)]),
  "home.md": "see C:" + "\\Users\\someone\\notes\n",
  "fwd.md": "see C:" + "/Users/someone/x\n",
  "fileurl.md": "at file:///C:" + "/Users/someone/app.js:1\n",
  "lower.md": "at c:" + "\\users\\someone\\x\n",
  "bash.md": "cd /c/" + "Users/someone/x\n",
  "capbash.md": "cd /C/" + "Users/someone/x\n",
  "wsl.md": "cd /mnt/c/" + "Users/someone/x\n",
  "cyg.md": "cd /cygdrive/c/" + "Users/someone/x\n",
  "after-route.md": 'get("/c/users/42"); cd /c/' + "Users/someone/x\n",
});
const r1 = run(bad);
check(r1.status === 1, "a repo with violations fails");
for (const [kind, file] of [
  ["size", "big.json"], ["weights", "model.safetensors"], ["weights", "model.gguf"],
  ["env", ".env"], ["env", ".env.local"], ["env", ".envrc"],
  ["crlf", "crlf.txt"], ["crlf", "u16.txt"],
  ["secret", "aws.md"], ["secret", "asia.md"], ["secret", "gh.md"], ["secret", "hf.md"], ["secret", "skp.md"],
  ["secret", "live.md"], ["secret", "slack.md"], ["secret", "goog.md"], ["secret", "pk.md"], ["secret", "enc.md"],
  ["secret", "pgp.md"], ["secret", "bin.dat"],
  ["path", "home.md"], ["path", "fwd.md"], ["path", "fileurl.md"], ["path", "lower.md"], ["path", "bash.md"],
  ["path", "capbash.md"], ["path", "after-route.md"], ["path", "wsl.md"], ["path", "cyg.md"],
])
  check(flags(r1.stdout, kind, file), `flags ${kind} in ${file}`);

// A tracked directory (gitlink) is reported, not a crash.
const sub = repo({ "README.md": "x\n" });
mkdirSync(path.join(sub, "vendored"));
git(sub, "update-index", "--add", "--cacheinfo", `160000,${"a".repeat(40)},vendored`);
const rs = run(sub);
check(rs.status === 1 && flags(rs.stdout, "submodule", "vendored") && !/Error|at /.test(rs.stderr), "a gitlink is reported cleanly");

// The allow list waives size and weights only for the exact reviewed bytes, and content is still scanned.
const big = "y".repeat(5 * 1024 * 1024 + 1);
const sha = (s) => createHash("sha256").update(s).digest("hex");
const allowJson = (p, s) => JSON.stringify([{ path: p, sha256: s, reason: "test" }]);
check(run(repo({ "model.bin": big, "guard.allow.json": allowJson("model.bin", sha(big)) })).status === 0,
  "an allow-listed large file with its reviewed hash passes");
check(run(repo({ "m.onnx": "w", "guard.allow.json": allowJson("m.onnx", sha("w")) })).status === 0,
  "an allow-listed model file with its reviewed hash passes");
check(flags(run(repo({ "model.bin": big + "z", "guard.allow.json": allowJson("model.bin", sha(big)) })).stdout, "allow", "model.bin"),
  "an allow-listed file whose bytes changed fails");
check(flags(run(repo({ "README.md": "x\n", "guard.allow.json": allowJson("model.bin", sha(big)) })).stdout, "allow", "model.bin"),
  "an allow entry for an untracked file fails");
const keyed = "AKIA" + caps;
check(flags(run(repo({ "k.bin": keyed, "guard.allow.json": allowJson("k.bin", sha(keyed)) })).stdout, "secret", "k.bin"),
  "an allow-listed file is still scanned for secrets");

for (const d of made) rmSync(d, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks pass");
process.exitCode = failed ? 1 : 0;
