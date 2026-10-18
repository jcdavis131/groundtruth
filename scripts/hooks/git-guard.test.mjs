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
for (const [name, value] of [
  ["pf", "push --force"],
  ["sh", "!git push -f origin feature"],
  ["pm", "push origin HEAD:master"],
  ["st", "status"],
  ["lg", "log --oneline"],
  ["pfe", "push origin feature"],
])
  git(M, "config", `alias.${name}`, value);
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
  ["deny", "B", "git push $'--force' origin feature", "F"],
  ["deny", "B", 'git push $"--force" origin feature', "F"],
  ["deny", "B", "cat <(git push -f)", "F"],
  ["deny", "B", "diff <(git status) >(git push origin HEAD:master)", "F"],
  ["deny", "B", "git push origin HEAD:heads/main", "F"],
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
  ["deny", "P", "git push origin feature <# note #> --force", "F"],
  ["deny", "P", "git push origin feature <# open comment", "F"],
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
  // long options cut to a unique prefix, which git accepts
  ["deny", "B", "git reset --har HEAD~1", "M"],
  ["deny", "B", "git reset --ha", "M"],
  ["deny", "B", "git push --mirr origin", "F"],
  ["deny", "B", "git push --al origin", "F"],
  ["deny", "B", "git push --bra origin", "F"],
  ["deny", "B", "git push --forc origin feature", "F"],
  ["deny", "B", "git push --for origin feature", "F"],
  ["deny", "B", "git push --force-w origin feature", "F"],
  ["deny", "B", "git push --rep=origin --forc feature", "F"],
  ["deny", "B", "git push --recei git-receive-pack origin", "M"],
  ["deny", "B", "git branch --del --forc unmerged", "M"],
  ["deny", "B", "git branch --de --force unmerged", "M"],
  ["deny", "B", "git branch -fd unmerged", "M"],
  ["deny", "B", "git branch -D -- unmerged", "M"],
  ["deny", "B", "git clean --forc -d", "F"],
  ["deny", "B", "git clean -e -n -f", "F"],
  ["deny", "B", "git clean --exclude -n -f", "F"],
  ["deny", "B", "git clean -n --no-dry-run -f", "F"],
  ["deny", "P", "git reset --har", "M"],
  ["deny", "P", "git push --mirr origin", "F"],
  // -- ends the options
  ["deny", "B", "git push -- origin +feature", "F"],
  ["deny", "B", "git push origin -- master", "F"],
  ["deny", "B", "git -- push -f", "F"],
  // wrappers whose options take a value
  ["deny", "B", "timeout 60 git push --force origin feature", "F"],
  ["deny", "B", "timeout -s KILL 60 git push -f origin feature", "F"],
  ["deny", "B", "nice -n 5 git push -f origin feature", "F"],
  ["deny", "B", "env -u FOO git push -f origin feature", "F"],
  ["deny", "B", "env -S 'git push -f origin feature'", "F"],
  ["deny", "B", "sudo -u root git push -f origin feature", "F"],
  ["deny", "B", "stdbuf -o0 git clean -fdx", "F"],
  ["deny", "B", "strace -f -o /dev/null git push -f origin feature", "F"],
  ["deny", "B", "ionice -c 3 nice -n 19 git reset --hard", "M"],
  ["deny", "B", "nohup timeout 5 sudo -E git push --force", "F"],
  ["deny", "B", "watch -n 5 'git push -f origin feature'", "F"],
  ["deny", "B", "su -c 'git push -f origin feature' root", "F"],
  ["deny", "B", "xargs -n 1 git push -f origin < list", "F"],
  ["deny", "B", "timeout $T git push -f", "F"],
  ["deny", "P", "timeout 5 git push -f origin x", "F"],
  // bash $'...' escapes
  ["deny", "B", "git push origin feature $'\\x2df'", "F"],
  ["deny", "B", "git push origin feature $'\\055\\055force'", "F"],
  ["deny", "B", "git push origin feature $'\\u002df'", "F"],
  ["deny", "B", "git push origin $'HEAD:mas\\x74er'", "F"],
  ["deny", "B", "git reset $'--\\x68ard'", "M"],
  ["deny", "B", "$'\\x67it' push -f origin feature", "F"],
  ["deny", "B", "git push origin feature $'-\\146'", "F"],
  // config the command brings with it
  ["deny", "B", "git -c push.default=upstream push", "F"],
  ["deny", "B", "git -c Push.Default=upstream push origin", "F"],
  ["deny", "B", "git -c remote.origin.push=HEAD:master push", "F"],
  ["deny", "B", "git -c include.path=/tmp/x push", "F"],
  ["deny", "B", "git --config-env=push.default=MODE push", "F"],
  ["deny", "B", "git -c $KEY push origin feature", "F"],
  ["deny", "B", "GIT_CONFIG_PARAMETERS=\"'push.default'='upstream'\" git push", "F"],
  ["deny", "B", "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=push.default GIT_CONFIG_VALUE_0=upstream git push", "F"],
  ["deny", "B", "env GIT_CONFIG_GLOBAL=/tmp/cfg git push", "F"],
  ["deny", "B", `GIT_DIR='${fwd(M)}/.git' git push`, "F"],
  ["deny", "B", `env GIT_DIR='${fwd(M)}/.git' git reset --hard`, "F"],
  ["deny", "B", "GIT_DIR=$D git push", "F"],
  // aliases
  ["deny", "B", "git pf origin feature", "F"],
  ["deny", "B", "git sh", "F"],
  ["deny", "B", "git pm", "F"],
  ["deny", "B", "git -c alias.p='push -f' p origin feature", "F"],
  ["deny", "B", "git -c 'alias.x=!git push --force' x", "F"],
  ["deny", "B", "git -c alias.y='reset --hard' y", "M"],
  ["deny", "B", "git no-such-command", "none"],
  // PowerShell quoting
  ["deny", "P", "git push origin feature ‘--force’", "F"],
  ["deny", "P", "git push origin “HEAD:master”", "F"],
  ["deny", "P", "git push @flags origin feature", "F"],

  // Round 5 findings: git inside a construct the guard doesn't model is denied, not guessed at.
  // PowerShell assignment: modeled, so the command after $x = is checked.
  ["deny", "P", "$r = git push origin feature:master", "F"],
  ["deny", "P", "$out = git push -f origin feature", "F"],
  ["deny", "P", "$r = git push --dry-run --porcelain origin feature:master", "F"],
  ["deny", "P", "[string]$x = git push origin feature:master", "F"],
  ["deny", "P", "$x += git push -f origin feature", "F"],
  ["deny", "P", "$x=git push origin HEAD:master", "F"],
  ["deny", "P", "$a = $b = git push -f origin feature", "F"],
  ["deny", "P", "$r = git reset --hard", "M"],
  // PowerShell script blocks of any kind, the safe-looking ones included (by design)
  ["deny", "P", "try { git push -f origin feature } catch {}", "F"],
  ["deny", "P", "try { git push origin feature:master } catch {}", "F"],
  ["deny", "P", "Invoke-Command { git push origin feature:master }", "F"],
  ["deny", "P", "Invoke-Command -ScriptBlock { git push -f origin feature }", "F"],
  ["deny", "P", "1 | % { git push -f origin feature }", "F"],
  ["deny", "P", "1 | ForEach-Object -Process { git push -f origin feature }", "F"],
  ["deny", "P", "1 | Where-Object { git push -f origin feature }", "F"],
  ["deny", "P", "Start-Job { git push -f origin feature }", "F"],
  ["deny", "P", "function p { git push -f origin feature }; p", "F"],
  ["deny", "P", "$h = @{ a = git push -f origin feature }", "F"],
  ["deny", "P", "try { git status } catch {}", "F"],
  ["deny", "P", "if ($LASTEXITCODE -eq 0) { git status }", "F"],
  ["deny", "P", "try { & 'git' push -f origin feature } catch {}", "F"],
  // PowerShell: a pipe into iex or a shell, and escapes the guard doesn't decode
  ["deny", "P", "'git push -f origin feature' | iex", "F"],
  ["deny", "P", "'git push -f origin feature' | Invoke-Expression", "F"],
  ["deny", "P", "'git push -f origin feature' | pwsh -NoProfile -Command -", "F"],
  ["deny", "P", "@'\ngit push -f origin feature\n'@ | powershell -", "F"],
  ["deny", "P", 'git push origin "-`u{66}"', "F"],
  ["deny", "P", 'git push origin "feature:mas`u{74}er"', "F"],
  // bash brace expansion and globs
  ["deny", "B", "git push origin feature:{master,x}", "F"],
  ["deny", "B", "git push origin {feature,master}", "F"],
  ["deny", "B", "git push origin ma{s,}ter", "F"],
  ["deny", "B", "git push origin feature:{ma,}ster", "F"],
  ["deny", "B", "{git,} push -f origin feature", "F"],
  ["deny", "B", "git push origin ma?ter", "F"],
  ["deny", "B", "git push origin mast*", "F"],
  // ways to start git or a shell the guard doesn't follow
  ["deny", "B", "find . -maxdepth 0 -exec git push -f origin feature \\;", "F"],
  ["deny", "B", "find . -maxdepth 0 -execdir git push origin feature:master \\;", "F"],
  ["deny", "B", "echo 'git push -f origin feature' | bash", "F"],
  ["deny", "B", "echo 'git push -f origin feature' | sh", "F"],
  ["deny", "B", "echo 'git push -f origin feature' | zsh -s", "F"],
  ["deny", "B", "printf 'git push -f origin feature' | bash -", "F"],
  ["deny", "B", "bash <<< 'git push -f origin feature'", "F"],
  ["deny", "B", "echo 'git push -f origin feature' | wsl", "F"],
  ["deny", "B", "echo git push -f origin feature | cmd", "F"],
  ["deny", "B", "coproc git push -f origin feature", "F"],
  ["deny", "B", "busybox sh -c 'git push -f origin feature'", "F"],
  ["deny", "B", "chronic git push -f origin feature", "F"],
  ["deny", "B", "caffeinate git push -f origin feature", "F"],
  ["deny", "B", "parallel git push -f origin ::: feature", "F"],
  ["deny", "B", "fish -c 'git push -f origin feature'", "F"],
  ["deny", "B", "flock /tmp/l -c 'git push -f origin feature'", "F"],
  ["deny", "B", "echo master | xargs git push origin", "F"],
  ["deny", "B", "echo master | xargs -I{} git push origin {}", "F"],
  ["deny", "B", "echo unmerged | xargs git branch -D", "M"],
  ["deny", "B", "ls | xargs -n1 sh -c 'git push origin $0'", "F"],
  ["deny", "B", "function f { git push -f origin feature; }; f", "F"],
  ["deny", "B", "X=command; $X git push -f origin feature", "F"],
  ["deny", "B", "python3 -c \"import os; os.system('git push -f')\"", "F"],
  ["deny", "B", "echo `git status`", "F"],
  ["deny", "B", "x=`git rev-parse HEAD`", "F"],
  // commands git itself runs, carried in config, the environment or arguments
  ["deny", "B", "GIT_EDITOR='git push -f origin master #' git commit", "F"],
  ["deny", "B", "export GIT_SEQUENCE_EDITOR='git push -f'; git rebase -i HEAD~2", "F"],
  ["deny", "B", "git -c core.editor='git push -f #' commit", "F"],
  ["deny", "B", "git -c core.sshCommand='git push -f origin master; ssh' fetch", "F"],
  ["deny", "B", "git rebase -x 'git push -f origin feature' master", "F"],
  ["deny", "B", "git submodule foreach 'git push -f'", "F"],
  ["deny", "B", "git bisect run git push -f origin feature", "F"],

  // Round 6 (fail5b): the six bypasses, each confirmed with a real dry run that pushed to master.
  ["deny", "P", "start git -ArgumentList 'push','-f','origin','feature'", "F"],
  ["deny", "P", "start git -ArgumentList 'push','--dry-run','origin','feature:master' -Wait -NoNewWindow", "F"],
  ["deny", "B", "echo 'git push -f origin feature' | source /dev/stdin", "F"],
  ["deny", "B", "echo 'git push -f origin feature' | . /dev/stdin", "F"],
  ["deny", "B", "echo 'git push -f origin feature' | xargs -I{} bash -c {}", "F"],
  ["deny", "B", "git push origin 'refs/heads/*:refs/heads/*'", "M"],
  ["deny", "B", 'git push origin "refs/heads/*"', "M"],
  ["deny", "P", "& (Get-Command git) push --dry-run origin feature:master", "F"],
  ["deny", "B", "shopt -s expand_aliases\nalias g='git push -f origin feature'\ng", "F"],
  // Round 6: the same rule, other shapes of it
  ["deny", "P", "Start-Process git -ArgumentList 'push','-f'", "F"],
  ["deny", "P", "saps git 'push -f'", "F"],
  ["deny", "B", "start git push -f origin feature", "F"],
  ["deny", "B", "alias g='git push -f origin feature'", "F"],
  ["deny", "B", "echo 'git push -f origin feature' > /dev/null; source ./push.sh", "F"],
  ["deny", "B", "echo 'git push -f origin feature' | parallel", "F"],
  ["deny", "B", "echo 'git push -f origin feature' | python3 -c 'import os,sys; os.system(sys.stdin.read())'", "F"],
  ["deny", "B", "echo 'git push -f origin feature' | while read l; do $l; done", "F"],
  ["deny", "P", "'git push -f origin feature' | % { & $_ }", "F"],
  ["deny", "P", "'git push -f origin feature' | ForEach-Object { iex $_ }", "F"],
  ["deny", "P", "$g = 'git'; & $g push -f origin feature", "F"],
  ["deny", "P", "& $g push -f origin feature; git status", "F"],
  ["deny", "P", "git status & git push -f origin feature", "F"],
  ["deny", "P", ". (Get-Command git) push -f origin feature", "F"],
  ["deny", "P", "[void](git push -f origin feature)", "F"],
  ["deny", "B", "git push origin 'feature:refs/heads/*'", "F"],
  ["deny", "B", "git push origin '*'", "F"],
  ["deny", "B", "git pu?h -f origin feature", "F"],
  ["deny", "B", "git branch -D unmerg*", "M"],
  ["deny", "B", "cat <<EOF\n$(git push -f origin feature)\nEOF", "F"],
  ["deny", "B", "cat <<EOF\n`git push -f origin feature`\nEOF", "F"],
  ["deny", "B", "cmd /c g^it push -f origin feature", "F"],
  ["deny", "B", "ssh localhost 'git push -f origin feature'", "F"],
  ["deny", "B", "git config alias.pf '!git push -f origin feature'", "F"],
  ["deny", "B", "git config core.sshCommand 'git push -f origin master; ssh'", "F"],
  ["deny", "B", "git log | sort -S 1 --compress-program=bash", "F"],
  ["deny", "B", "git log | rg --pre bash x", "F"],
  ["deny", "B", "git log | less", "F"],
  ["deny", "B", "git status; X='git push -f origin feature'; $X", "F"],
  ["deny", "B", "env git push -f origin feature", "F"],
  ["deny", "B", "bash -c 'git status'", "F"],
  ["deny", "P", `pwsh -EncodedCommand ${b64("git status")}`, "F"],
  ["deny", "P", `pwsh -EncodedCommand ${b64("git push -f origin feature")}`, "F"],
  ["deny", "B", "git log $(git merge-base HEAD master)..HEAD", "F"],
  ["deny", "B", "(git status)", "F"],
  ["deny", "B", "{ git status; }", "F"],
  ["deny", "B", "timeout --frob 5 git push origin feature", "F"],
  ["deny", "B", "exec git push -f origin feature", "F"],
  ["deny", "B", "git status && sudo -n true", "F"],
  ["deny", "P", 'Write-Output @"\n$(git push -f origin feature)\n"@', "F"],
  ["deny", "P", "Set-Alias g git; g push -f origin feature", "F"],
  ["deny", "B", "git status && $(echo git) push -f origin feature", "F"],
  ["deny", "B", "git status | bash", "F"],

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
  ["allow", "P", "git push origin feature", "F"],
  ["allow", "P", "git status; git log -1", "F"],
  ["allow", "P", 'git commit -m "no git push --force here"', "F"],
  ["allow", "P", "Get-ChildItem C:\\work | Select-Object -First 3", "F"],
  ["allow", "P", "git stash push -m fresh-tag", "F"],
  ["allow", "P", "git branch -D merged", "M"],
  ["allow", "P", "git reset --hard", "F"],
  // allowed: prefixes that aren't the dangerous option, and wrappers around safe git
  ["allow", "B", "git push --fol origin feature", "F"],
  ["allow", "B", "git push --no-force-with-lease origin feature", "F"],
  ["allow", "B", "git push --rep=origin feature", "F"],
  ["allow", "B", "git push --dry origin feature", "F"],
  ["allow", "B", "git clean --dry -d", "F"],
  ["allow", "B", "git clean -e build -n", "F"],
  ["allow", "B", "git branch --del merged", "M"],
  ["allow", "B", "git reset --soft HEAD~1 -- a.txt", "M"],
  ["allow", "B", "git -c core.quotepath=off push origin feature", "F"],
  ["allow", "B", "timeout 60 git status", "F"],
  ["allow", "B", "nice -n 5 git push origin feature", "F"],
  ["allow", "B", "GIT_TRACE=1 git push origin feature", "F"],
  ["allow", "B", `GIT_DIR='${fwd(M)}/.git' git status`, "F"],
  ["allow", "B", `GIT_DIR='${fwd(M)}/.git' git push origin feature`, "F"],
  ["allow", "B", "echo $'git push \\x2df'", "F"],
  ["allow", "B", "git st", "F"],
  ["allow", "B", "git lg -5", "F"],
  ["allow", "B", "git pfe", "F"],
  ["allow", "B", "git -c alias.p='push' p origin feature", "F"],
  ["allow", "P", "timeout 5 git status", "F"],
  ["allow", "P", "git commit -m ‘no --force here’", "F"],
];

