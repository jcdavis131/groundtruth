// Remove a git worktree without ever deleting through a junction or symlink inside it.
//   node scripts/worktree-remove.mjs [--dry-run] [--force] <worktree-path>
//
// Why: on 2026-10-18 a `git worktree remove` on Windows recursed through a node_modules junction that
// pointed at another checkout and emptied that checkout's node_modules. This script unlinks every link
// in the worktree first (the link itself, never its contents), proves none are left and that no link
// target outside the worktree lost entries, and only then asks git to remove the worktree.
//
// Steps, in order. Any refusal stops before git runs:
//   1. the path must be a linked worktree of this repo (not the main checkout, not the current directory);
//   2. walk it with lstat and collect every symlink or junction (Node reports Windows junctions as
//      symbolic links through lstat, checked on Windows 11 with Node 24);
//   3. unlink each one with fs.unlinkSync (rmdirSync as fallback), which removes only the link;
//   4. re-scan and refuse if any link remains;
//   5. compare each outside target's entry count before and after, refuse if any shrank;
//   6. run `git worktree remove` from the main checkout, then check the targets once more.
// --dry-run prints the worktree, every link with its target and entry count, and the git command,
// and changes nothing. --force is passed on to git worktree remove.
// Exit: 0 removed (or dry run ok), 1 refused or a target shrank, 2 usage.
//
// Credit: the idea that a worktree's links into another checkout must be checked before you trust or
// touch the worktree comes from mvschwarz/openrig, docs/reference/worktree-builds.md (Apache-2.0),
// commit fcaf1f8ee8f09bfc6388b937ea426e3d9496bb05. No text or code was copied; this is our own version.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const win = process.platform === "win32";

