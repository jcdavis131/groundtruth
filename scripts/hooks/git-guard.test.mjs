// Self-test for scripts/hooks/git-guard.mjs: a table of commands that must be blocked or allowed, run
// against throwaway git repos for the rules that look at branch state, then the hook itself on stdin.
// Plain Node, no install.
//   node scripts/hooks/git-guard.test.mjs
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkCommand } from "./git-guard.mjs";

const hook = path.join(path.dirname(fileURLToPath(import.meta.url)), "git-guard.mjs");
const git = (dir, ...a) =>
  execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...a], {
    stdio: "ignore",
  });

// One repo, three checkouts: M on master, F on a local feature branch with no upstream, T on a branch that
// tracks origin/tracked. "merged" sits on master's commit; "unmerged" has a commit of its own. The shared
// stash list holds one stash tagged dup-tag.
const tmp = mkdtempSync(path.join(tmpdir(), "git-guard-"));
const M = path.join(tmp, "m");
const F = path.join(tmp, "f");
const T = path.join(tmp, "t");
execFileSync("git", ["init", "-q", M], { stdio: "ignore" });
git(M, "symbolic-ref", "HEAD", "refs/heads/master");
git(M, "config", "core.autocrlf", "false");
writeFileSync(path.join(M, "a.txt"), "a\n");
git(M, "add", "a.txt");
git(M, "commit", "-q", "-m", "one");
git(M, "branch", "merged");
git(M, "branch", "feature");
git(M, "branch", "tracked");
git(M, "checkout", "-q", "-b", "unmerged");
writeFileSync(path.join(M, "b.txt"), "b\n");
git(M, "add", "b.txt");
git(M, "commit", "-q", "-m", "two");
git(M, "checkout", "-q", "master");
git(M, "config", "branch.tracked.remote", "origin");
git(M, "config", "branch.tracked.merge", "refs/heads/tracked");
writeFileSync(path.join(M, "a.txt"), "changed\n");
git(M, "stash", "push", "-q", "-m", "dup-tag");
git(M, "worktree", "add", "-q", F, "feature");
git(M, "worktree", "add", "-q", T, "tracked");
const fwd = (p) => p.replace(/\\/g, "/");
const DIRS = { M, F, T, none: null };

