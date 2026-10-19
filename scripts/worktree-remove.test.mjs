// Self-test for scripts/worktree-remove.mjs: a throwaway repo with a linked worktree that holds a
// junction (a plain symlink off Windows) to a target folder with files. The removal must leave the
// target intact, --dry-run must change nothing, and a link that can't be removed must stop it before
// git runs. Plain Node, no install.
//   node scripts/worktree-remove.test.mjs
// Everything lives under one temp root, the target included, and links are unlinked before any
// recursive cleanup, so a mistake here can only ever empty our own temp folder.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findLinks, removeWorktree } from "./worktree-remove.mjs";

const script = fileURLToPath(new URL("./worktree-remove.mjs", import.meta.url));
const git = (dir, ...a) =>
  execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...a], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });

let failed = 0;
const check = (ok, msg) => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${msg}`);
};

const root = fs.mkdtempSync(path.join(tmpdir(), "wt-remove-"));
const main = path.join(root, "main");
const target = path.join(root, "target");
fs.mkdirSync(path.join(target, "pkg"), { recursive: true });
for (const f of ["a.js", "b.js", "c.js"]) fs.writeFileSync(path.join(target, f), "x\n");
fs.writeFileSync(path.join(target, "pkg", "d.js"), "x\n");
const targetCount = () => fs.readdirSync(target).length + fs.readdirSync(path.join(target, "pkg")).length;
const full = targetCount();

execFileSync("git", ["init", "-q", main], { stdio: "ignore" });
git(main, "config", "core.autocrlf", "false");
fs.writeFileSync(path.join(main, ".gitignore"), "node_modules/\n");
fs.mkdirSync(path.join(main, "scripts"));
fs.copyFileSync(script, path.join(main, "scripts", "worktree-remove.mjs"));
git(main, "add", "-A");
git(main, "commit", "-q", "-m", "one");
const copy = path.join(main, "scripts", "worktree-remove.mjs");

// A worktree with node_modules as a junction to the target, plus a second link deeper down.
function worktree(name) {
  const wt = path.join(root, name);
  git(main, "worktree", "add", "-q", "-b", name, wt);
  fs.symlinkSync(target, path.join(wt, "node_modules"), "junction");
  fs.mkdirSync(path.join(wt, "apps", "map"), { recursive: true });
  fs.symlinkSync(target, path.join(wt, "apps", "map", "node_modules"), "junction");
  return wt;
}
const listed = (wt) => git(main, "worktree", "list", "--porcelain").includes(path.basename(wt));
const cli = (...a) => spawnSync(process.execPath, [copy, ...a], { cwd: root, encoding: "utf8" });

try {
  // Links are seen, through lstat, without following them.
  const w1 = worktree("w1");
  const links = findLinks(w1).map((p) => path.relative(w1, p).replace(/\\/g, "/"));
  check(links.length === 2 && links.includes("node_modules") && links.includes("apps/map/node_modules"), `finds both links (${links.join(", ")})`);

  // --dry-run lists everything and changes nothing.
  const d = cli("--dry-run", w1);
  check(d.status === 0, `dry run exits 0 (got ${d.status})`);
  check(/link node_modules -> /.test(d.stdout) && /would unlink 2 link\(s\)/.test(d.stdout), "dry run lists both links and the git command");
  check(listed(w1) && fs.lstatSync(path.join(w1, "node_modules")).isSymbolicLink() && targetCount() === full, "dry run leaves worktree, links and target alone");

  // The real removal: worktree gone, target untouched.
  const r = cli(w1);
  check(r.status === 0, `removal exits 0 (got ${r.status}) ${r.stderr.trim()}`);
  check(!listed(w1) && !fs.existsSync(w1), "worktree is gone from git and from disk");
  check(targetCount() === full, `link target still has all ${full} entries (has ${targetCount()})`);

  // A link that can't be removed: refuse before git runs, leave everything in place.
  const w2 = worktree("w2");
  const stuck = removeWorktree(w2, { repo: main, unlink: () => {} });
  check(stuck.code === 1 && stuck.lines.some((l) => /REFUSED: 2 link\(s\) still in the worktree/.test(l)), "refuses when links remain");
  check(listed(w2) && targetCount() === full, "refusal keeps the worktree and the target");
  const thrown = removeWorktree(w2, {
    repo: main,
    unlink: () => {
      throw Object.assign(new Error("locked"), { code: "EBUSY" });
    },
  });
  check(thrown.code === 1 && thrown.lines.some((l) => l.startsWith("REFUSED")) && listed(w2), "refuses when unlink throws");

  // A real permission failure, where the platform allows one.
  if (process.platform !== "win32" && process.getuid?.() !== 0) {
    const map = path.join(w2, "apps", "map");
    fs.chmodSync(map, 0o555);
    const p = cli(w2);
    fs.chmodSync(map, 0o755);
    check(p.status === 1 && /still in the worktree/.test(p.stderr) && listed(w2), "refuses when the link's folder is read-only");
  }

  // Not a worktree, and the main checkout itself.
  check(cli(target).status === 1, "refuses a folder that is not a worktree");
  check(cli(main).status === 1, "refuses the main checkout");
  check(cli().status === 2, "usage error with no path");

  // And with the stuck links gone, w2 removes cleanly.
  const ok2 = removeWorktree(w2, { repo: main });
  check(ok2.code === 0 && !listed(w2) && targetCount() === full, "second worktree removes once links can be unlinked");
} finally {
  for (const wt of ["w1", "w2"].map((n) => path.join(root, n)))
    if (fs.existsSync(wt)) for (const l of findLinks(wt)) fs.unlinkSync(l);
  if (findLinks(root).length === 0) fs.rmSync(root, { recursive: true, force: true });
  else console.log(`left ${root} in place: it still holds links`);
}

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