const norm = (p) => {
  let r = path.resolve(p);
  try {
    r = fs.realpathSync.native(r);
  } catch {}
  r = r.replace(/[\\/]+$/, "");
  return win ? r.replace(/\//g, "\\").toLowerCase() : r;
};
const inside = (child, parent) => child === parent || child.startsWith(parent + path.sep);
const git = (cwd, ...a) => execFileSync("git", ["-C", cwd, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

// Every symlink or junction under root, without following any of them.
export function findLinks(root) {
  const found = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch (e) {
      throw new Error(`cannot read ${dir}: ${e.code || e.message}`);
    }
    for (const name of names) {
      const p = path.join(dir, name);
      const st = fs.lstatSync(p);
      if (st.isSymbolicLink()) found.push(p);
      else if (st.isDirectory()) stack.push(p);
    }
  }
  return found.sort();
}

// What a link points at, and how much is there: entries for a directory, 1 for a file, 0 if missing.
function targetOf(link) {
  let raw;
  try {
    raw = fs.readlinkSync(link);
  } catch (e) {
    return { raw: `(unreadable: ${e.code})`, abs: null };
  }
  return { raw, abs: path.resolve(path.dirname(link), raw) };
}
export function entryCount(abs) {
  if (!abs) return 0;
  let st;
  try {
    st = fs.statSync(abs);
  } catch {
    return 0;
  }
  if (!st.isDirectory()) return 1;
  try {
    return fs.readdirSync(abs).length;
  } catch {
    return 0;
  }
}

// Removes the link itself. unlinkSync drops a symlink or a junction on Windows; rmdirSync covers the
// directory-symlink case some platforms report as EPERM/EISDIR. Neither ever recurses.
export function unlinkOnly(p) {
  try {
    fs.unlinkSync(p);
  } catch (e) {
    if (!["EPERM", "EISDIR", "EACCES"].includes(e.code)) throw e;
    fs.rmdirSync(p);
  }
}

// Returns { code, lines }. `opts.unlink` exists so the test can simulate a link that won't go away.
export function removeWorktree(wtArg, opts = {}) {
  const { dryRun = false, force = false, unlink = unlinkOnly, repo = here } = opts;
  const lines = [];
  const say = (s) => lines.push(s);
  const refuse = (s) => (say(`REFUSED: ${s}`), { code: 1, lines });

  // 1. A linked worktree of this repo.
  if (!fs.existsSync(wtArg)) return refuse(`${wtArg} does not exist`);
  const wt = norm(wtArg);
  let common, wtCommon, list;
  try {
    common = norm(path.resolve(repo, git(repo, "rev-parse", "--git-common-dir").trim()));
    list = git(repo, "worktree", "list", "--porcelain");
  } catch (e) {
    return refuse(`${repo} is not inside a git repo`);
  }
  try {
    wtCommon = norm(path.resolve(wtArg, git(wtArg, "rev-parse", "--git-common-dir").trim()));
  } catch {
    return refuse(`${wtArg} is not a git checkout`);
  }
  if (wtCommon !== common) return refuse(`${wtArg} belongs to another repo`);
  const trees = list
    .split(/\r?\n/)
    .filter((l) => l.startsWith("worktree "))
    .map((l) => norm(l.slice(9)));
  const main = trees[0];
  if (!trees.includes(wt)) return refuse(`${wtArg} is not in git worktree list`);
  if (wt === main) return refuse(`${wtArg} is the main checkout`);
  if (inside(norm(process.cwd()), wt)) return refuse(`the current directory is inside ${wtArg}`);
  say(`worktree ${wt}`);

  // 2. Every link, with its target and what the target holds now.
  let links;
  try {
    links = findLinks(wt).map((p) => {
      const t = targetOf(p);
      const outside = !!t.abs && !inside(norm(t.abs), wt);
      return { p, ...t, outside, before: entryCount(t.abs) };
    });
  } catch (e) {
    return refuse(e.message);
  }
  for (const l of links)
    say(`link ${path.relative(wt, l.p)} -> ${l.raw} (${l.before} entries${l.outside ? "" : ", inside the worktree"})`);
  if (!links.length) say("no links");
  const gitArgs = ["worktree", "remove", ...(force ? ["--force"] : []), wt];
  if (dryRun) {
    say(`would unlink ${links.length} link(s), then run: git -C ${main} ${gitArgs.join(" ")}`);
    return { code: 0, lines };
  }

  // 3. Unlink each link, never its contents.
  for (const l of links) {
    try {
      unlink(l.p);
      say(`unlinked ${path.relative(wt, l.p)}`);
    } catch (e) {
      say(`could not unlink ${path.relative(wt, l.p)}: ${e.code || e.message}`);
    }
  }

  // 4. Nothing may remain.
  let left;
  try {
    left = findLinks(wt);
  } catch (e) {
    return refuse(e.message);
  }
  if (left.length) return refuse(`${left.length} link(s) still in the worktree: ${left.map((p) => path.relative(wt, p)).join(", ")}`);

  // 5. No outside target may have shrunk.
  const shrank = (when) => {
    const bad = [];
    for (const l of links.filter((x) => x.outside)) {
      const now = entryCount(l.abs);
      if (now < l.before) bad.push(`${l.abs} ${l.before} -> ${now} (${when})`);
    }
    return bad;
  };
  let bad = shrank("after unlinking");
  if (bad.length) return refuse(`link target(s) lost entries: ${bad.join("; ")}`);

  // 6. Now git may remove it, from the main checkout.
  try {
    git(main, ...gitArgs);
  } catch (e) {
    say(`git worktree remove failed: ${String(e.stderr || e.message).trim()}`);
    return { code: 1, lines };
  }
  say("removed");
  bad = shrank("after git worktree remove");
  if (bad.length) {
    say(`ALARM: link target(s) lost entries after removal: ${bad.join("; ")}`);
    return { code: 1, lines };
  }
  return { code: 0, lines };
}

const isMain = process.argv[1] && norm(process.argv[1]) === norm(fileURLToPath(import.meta.url));
if (isMain) {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith("--")));
  const rest = args.filter((a) => !a.startsWith("--"));
  const unknown = [...flags].filter((f) => f !== "--dry-run" && f !== "--force");
  if (rest.length !== 1 || unknown.length) {
    console.error("usage: node scripts/worktree-remove.mjs [--dry-run] [--force] <worktree-path>");
    process.exit(2);
  }
  const r = removeWorktree(rest[0], { dryRun: flags.has("--dry-run"), force: flags.has("--force") });
  for (const l of r.lines) (r.code ? console.error : console.log)(l);
  process.exit(r.code);
}