// [expected, tool, command, cwd]. B = Bash, P = PowerShell.
const b64 = (s) => Buffer.from(s, "utf16le").toString("base64");
const CASES = [
  // push: force in every spelling and position
  ["deny", "B", "git push --force", "F"],
  ["deny", "B", "git push -f origin feature", "F"],
  ["deny", "B", "git push origin feature --force", "F"],
  ["deny", "B", "git push --force-with-lease origin feature", "F"],
  ["deny", "B", "git push --force-with-lease=feature:abc123 origin feature", "F"],
  ["deny", "B", "git push --force-if-includes origin feature", "F"],
  ["deny", "B", "git push -uf origin feature", "F"],
  ["deny", "B", "git push -fu origin feature", "F"],
  ["deny", "B", "git push origin +feature", "F"],
  ["deny", "B", "git push origin +HEAD:feature", "F"],
  ["deny", "B", "git push --mirror", "F"],
  ["deny", "B", "git push --all origin", "F"],
  // push: straight to master/main
  ["deny", "B", "git push origin master", "F"],
  ["deny", "B", "git push origin main", "F"],
  ["deny", "B", "git push origin HEAD:master", "F"],
  ["deny", "B", "git push origin HEAD:refs/heads/main", "F"],
  ["deny", "B", "git push origin feature:main", "F"],
  ["deny", "B", "git push origin :master", "F"],
  ["deny", "B", "git push --delete origin main", "F"],
  ["deny", "B", "git push -u origin feature master", "F"],
  ["deny", "B", "git push", "M"],
  ["deny", "B", "git push origin", "M"],
  ["deny", "B", "git push origin HEAD", "M"],
  ["deny", "B", "git push", "none"],
  // global options before the subcommand, and the directory they point at
  ["deny", "B", "git -C /tmp/repo push -f", "none"],
  ["deny", "B", "git -c core.askpass=x push --force origin feature", "F"],
  ["deny", "B", "git --no-pager push origin HEAD:master", "F"],
  ["deny", "B", `git -C '${M}' push`, "F"],
  ["deny", "B", `cd '${fwd(M)}' && git push`, "F"],
  ["deny", "B", "git --frobnicate push origin feature", "F"],
  // chaining and nesting
  ["deny", "B", "git status; git push -f", "F"],
  ["deny", "B", "git status && git push --force origin feature", "F"],
  ["deny", "B", "false || git push -f", "F"],
  ["deny", "B", "git log | head -1; git push origin HEAD:master", "F"],
  ["deny", "B", "git add -A &&\ngit commit -m wip &&\ngit push -f", "F"],
  ["deny", "B", "git status\ngit push origin main", "F"],
  ["deny", "B", "(git push -f)", "F"],
  ["deny", "B", "{ git push -f; }", "F"],
  ["deny", "B", 'echo "$(git push -f)"', "F"],
  ["deny", "B", "echo `git push --force`", "F"],
  ["deny", "B", "x=$(git push origin HEAD:master)", "F"],
  ["deny", "B", "git push -f origin feature &", "F"],
  ["deny", "B", "if git push -f; then echo ok; fi", "F"],
  // wrappers
  ["deny", "B", 'bash -c "git push --force"', "F"],
  ["deny", "B", "sh -c 'git push -f origin feature'", "F"],
  ["deny", "B", "bash -lc 'cd /tmp && git push -f'", "F"],
  ["deny", "B", 'eval "git push -f"', "F"],
  ["deny", "B", "sudo git push -f", "F"],
  ["deny", "B", "env GIT_TRACE=1 git push -f", "F"],
  ["deny", "B", "GIT_TRACE=1 git push -f", "F"],
  ["deny", "B", "command git push --force", "F"],
  ["deny", "B", "bash <<EOF\ngit push -f\nEOF", "F"],
  ["deny", "B", 'cmd /c "git push -f"', "F"],
  ["deny", "B", "cmd /c git push -f", "F"],
  // tricky quoting and names
  ["deny", "B", '"git" push "--force"', "F"],
  ["deny", "B", 'g"i"t push --force', "F"],
  ["deny", "B", "git push --for'ce' origin feature", "F"],
  ["deny", "B", "git push origin 'HEAD:mas''ter'", "F"],
  ["deny", "B", "git push origin HEAD:\\master", "F"],
  ["deny", "B", "/usr/bin/git push -f", "F"],
  ["deny", "B", "git.exe push -f", "F"],
  ["deny", "B", '"/c/Program Files/Git/cmd/git.exe" push --force', "F"],
  ["deny", "B", "git push origin feature 2>&1 --force", "F"],
  // can't be checked, so blocked
  ["deny", "B", "git push $FLAGS origin feature", "F"],
  ["deny", "B", 'git push origin "$BRANCH"', "F"],
  ["deny", "B", 'git push "$REMOTE" feature', "F"],
  ["deny", "B", "g\\it push --force", "F"],
  ["deny", "B", "git push origin $(git branch --show-current):master", "F"],
  ["deny", "B", "git $SUBCOMMAND origin", "F"],
  ["deny", "B", "$GIT push -f", "F"],
  ["deny", "B", 'git push "origin feature', "F"],
  ["deny", "B", "git commit -m 'unfinished", "F"],
  ["deny", "B", 'echo "$(git status"', "F"],
  // reset --hard on a shared branch
  ["deny", "B", "git reset --hard", "M"],
  ["deny", "B", "git reset --hard HEAD~1", "M"],
  ["deny", "B", "git reset --hard origin/tracked", "T"],
  ["deny", "B", "git reset --hard", "none"],
  ["deny", "B", "git reset $MODE", "M"],
  ["deny", "B", `git -C '${fwd(M)}' reset --hard`, "F"],
  // clean
  ["deny", "B", "git clean -fdx", "F"],
  ["deny", "B", "git clean -xdf", "F"],
  ["deny", "B", "git clean -f", "F"],
  ["deny", "B", "git clean --force -d", "F"],
  ["deny", "B", "git clean -d", "F"],
  ["deny", "B", "git -C /tmp/repo clean -ffdx", "none"],
  // branch -D of an unmerged branch
  ["deny", "B", "git branch -D unmerged", "M"],
  ["deny", "B", "git branch -d -f unmerged", "M"],
  ["deny", "B", "git branch --delete --force unmerged", "M"],
  ["deny", "B", "git branch -df unmerged", "M"],
  ["deny", "B", "git branch -D merged unmerged", "M"],
  ["deny", "B", "git branch -D", "M"],
  ["deny", "B", "git branch -D no-such-branch", "M"],
  ["deny", "B", 'git branch -D "$B"', "M"],
  ["deny", "B", "git branch -D merged", "none"],
  // stash without a unique tag
  ["deny", "B", "git stash", "F"],
  ["deny", "B", "git stash push", "F"],
  ["deny", "B", "git stash -u", "F"],
  ["deny", "B", "git stash push -- a.txt", "F"],
  ["deny", "B", "git stash save", "F"],
  ["deny", "B", 'git stash push -m ""', "F"],
  ["deny", "B", "git stash push -m dup-tag", "F"],
  ["deny", "B", "git stash save dup-tag", "F"],
  ["deny", "B", 'git stash push -m "$TAG"', "F"],
  ["deny", "B", "git stash push -m fresh-tag", "none"],
  // PowerShell
  ["deny", "P", "git push --force", "F"],
  ["deny", "P", "git status; git push -f origin feature", "F"],
  ["deny", "P", "git status && git push origin HEAD:master", "F"],
  ["deny", "P", "& git push -f", "F"],
  ["deny", "P", '& "C:\\Program Files\\Git\\cmd\\git.exe" push --force', "F"],
  ["deny", "P", "git push --`force origin feature", "F"],
  ["deny", "P", "git push origin 'HEAD:master'", "F"],
  ["deny", "P", 'git push origin "HEAD:$branch"', "F"],
  ["deny", "P", 'iex "git push -f"', "F"],
  ["deny", "P", "Invoke-Expression 'git push --force'", "F"],
  ["deny", "P", 'powershell -NoProfile -Command "git push -f"', "F"],
  ["deny", "P", `pwsh -EncodedCommand ${b64("git push --force")}`, "F"],
  ["deny", "P", `powershell -enc ${b64("git reset --hard")}`, "M"],
  ["deny", "P", "if ($true) { git push -f }", "F"],
  ["deny", "P", "git clean -fdx", "F"],
  ["deny", "P", "git stash", "F"],
  ["deny", "P", "git reset --hard", "M"],
  ["deny", "P", "git push", "M"],

  // allowed: feature-branch pushes
  ["allow", "B", "git push origin feature", "F"],
  ["allow", "B", "git push -u origin feature", "F"],
  ["allow", "B", "git push origin HEAD:feature", "F"],
  ["allow", "B", "git push origin feature:feature", "F"],
  ["allow", "B", "git push", "F"],
  ["allow", "B", "git push origin HEAD", "F"],
  ["allow", "B", "git push --no-force-with-lease origin feature", "F"],
  ["allow", "B", "git push -o ci.skip origin feature", "F"],
  ["allow", "B", "git push --tags", "M"],
  ["allow", "B", "git push origin tag v1.0", "F"],
  ["allow", "B", "git push origin --delete old-feature", "F"],
  ["allow", "B", "git push origin feature 2>&1", "F"],
  ["allow", "B", "git push origin feature > push.log", "F"],
  ["allow", "B", "git push origin feature # --force would be wrong", "F"],
  ["allow", "B", `git -C '${fwd(F)}' push`, "M"],
  ["allow", "B", "git fetch origin && git rebase origin/master && git push origin HEAD:feature", "F"],
  // allowed: git text that is only an argument
  ["allow", "B", 'git commit -m "never git push --force to master"', "F"],
  ["allow", "B", 'echo "git push --force"', "F"],
  ["allow", "B", "echo 'git push -f origin main'", "F"],
  ["allow", "B", 'grep -rn "git push --force" scripts', "F"],
  ["allow", "B", "git log --format='%h %s' -5 | head -3", "F"],
  ["allow", "B", "git commit -F - <<'EOF'\nBlock git push --force and git reset --hard.\ndon't\nEOF", "F"],
  ["allow", "B", "git commit -m \"$(cat <<'EOF'\nguard: block git push --force (it's risky)\nEOF\n)\"", "F"],
  ["allow", "B", "gh pr create --title 'Block git push -f' --body-file body.md", "F"],
  ["allow", "B", "gitk --all", "F"],
  ["allow", "B", "ls -la && npm test", "F"],
  ["allow", "B", "node scripts/guard.mjs", "none"],
  // allowed: other subcommands
  ["allow", "B", "git status && git diff --stat", "F"],
  ["allow", "B", "git -C /tmp/repo status", "none"],
  ["allow", "B", "git --version", "none"],
  ["allow", "B", "git clean -n", "F"],
  ["allow", "B", "git clean -ndx", "F"],
  ["allow", "B", "git clean --dry-run -d", "F"],
  ["allow", "B", "git reset --hard", "F"],
  ["allow", "B", "git reset --soft HEAD~1", "M"],
  ["allow", "B", "git reset HEAD a.txt", "M"],
  ["allow", "B", "git checkout -b new-thing && git reset --hard HEAD", "F"],
  ["allow", "B", "git branch -d unmerged", "M"],
  ["allow", "B", "git branch -D merged", "M"],
  ["allow", "B", "git branch -D feature", "M"],
  ["allow", "B", "git branch --list", "M"],
  ["allow", "B", "git stash push -m fresh-tag", "F"],
  ["allow", "B", "git stash -m 'fresh tag 2'", "F"],
  ["allow", "B", "git stash push -u -m forge-2026-10-18-a", "F"],
  ["allow", "B", "git stash push --message=fresh-tag", "F"],
  ["allow", "B", "git stash save fresh-tag", "F"],
  ["allow", "B", "git stash list", "F"],
  ["allow", "B", "git stash show -p stash@{0}", "F"],
  ["allow", "B", "git stash pop stash@{0}", "F"],
  ["allow", "B", "bash -c 'git status'", "F"],
  ["allow", "P", "git push origin feature", "F"],
  ["allow", "P", "git status; git log -1", "F"],
  ["allow", "P", 'git commit -m "no git push --force here"', "F"],
  ["allow", "P", "Get-ChildItem C:\\work | Select-Object -First 3", "F"],
  ["allow", "P", "git stash push -m fresh-tag", "F"],
  ["allow", "P", "git branch -D merged", "M"],
  ["allow", "P", "git reset --hard", "F"],
  ["allow", "P", `pwsh -EncodedCommand ${b64("git status")}`, "F"],
];

