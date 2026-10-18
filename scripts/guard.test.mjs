// Self-test for scripts/guard.mjs: one throwaway git repo with every kind of violation must fail on each,
// and a clean one must pass. Plain Node, no install.  node scripts/guard.test.mjs
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const guard = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "guard.mjs");
const git = (dir, ...a) => execFileSync("git", ["-C", dir, ...a], { stdio: "ignore" });
function repo(files) {
  const dir = mkdtempSync(path.join(tmpdir(), "guard-"));
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

const clean = repo({ "README.md": "# fine\nall LF\n", ".env.example": "KEY=\n" });
const r0 = run(clean);
check(r0.status === 0, "a clean repo passes");

const bad = repo({
  "big.json": "x".repeat(5 * 1024 * 1024 + 1),
  "model.safetensors": "w",
  ".env": "KEY=1\n",
  "crlf.txt": "a\r\nb\r\n",
  "aws.md": "key AKIA" + "ABCDEFGHIJKLMNOP\n",
  "gh.md": "ghp_" + "a".repeat(36) + "\n",
  "pk.md": "-----BEGIN " + "PRIVATE KEY-----\n",
  "home.md": "see C:" + "\\Users\\someone\\notes\n",
  "bash.md": "cd /c/" + "Users/someone/x\n",
});
const r1 = run(bad);
check(r1.status === 1, "a repo with violations fails");
for (const [kind, file] of [["size", "big.json"], ["weights", "model.safetensors"], ["env", ".env"], ["crlf", "crlf.txt"], ["secret", "aws.md"], ["secret", "gh.md"], ["secret", "pk.md"], ["path", "home.md"], ["path", "bash.md"]])
  check(new RegExp(`^${kind}\\s+${file.replace(".", "\\.")}`, "m").test(r1.stdout), `flags ${kind} in ${file}`);

rmSync(clean, { recursive: true, force: true });
rmSync(bad, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks pass");
process.exitCode = failed ? 1 : 0;