// False positives. Everyday commands an agent runs all day, which must stay allowed now that git the guard
// can't resolve is denied. [tool, command, cwd]; every one must pass.
const SAFE = [
  ["B", "git status", "F"],
  ["B", "git status -sb", "F"],
  ["B", "git log --oneline -10", "F"],
  ["B", "git log origin/master..HEAD --format='%h %s'", "F"],
  ["B", "git diff --stat HEAD~1", "M"],
  ["B", "git diff | cat", "F"],
  ["B", "git show HEAD --stat", "F"],
  ["B", "git add -A", "F"],
  ["B", "git add scripts/hooks/git-guard.mjs scripts/hooks/git-guard.test.mjs", "F"],
  ["B", 'git commit -m "guard: block push --force to master"', "F"],
  ["B", "git commit -m 'never force push to main; push a branch'", "F"],
  ["B", 'git commit -m "fix: the master push went through with --force, now it does not"', "F"],
  ["B", "git commit --amend --no-edit", "F"],
  ["B", "git fetch origin", "F"],
  ["B", "git fetch --all --prune", "F"],
  ["B", "git pull --ff-only", "F"],
  ["B", "git push origin feature", "F"],
  ["B", "git push -u origin feature", "F"],
  ["B", "git push origin HEAD:feature", "F"],
  ["B", "git worktree add /tmp/wt-new -b wt-new", "M"],
  ["B", "git worktree list", "M"],
  ["B", "git checkout -b new-branch", "F"],
  ["B", "git switch feature", "M"],
  ["B", "git rebase origin/master", "F"],
  ["B", "git rebase -x 'npm test' origin/master", "F"],
  ["B", "git merge --ff-only origin/feature", "F"],
  ["B", "git rev-parse --abbrev-ref HEAD", "F"],
  ["B", "git branch --show-current", "F"],
  ["B", "git remote -v", "F"],
  ["B", "git remote add upstream git@github.com:example/repo.git", "F"],
  ["B", "git clone https://github.com/example/repo.git /tmp/repo", "none"],
  ["B", "git tag v1.2.3", "F"],
  ["B", "git restore --staged a.txt", "F"],
  ["B", "git stash list", "F"],
  ["B", "git ls-files | wc -l", "F"],
  ["B", "git ls-files -z | xargs -0 git add", "F"],
  ["B", "git status && git diff && git log -1", "F"],
  ["B", "git fetch && git status", "F"],
  ["B", 'git add -A && git commit -m "push the master copy, not a force" && git push origin feature', "F"],
  ["B", `cd '${fwd(F)}' && git status`, "M"],
  ["B", "git -C /tmp/repo log -1", "none"],
  ["B", "GIT_TRACE=1 git fetch origin", "F"],
  ["B", "timeout 120 git fetch origin", "F"],
  ["B", 'timeout 120 git commit -m "teach git to push to a branch, not master"', "F"],
  ["B", "for f in a.txt; do git add \"$f\"; done", "F"],
  ["B", 'gh pr create --title "Block force push to master" --body "git push --force is denied"', "F"],
  ["B", "gh pr view 5 --json body -q .body", "F"],
  ["B", "gh pr checks 5 --watch", "F"],
  ["B", "gh run list --branch git-guardrail", "F"],
  ["B", "gh api repos/example/repo/branches/master/protection", "F"],
  ["B", "ls ~/git/projects", "F"],
  ["B", "cat .gitignore .git/config", "F"],
  ["B", "mkdir -p /tmp/git-work && cd /tmp/git-work && ls", "F"],
  ["B", "cp .gitattributes /tmp/gitattributes.bak", "F"],
  ["B", "ssh -T git@github.com", "F"],
  ["B", "node scripts/hooks/git-guard.test.mjs", "F"],
  ["B", 'grep -rn "git push --force" scripts/', "F"],
  ["B", "echo 'remember: git push --force is blocked'", "F"],
  ["B", "npm test && npm run lint", "F"],
  ["B", "which git && git --version", "F"],
  ["P", "git status; git log -1", "F"],
  ["P", "$branch = git rev-parse --abbrev-ref HEAD", "F"],
  ["P", "$out = git status --porcelain", "F"],
  ["P", "$r = git push origin feature", "F"],
  ["P", "git push origin feature", "F"],
  ["P", 'git commit -m "do not force push to master"', "F"],
  ["P", "git add -A; git commit -m 'guard: push to a branch'; git push -u origin feature", "F"],
  ["P", "Get-ChildItem /tmp/git | Select-Object -First 3", "F"],
  ["P", "Set-Location /tmp/repo; git -C /tmp/repo status", "none"],
  ["P", "Test-Path .git", "F"],
  ["P", "Get-Content .gitignore", "F"],
  ["P", 'Write-Output "git push is guarded"', "F"],
  ["P", "Get-ChildItem | ForEach-Object { $_.Name }; git status", "F"],
  ["P", "git log -1 | Select-Object -First 1", "F"],
  // round 6: the structural rule must leave these alone
  ["B", "command -v git && type git", "F"],
  ["B", "git add src/*.js", "F"],
  ["B", "git log -5 | tee /tmp/log.txt", "F"],
  ["B", "time git status", "F"],
  ["B", "nice -n 5 git status", "F"],
  ["B", 'git log --since="$(date +%F)" -3', "F"],
  ["B", "git commit -m \"$(cat <<'EOF'\nfix: never git push --force to master\nEOF\n)\"", "F"],
  ["B", "git status | grep -c modified", "F"],
  ["P", "git diff | ForEach-Object { Write-Output $_ }", "F"],
  ["P", "if (Test-Path .git) { Write-Output ok }; git status", "F"],
  ["P", "$files = git diff --name-only; git add $files", "F"],
  ["P", "git log -3 | Out-String", "F"],
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
let safeDenied = 0;
for (const [tool, cmd, dir] of SAFE) {
  const why = checkCommand(cmd, tool === "P", DIRS[dir]);
  if (why) safeDenied++;
  check(!why, `safe  ${tool} ${dir.padEnd(4)} ${show(cmd)}${why ? `  (denied: ${why})` : ""}`);
}
check(SAFE.length >= 74, `the false-positive table has at least 74 rows (${SAFE.length})`);

// The hook end to end: stdin JSON in, exit code and stderr out.
const run = (input) => spawnSync(process.execPath, [hook], { input, encoding: "utf8" });
const payload = (tool_name, tool_input, cwd = F) => JSON.stringify({ session_id: "s", hook_event_name: "PreToolUse", cwd, tool_name, tool_input });
const HOOK_CASES = [
  [2, "Bash force push", payload("Bash", { command: "git push --force" })],
  [0, "Bash feature-branch push", payload("Bash", { command: "git push origin feature" })],
  [2, "Bash force push behind timeout 60", payload("Bash", { command: "timeout 60 git push --force origin feature" })],
  [2, "Bash push behind -c push.default=upstream", payload("Bash", { command: "git -c push.default=upstream push" })],
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
  [2, "PowerShell $r = git push to master", payload("PowerShell", { command: "$r = git push origin feature:master" })],
  [0, "PowerShell $branch = git rev-parse", payload("PowerShell", { command: "$branch = git rev-parse --abbrev-ref HEAD" })],
  [2, "PowerShell try { } around a push to master", payload("PowerShell", { command: "try { git push origin feature:master } catch {}" })],
  [2, "PowerShell Invoke-Command script block", payload("PowerShell", { command: "Invoke-Command -ScriptBlock { git push -f origin feature }" })],
  [2, "Bash brace expansion to master", payload("Bash", { command: "git push origin feature:{master,x}" })],
  [2, "Bash find -exec git push", payload("Bash", { command: "find . -maxdepth 0 -exec git push -f origin feature \\;" })],
  [2, "Bash pipe into bash", payload("Bash", { command: "echo 'git push -f origin feature' | bash" })],
  [2, "Bash here-string into bash", payload("Bash", { command: "bash <<< 'git push -f origin feature'" })],
  [2, "Bash coproc", payload("Bash", { command: "coproc git push -f origin feature" })],
  [2, "PowerShell start (Start-Process alias) git", payload("PowerShell", { command: "start git -ArgumentList 'push','-f','origin','feature'" })],
  [2, "Bash pipe into source /dev/stdin", payload("Bash", { command: "echo 'git push -f origin feature' | source /dev/stdin" })],
  [2, "Bash pipe into . /dev/stdin", payload("Bash", { command: "echo 'git push -f origin feature' | . /dev/stdin" })],
  [2, "Bash pipe into xargs bash -c", payload("Bash", { command: "echo 'git push -f origin feature' | xargs -I{} bash -c {}" })],
  [2, "Bash quoted wildcard refspec", payload("Bash", { command: "git push origin 'refs/heads/*:refs/heads/*'" })],
  [2, "PowerShell & (Get-Command git)", payload("PowerShell", { command: "& (Get-Command git) push --dry-run origin feature:master" })],
  [2, "Bash alias holding git", payload("Bash", { command: "shopt -s expand_aliases\nalias g='git push -f origin feature'\ng" })],
  [0, "Bash commit with a heredoc message", payload("Bash", { command: "git commit -m \"$(cat <<'EOF'\nno git push --force\nEOF\n)\"" })],
  [0, "Bash plain && chain",payload("Bash", { command: 'git add -A && git commit -m "no force push to master" && git push origin feature' })],
];
for (const [code, name, input] of HOOK_CASES) {
  const r = run(input);
  const reason = r.stderr.trim();
  const ok = r.status === code && (code === 2 ? reason.startsWith("git-guard blocked") : reason === "") && r.stdout === "";
  check(ok, `hook exits ${code}: ${name}${ok ? "" : `  (got ${r.status}, stderr ${JSON.stringify(reason)})`}`);
}

rmSync(tmp, { recursive: true, force: true });
const nDeny = CASES.filter((c) => c[0] === "deny").length;
console.log(
  `\ndeny cases ${nDeny}, allow cases ${CASES.length - nDeny}, false-positive table ${SAFE.length} (${safeDenied} denied), stdin hook cases ${HOOK_CASES.length}`,
);
console.log(failed ? `${failed} check(s) failed` : `all ${CASES.length + SAFE.length + 1 + HOOK_CASES.length} checks pass`);
process.exitCode = failed ? 1 : 0;