let failed = 0;
const check = (ok, msg) => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${msg}`);
};
const show = (s) => JSON.stringify(s.replaceAll(tmp, "<tmp>").replaceAll(fwd(tmp), "<tmp>"));

for (const [want, tool, cmd, dir] of CASES) {
  const why = checkCommand(cmd, tool === "P", DIRS[dir]);
  const got = why ? "deny" : "allow";
  check(got === want, `${want.padEnd(5)} ${tool} ${dir.padEnd(4)} ${show(cmd)}${got === want ? "" : `  (got ${got}${why ? ": " + why : ""})`}`);
}

// The hook end to end: stdin JSON in, exit code and stderr out.
const run = (input) => spawnSync(process.execPath, [hook], { input, encoding: "utf8" });
const payload = (tool_name, tool_input, cwd = F) => JSON.stringify({ session_id: "s", hook_event_name: "PreToolUse", cwd, tool_name, tool_input });
const HOOK_CASES = [
  [2, "Bash force push", payload("Bash", { command: "git push --force" })],
  [0, "Bash feature-branch push", payload("Bash", { command: "git push origin feature" })],
  [2, "PowerShell push to master", payload("PowerShell", { command: "git push origin HEAD:master" })],
  [0, "PowerShell feature-branch push", payload("PowerShell", { command: "git push -u origin feature" })],
  [0, "Bash without git", payload("Bash", { command: "ls -la" })],
  [0, "Read of a file named git-push-force", payload("Read", { file_path: "/tmp/git push --force.txt" })],
  [0, "Edit tool", payload("Edit", { file_path: "a.txt", old_string: "git push -f", new_string: "x" })],
  [2, "malformed JSON", '{"tool_name":"Bash","tool_input":{"command":"git push --force"'],
  [2, "malformed JSON without git", "{not json"],
  [2, "empty stdin", ""],
  [2, "a JSON array", "[1,2]"],
  [2, "Bash with no command string that mentions git", payload("Bash", { cmd: "git push -f" })],
  [0, "Bash with no command string and no git", payload("Bash", { description: "list files" })],
  [2, "no tool_name, mentions git", JSON.stringify({ tool_input: { command: "git push -f" } })],
  [0, "no tool_name, no git", JSON.stringify({ tool_input: { command: "ls" } })],
];
for (const [code, name, input] of HOOK_CASES) {
  const r = run(input);
  const reason = r.stderr.trim();
  const ok = r.status === code && (code === 2 ? reason.startsWith("git-guard blocked") : reason === "") && r.stdout === "";
  check(ok, `hook exits ${code}: ${name}${ok ? "" : `  (got ${r.status}, stderr ${JSON.stringify(reason)})`}`);
}

rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : `\nall ${CASES.length + HOOK_CASES.length} checks pass`);
process.exitCode = failed ? 1 : 0;
