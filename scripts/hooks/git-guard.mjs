#!/usr/bin/env node
// git-guard: a Claude Code PreToolUse hook that blocks destructive git commands in Bash and PowerShell.
// Plain Node, no install, no jq. It reads the hook JSON on stdin and exits 2 to block (the reason goes to
// stderr, which Claude Code shows to the agent) or 0 to let the command run.
//
//   node scripts/hooks/git-guard.mjs < hook-input.json
//
// Threat model. This is a local seatbelt against an agent's mistakes, not a security boundary. Someone set
// on getting past it can, from outside the shell text it reads. GitHub branch protection is what enforces
// the remote rules on eye and groundtruth: enforce_admins on, no force push, no deletion of the default
// branch. The hook catches the mistake before it reaches the remote and says why.
// Known out of scope: python -c, node -e and perl -e calling git (git in their text is denied, git built
// at run time isn't seen), git update-ref, git run from a script file, and commands built from variables.
//
// Design. One rule, so it converges instead of chasing shapes. A command with no git token in it (git,
// git.exe, a path ending in /git, also spelled g"i"t, g\it, g^it, $'\x67it' or inside a PowerShell
// -EncodedCommand) passes untouched. A command with the token is allowed only when every place it appears is:
//   (a) the command of a simple segment: [NAME=value ...] [! if then else elif do while until] [timeout,
//       nice, time or nohup, every option read] git ..., or a PowerShell "$x = git ...", and the precise
//       checker below resolves that git as safe;
//   (b) data given to a text tool that can't run anything (echo, printf, cat, grep, rg, ls, head, tail, wc,
//       sort, tee, which, gh, Write-Output, Select-String, Select-Object ...), also inside a $( ) whose
//       segments are all such tools, so git commit -m "$(cat <<'EOF' ...)" still works;
//   (c) xargs [known options] git ..., checked with the input as an unknown word.
// Anywhere else it is denied, and the reason names the construct: ( ), $( ), backticks, a bash { } group, a
// PowerShell { } block, brace expansion, a glob in the git subcommand or in a guarded subcommand's words, a
// heredoc whose delimiter is unquoted and whose body has $( ), an alias, a function, eval, source, ., iex,
// start, Start-Process, cmd, wsl, a shell, env or sudo in front of a command, find -exec, a command name
// from a variable or an expression (& $g, & (Get-Command git)), a variable set to text with git in it, a
// pipe into anything but a text tool, or a command the guard doesn't model with git in its words. Launchers
// (eval, source, ., bash, start, alias, env, sudo ...) are denied anywhere in a command that has git,
// whatever their own words, since they may read the git from a pipe, a here-string or a variable.
// Constructs that hold no git are left alone: Get-ChildItem | ForEach-Object { $_.Name }; git status passes.
// Some safe commands are denied on purpose: bash -c 'git status', (git status), echo `git x`,
// b=$(git rev-parse HEAD), msg="... git ..."; git commit -m "$msg", git add src/{a,b}.js,
// if ($x) { git status }. Run git as its own command instead (PowerShell $b = git ... is fine).
//
// Blocks:
//   push      --force, -f (alone or in a cluster like -fu), --force-with-lease, --force-if-includes,
//             a +refspec, --mirror, --all/--branches, and any push whose destination is master or main
//             (origin main, HEAD:master, feature:refs/heads/main, :master). With no refspec, or with HEAD as
//             the refspec, it looks up the current branch and blocks when that is master or main.
//   reset     --hard on a shared branch: master, main, or any branch with an upstream. Allowed on a local
//             branch with no upstream and on a detached HEAD.
//   clean     anything but a dry run (-n/--dry-run). -f, -fdx and -xdf are all blocked, and so is a plain
//             clean, which runs without -f when clean.requireForce is off.
//   branch    -D, or -d with -f/--force, of a branch that isn't merged into HEAD, its upstream, or
//             main/master (local or origin). Plain -d is left to git, which refuses unmerged branches.
//   stash     creating a stash (bare stash, stash push, stash save, stash -u ...) without a -m message, or
//             with a message an existing stash already has. Agents share a repo's stash list, so each
//             stash needs a tag that names it.
// Long options count when cut to a prefix, the way git reads them (--har is --hard, --mirr is --mirror,
// --del --forc is --delete --force), and -- ends the options.
// git expands * in a push refspec itself, so any push word with * in it is blocked, quoted or not. git config
// storing a value with git in it (alias.x "!git push -f", core.sshCommand) is blocked too.
// It decodes bash $'...' escapes ($'\x2df' is -f) and reads PowerShell curly quotes as plain ones.
// It skips git's global options (-C dir, -c k=v, --git-dir ...) and follows -C, --git-dir, GIT_DIR and cd
// for the lookups. It never runs config the command brings: a push carrying -c push.*, remote.*, branch.*
// or include.*, or GIT_CONFIG* in its environment, is blocked. An alias (git pf) is read from the command's
// own -c alias.* or the repo's config and checked as what it expands to.
// Quoted text that is only an argument (a commit message, an echo) is not a command and isn't checked.
//
// Fails closed: input that isn't JSON, a git command it can't parse (an open quote, an unknown option before
// the subcommand, a push argument from a variable), or a lookup that fails (no repo, no cwd) all block.
// A tool other than Bash/PowerShell, and a command with no git in it, pass untouched, so a wide matcher
// can't wedge every tool call if the input shape changes.
//
// Not covered: push.default=matching or remote.<name>.push refspecs set in the repo's own config; anything
// an earlier command in the same line changes before git runs (git config alias.x ... && git x, git
// checkout master && git push), since the lookups read the repo as it is now; commands built at run time
// from variables (blocked when the subcommand or a push option is a variable, missed when the whole command
// is); git run from a script file; and gh commands that move refs (gh repo sync --force). It is a
// guardrail against mistakes, not a sandbox.
//
// Idea from mattpocock/skills (MIT, (c) 2026 Matt Pocock), misc/git-guardrails-claude-code at 49dd158.
// No code copied. That script reads its input with jq, so it fails open where jq isn't installed, and it
// blocks every git push. This one needs only Node, fails closed, and allows a push to a feature branch.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SHELL_TOOLS = new Set(["Bash", "PowerShell"]);
const PROTECTED = /^(?:master|main)$/i;
const MAX_DEPTH = 8;

// ---------- lexer ----------
// lex() splits a command line into segments (one simple command each) of words {text, dyn}. dyn marks a
// word that holds a variable or a substitution, so its run-time value is unknown. Command substitutions
// ($( ) and bash backticks) are lexed as nested results. ps selects PowerShell quoting: backtick escapes,
// '' inside single quotes, no backtick substitution, @' '@ here-strings.
class LexError extends Error {}

// meta collects what the structural rule needs from the whole text: the spans of PowerShell { } blocks
// and whether a bash backtick body mentions git. Nested $( ) lexes share it.
function lex(src, ps, start = 0, inSub = false, meta = { spans: [], open: [], hiddenGit: null }) {
  const esc = ps ? "`" : "\\";
  const segs = [];
  const subs = [];
  // A segment carries what the structural check needs: heredoc bodies (and whether the shell expands them),
  // whether it reads a pipe, and whether it sits inside ( ).
  const newSeg = () => Object.assign([], { bodies: [], expand: [], ps, piped: false, group: false });
  let seg = newSeg();
  let word = null;
  let skipNext = false; // the next word is a redirect target
  let hereNext = null; // the next word is a heredoc delimiter
  const pending = []; // heredocs whose bodies start at the next newline
  let depth = 0;
  let i = start;
  const n = src.length;
  const startWord = () => (word ??= { text: "", dyn: false });
  const endWord = () => {
    if (!word) return;
    if (hereNext) {
      pending.push({ delim: word.text, dash: hereNext.dash, seg, quoted: !!word.quoted });
      hereNext = null;
    } else if (skipNext) skipNext = false;
    else seg.push(word);
    word = null;
  };
  const endSeg = () => {
    endWord();
    if (seg.length) {
      seg.group = depth > 0;
      segs.push(seg);
    }
    seg = newSeg();
  };
  const sub = (from) => {
    const r = lex(src, ps, from, true, meta);
    subs.push(r);
    startWord().dyn = true;
    return r.end + 1;
  };
  const backtick = (from) => {
    let j = from;
    while (j < n && src[j] !== "`") j += src[j] === "\\" ? 2 : 1;
    if (j >= n) throw new LexError("an open backtick");
    // Inside backticks bash removes one level of backslashes before it parses, which this lexer doesn't
    // copy. So git inside backticks is never treated as resolved; $( ) is.
    if (tokenIn(src.slice(from, j))) meta.hiddenGit ??= "bash backticks, whose escaping the guard doesn't model, hold git";
    subs.push(lex(src.slice(from, j), false));
    startWord().dyn = true;
    return j + 1;
  };
  const varStart = (c) => c !== undefined && /[A-Za-z_{@*#?!0-9:]/.test(c);
  const readHeredocs = (from) => {
    let j = from;
    for (const h of pending.splice(0)) {
      const lines = [];
      while (j < n) {
        let e = src.indexOf("\n", j);
        if (e < 0) e = n;
        let line = src.slice(j, e).replace(/\r$/, "");
        j = e + 1;
        if ((h.dash ? line.replace(/^\t+/, "") : line) === h.delim) break;
        lines.push(line);
      }
      h.seg.bodies.push(lines.join("\n"));
      h.seg.expand.push(!h.quoted); // <<EOF expands $( ) and backticks in the body; <<'EOF' doesn't
    }
    return j;
  };

  while (i < n) {
    const c = src[i];
    if (c === esc) {
      if (src[i + 1] === "\n") i += 2; // line continuation
      else if (i + 1 < n) {
        startWord().quoted = true;
        word.text += src[i + 1];
        i += 2;
      } else i++;
      continue;
    }
    if (!ps && c === "$" && src[i + 1] === "'") {
      // bash $'...': decode the escapes the way bash does, so $'\x2df' is -f
      startWord().quoted = true;
      let j = i + 2;
      for (;;) {
        if (j >= n) throw new LexError("an open $' quote");
        if (src[j] === "'") break;
        if (src[j] === "\\") {
          const [s, len] = ansiEscape(src, j + 1);
          word.text += s;
          j += 1 + len;
        } else word.text += src[j++];
      }
      i = j + 1;
      continue;
    }
    if (!ps && c === "$" && src[i + 1] === '"') {
      i++; // bash $"...": the $ goes, the quote stays
      continue;
    }
    if (ps && c === "@" && !word && /[A-Za-z_?]/.test(src[i + 1] ?? "")) {
      startWord().dyn = true; // PowerShell splatting: @args expands to words the guard can't see
      word.text += c;
      i++;
      continue;
    }
    if (ps && src.startsWith("<#", i)) {
      const close = src.indexOf("#>", i + 2);
      if (close < 0) throw new LexError("an open <# comment");
      endWord();
      i = close + 2;
      continue;
    }
    if (c === "'") {
      startWord().quoted = true;
      let j = i + 1;
      for (;;) {
        const k = src.indexOf("'", j);
        if (k < 0) throw new LexError("an open single quote");
        word.text += src.slice(j, k);
        if (ps && src[k + 1] === "'") {
          word.text += "'";
          j = k + 2;
        } else {
          i = k + 1;
          break;
        }
      }
      continue;
    }
    if (c === '"') {
      startWord().quoted = true;
      i++;
      for (;;) {
        if (i >= n) throw new LexError("an open double quote");
        const d = src[i];
        if (d === '"') {
          if (ps && src[i + 1] === '"') {
            word.text += '"';
            i += 2;
            continue;
          }
          i++;
          break;
        }
        if (d === esc) {
          if (ps) {
            // "`u{66}" is f and "`n" a newline in PowerShell double quotes. The guard doesn't decode these,
            // so a word with one is treated like a variable.
            if (/[0abefnrtuv]/.test(src[i + 1] ?? "")) word.dyn = true;
            word.text += src[i + 1] ?? "";
            i += 2;
          } else if ("$`\"\\\n".includes(src[i + 1] ?? "")) {
            if (src[i + 1] !== "\n") word.text += src[i + 1];
            i += 2;
          } else {
            word.text += d;
            i++;
          }
          continue;
        }
        if (d === "$" && src[i + 1] === "(") {
          i = sub(i + 2);
          continue;
        }
        if (!ps && d === "`") {
          i = backtick(i + 1);
          continue;
        }
        if (d === "$" && varStart(src[i + 1])) word.dyn = true;
        word.text += d;
        i++;
      }
      continue;
    }
    if (ps && c === "@" && (src[i + 1] === "'" || src[i + 1] === '"') && /^[ \t]*\r?\n/.test(src.slice(i + 2, i + 40))) {
      const q = src[i + 1];
      const close = src.indexOf("\n" + q + "@", i + 2);
      if (close < 0) throw new LexError("an open here-string");
      const body = src.slice(src.indexOf("\n", i + 2) + 1, close);
      startWord().quoted = true;
      word.text += body;
      if (q === '"' && /[$`]/.test(body)) word.dyn = true;
      if (q === '"' && /\$\(/.test(body) && tokenIn(body)) meta.hiddenGit ??= "a PowerShell @\" \"@ here-string runs the $( ) in it, and it has git in it";
      i = close + 3;
      continue;
    }
    if (c === "$" && src[i + 1] === "(") {
      i = sub(i + 2);
      continue;
    }
    if (c === "$" && varStart(src[i + 1])) {
      startWord().dyn = true;
      word.text += c;
      i++;
      continue;
    }
    if (!ps && c === "`") {
      i = backtick(i + 1);
      continue;
    }
    if (c === "#" && !word) {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r") {
      endWord();
      i++;
      continue;
    }
    if (c === "\n") {
      endSeg();
      i = pending.length ? readHeredocs(i + 1) : i + 1;
      continue;
    }
    if (c === ";") {
      endSeg();
      i++;
      continue;
    }
    if (ps && c === "&" && src[i + 1] !== "&" && !word && !seg.length && !/^[ \t]*(?:$|[;\r\n|)}])/.test(src.slice(i + 1, i + 40))) {
      // PowerShell call operator at the start of a statement: & git ..., & $g ..., & (Get-Command git) ...
      // Mid-statement, a single & is a background job and ends the statement, as below.
      seg.push({ text: "&", dyn: false, call: true });
      i++;
      continue;
    }
    if (c === "&" && src[i + 1] !== ">") {
      endSeg();
      i += src[i + 1] === "&" ? 2 : 1;
      continue;
    }
    if (c === "|") {
      const pipe = src[i + 1] !== "|";
      endSeg();
      seg.piped = pipe;
      i += src[i + 1] === "|" || src[i + 1] === "&" ? 2 : 1;
      continue;
    }
    if (c === "(") {
      if (skipNext && !word) skipNext = false; // <(cmd) and >(cmd) are process substitution, not a file
      endSeg();
      depth++;
      i++;
      continue;
    }
    if (c === ")") {
      if (inSub && depth === 0) {
        endSeg();
        return { segs, subs, end: i };
      }
      endSeg();
      depth = Math.max(0, depth - 1);
      i++;
      continue;
    }
    if (c === "<" || c === ">" || c === "&") {
      if (!ps && src.startsWith("<<<", i)) {
        endWord();
        skipNext = true;
        i += 3;
        continue;
      }
      if (!ps && src.startsWith("<<", i)) {
        endWord();
        i += 2;
        const dash = src[i] === "-";
        if (dash) i++;
        hereNext = { dash };
        continue;
      }
      if (word && !word.dyn && (/^\d+$/.test(word.text) || (ps && word.text === "*"))) word = null; // fd number
      endWord();
      const re = /(?:&>>?|>>|>\||>&|<&|<>|>|<)(\d+-?|-)?/y;
      re.lastIndex = i;
      const m = re.exec(src);
      i = re.lastIndex;
      if (!m[1]) skipNext = true;
      continue;
    }
    if (ps && c === "{" && !word) {
      // A PowerShell script block. Its statements become segments of their own, so a launcher inside one
      // (% { iex $_ }) is seen, and the span is kept for the rule that git may not appear inside one.
      endSeg();
      meta.open.push({ at: i, split: true });
      i++;
      continue;
    }
    if (ps && c === "}" && meta.open.length && meta.open[meta.open.length - 1].split) {
      endSeg();
      meta.spans.push([meta.open.pop().at, i + 1]);
      i++;
      continue;
    }
    startWord();
    if (!ps && c === "{") word.brace = true; // unquoted: bash may brace-expand this word
    if (!ps && "*?[".includes(c)) word.glob = true; // unquoted: bash may glob-expand this word
    if (ps && c === "{") meta.open.push({ at: i, split: false });
    if (ps && c === "}" && meta.open.length) meta.spans.push([meta.open.pop().at, i + 1]);
    word.text += c;
    i++;
  }
  if (inSub) throw new LexError("an open $(");
  endSeg();
  if (!inSub) for (const a of meta.open.splice(0)) meta.spans.push([a.at, n]);
  return { segs, subs, end: n, meta };
}

// ansiEscape(src, p) -> [decoded text, characters used] for the escape whose letter is at src[p], inside a
// bash $'...' string.
const SIMPLE_ESCAPES = { a: "\x07", b: "\b", e: "\x1b", E: "\x1b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v", "\\": "\\", "'": "'", '"': '"', "?": "?" };
function ansiEscape(src, p) {
  const e = src[p];
  if (e === undefined) return ["\\", 0];
  if (e in SIMPLE_ESCAPES) return [SIMPLE_ESCAPES[e], 1];
  const digits = (re, max) => {
    let k = 0;
    while (k < max && re.test(src[p + 1 + k] ?? "")) k++;
    return src.slice(p + 1, p + 1 + k);
  };
  if (e === "x" || e === "u" || e === "U") {
    const h = digits(/[0-9A-Fa-f]/, e === "x" ? 2 : e === "u" ? 4 : 8);
    if (!h) return ["\\" + e, 1];
    const cp = parseInt(h, 16);
    return [cp <= 0x10ffff ? String.fromCodePoint(cp) : "", 1 + h.length];
  }
  if (/[0-7]/.test(e)) {
    let k = 1;
    while (k < 3 && /[0-7]/.test(src[p + k] ?? "")) k++;
    return [String.fromCharCode(parseInt(src.slice(p, p + k), 8) & 0xff), k];
  }
  if (e === "c" && src[p + 1] !== undefined) return [String.fromCharCode(src.charCodeAt(p + 1) & 0x1f), 2];
  return ["\\" + e, 1];
}

// ---------- lookups ----------
// Read-only git queries against the repo the command would run in. Only -C, --git-dir and --work-tree are
// forwarded; -c is dropped so the hook never runs config the command supplied.
function gitq(g, args) {
  if (g.dir == null) return { unknown: true };
  const r = spawnSync("git", [...g.forward, ...args], {
    cwd: g.dir,
    encoding: "utf8",
    timeout: 5000,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
  });
  if (r.error || r.status === null) return { unknown: true };
  return { ok: r.status === 0, status: r.status, out: (r.stdout || "").trim() };
}

function currentBranch(g) {
  const r = gitq(g, ["symbolic-ref", "--short", "-q", "HEAD"]);
  if (r.unknown || (!r.ok && r.status !== 1)) return { error: true };
  return { name: r.ok ? r.out : null }; // null: detached HEAD
}

const upstreamOf = (g, b) => {
  const r = gitq(g, ["config", "--get", `branch.${b}.merge`]);
  return r.ok ? r.out.replace(/^refs\/heads\//, "") : null;
};

function isMerged(g, ref) {
  const have = (r) => gitq(g, ["rev-parse", "--verify", "-q", `${r}^{commit}`]).ok;
  if (!have(ref)) return { error: `can't find ${ref}` };
  const up = gitq(g, ["for-each-ref", "--format=%(upstream)", ref]);
  const targets = ["HEAD", up.ok ? up.out : "", "refs/heads/main", "refs/heads/master", "refs/remotes/origin/main", "refs/remotes/origin/master"];
  for (const t of targets) {
    if (!t || t === ref || !have(t)) continue;
    if (gitq(g, ["merge-base", "--is-ancestor", ref, t]).ok) return { merged: true };
  }
  return { merged: false };
}

// ---------- git rules ----------
const FORCE = "a force push (--force, -f, --force-with-lease or a +refspec) rewrites remote history. Push a new branch and open a PR instead";
const GLOBAL_WITH_VALUE = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--super-prefix", "--config-env", "--attr-source"]);
const GLOBAL_FLAGS = new Set([
  "-p", "--paginate", "-P", "--no-pager", "--bare", "--no-replace-objects", "--literal-pathspecs", "--glob-pathspecs",
  "--noglob-pathspecs", "--icase-pathspecs", "--no-optional-locks", "--no-advice", "--exec-path", "--html-path",
  "--man-path", "--info-path", "--version", "-v", "--help", "-h",
]);

// git takes any unique prefix of a subcommand's long option: --har is --hard, --mirr is --mirror. The guard
// doesn't work out which prefixes are unique. Any cut of three or more characters counts as the option, so
// an ambiguous cut, which git refuses to run, is blocked too. (git's own global options take no prefixes.)
const isLong = (t, full) => t.length >= 3 && full.startsWith(t.split("=")[0]);

// Subcommands git ships. git never lets an alias shadow one of these, so only other names are looked up.
const BUILTINS = new Set(
  ("add am annotate apply archive backfill bisect blame branch bugreport bundle cat-file check-attr check-ignore " +
    "check-mailmap check-ref-format checkout checkout-index cherry cherry-pick citool clean clone column commit " +
    "commit-graph commit-tree config count-objects credential daemon describe diagnose diff diff-files diff-index " +
    "diff-tree difftool fast-export fast-import fetch fetch-pack filter-branch fmt-merge-msg for-each-ref " +
    "for-each-repo format-patch fsck gc get-tar-commit-id grep gui hash-object help hook index-pack init instaweb " +
    "interpret-trailers log ls-files ls-remote ls-tree mailinfo mailsplit maintenance merge merge-base merge-file " +
    "merge-index merge-tree mergetool mktag mktree multi-pack-index mv name-rev notes pack-objects pack-refs patch-id " +
    "prune prune-packed pull push range-diff read-tree rebase receive-pack reflog refs remote repack replace replay " +
    "request-pull rerere reset restore rev-list rev-parse revert rm send-email send-pack shortlog show show-branch " +
    "show-index show-ref sparse-checkout stage stash status stripspace submodule switch symbolic-ref tag " +
    "unpack-file unpack-objects update-index update-ref update-server-info upload-archive upload-pack var " +
    "verify-commit verify-pack verify-tag version whatchanged worktree write-tree").split(" "),
);
const GUARDED = new Set(["push", "reset", "clean", "branch", "stash"]);
// Config a push reads to pick where it goes, and environment that swaps in other config or another repo.
const PUSH_CONFIG = /^(?:push|remote|branch|include|includeif)\./i;
const CONFIG_ENV = /^GIT_CONFIG/;
// Subcommands that run a command given on their command line: rebase -x, bisect run, submodule foreach ...
const EXEC_SUBS = new Set(["rebase", "bisect", "submodule", "filter-branch", "filter-repo", "difftool", "mergetool", "for-each-repo"]);
// Environment that holds a path, not a command, so git in its value is a directory name.
const PATH_ENV = new Set(["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_COMMON_DIR", "HOME", "PWD", "OLDPWD", "PATH", "TMPDIR"]);

// checkGit(args after "git", ctx, env set for this command) -> a reason string to block, or null.
function checkGit(args, ctx, env = {}, depth = 0) {
  if (depth > MAX_DEPTH) return "git aliases nest too deeply for the guard to check";
  const br = args.find((a) => a.brace && /\{[^{}]*(?:,|\.\.)[^{}]*\}/.test(a.text));
  if (br) return `bash brace expansion (${br.text}) in a git command: the guard doesn't expand braces, so it can't tell what git gets. Spell the words out`;
  const g = { dir: ctx.cwd, forward: [] };
  const allEnv = { ...ctx.env, ...env };
  for (const [k, v] of Object.entries(allEnv))
    if (!PATH_ENV.has(k) && tokenIn(v.text)) return `${k} holds a command with git in it, and git can run it (an editor, pager or ssh command). The guard doesn't follow that`;
  for (const [k, flag] of [["GIT_DIR", "--git-dir"], ["GIT_WORK_TREE", "--work-tree"]]) {
    const v = allEnv[k];
    if (v) v.dyn ? (g.dir = null) : g.forward.push(flag, v.text);
  }
  const configEnv = Object.keys(allEnv).filter((k) => CONFIG_ENV.test(k) || k === "GIT_COMMON_DIR");
  const cfg = []; // {key, value} from -c and --config-env; key null when it comes from a variable
  let i = 0;
  while (i < args.length && args[i].text.startsWith("-")) {
    const a = args[i];
    const t = a.text;
    if (a.dyn) return `git option ${t} comes from a variable, so the guard can't tell what runs`;
    const name = t.split("=")[0];
    if (GLOBAL_WITH_VALUE.has(t)) {
      const v = args[i + 1];
      if (!v) return `git ${t} has no value`;
      if (t === "-C") g.dir = v.dyn ? null : resolveDir(g.dir, v.text);
      else if (t === "--git-dir" || t === "--work-tree") v.dyn ? (g.dir = null) : g.forward.push(t, v.text);
      else if (t === "-c" || t === "--config-env") cfg.push(configPair(v, t === "--config-env"));
      i += 2;
    } else if (t.includes("=") && (GLOBAL_WITH_VALUE.has(name) || name === "--exec-path" || name === "--list-cmds")) {
      if (name === "--git-dir" || name === "--work-tree") g.forward.push(t);
      if (name === "--config-env") cfg.push(configPair({ text: t.slice(t.indexOf("=") + 1), dyn: false }, true));
      i++;
    } else if (GLOBAL_FLAGS.has(t)) i++;
    else return `git ${t} before the subcommand isn't an option this guard knows`;
  }
  const runs = cfg.find((p) => p.value && !p.key?.startsWith("alias.") && tokenIn(p.value));
  if (runs) return `git -c ${runs.key} holds a command with git in it, and git can run it. The guard doesn't follow that`;
  const sub = args[i];
  const globbed = args.slice(0, i + 1).find((a) => a.glob);
  if (globbed) return `an unquoted glob (${globbed.text}) before or in the git subcommand: bash may expand it to another word. Spell it out`;
  if (!sub) return null;
  if (sub.dyn) return "the git subcommand comes from a variable, so the guard can't tell what runs";
  const rest = args.slice(i + 1);
  if (GUARDED.has(sub.text)) {
    const gl = rest.find((a) => a.glob);
    if (gl) return `an unquoted glob in git ${sub.text} (${gl.text}) can expand to a branch or option the guard didn't see. Quote it or spell it out`;
  }
  if (sub.text === "config" && rest.some((a) => tokenIn(a.text)))
    return "git config storing a value with git in it (an alias, editor or ssh command) sets up a git command the guard can't check when it later runs. Set it by hand if it's meant";
  if (EXEC_SUBS.has(sub.text) && rest.some((a) => tokenIn(a.text)))
    return `git ${sub.text} runs a command it is given, and that command has git in it. The guard doesn't follow it. Run that git command on its own`;
  if (GUARDED.has(sub.text) && configEnv.length && (sub.text === "push" || allEnv.GIT_COMMON_DIR))
    return `git ${sub.text} with ${configEnv[0]} set: that swaps in config or refs the guard can't read`;
  switch (sub.text) {
    case "push": {
      const c = cfg.find((p) => p.key === null || PUSH_CONFIG.test(p.key));
      if (c) return `git -c ${c.key ?? "(from a variable)"} on a push can change where it goes, and the guard won't run config the command brings. Drop the -c`;
      return checkPush(rest, g);
    }
    case "reset":
      return checkReset(rest, g);
    case "clean":
      return checkClean(rest);
    case "branch":
      return checkBranch(rest, g);
    case "stash":
      return checkStash(rest, g);
  }
  if (BUILTINS.has(sub.text)) return null;
  return checkAlias(sub.text, args.slice(0, i), rest, g, cfg, configEnv, ctx, env, depth);
}

// configPair(word after -c or --config-env) -> {key, value}. git lowercases the section and the variable name.
function configPair(v, fromEnv) {
  if (v.dyn) return { key: null, value: null };
  const eq = v.text.indexOf("=");
  const key = (eq < 0 ? v.text : v.text.slice(0, eq)).toLowerCase();
  return { key, value: fromEnv ? null : eq < 0 ? "true" : v.text.slice(eq + 1) };
}

// A subcommand git doesn't ship may be an alias. Read it (from the command's own -c first, then the repo's
// config, without running anything) and check what it expands to.
function checkAlias(name, globals, rest, g, cfg, configEnv, ctx, env, depth) {
  const want = `alias.${name.toLowerCase()}`;
  if (cfg.some((p) => p.key === null)) return `git ${name} may be an alias set by a -c from a variable, so the guard can't tell what runs`;
  const own = cfg.filter((p) => p.key === want).pop();
  let value;
  if (own) {
    if (own.value === null) return `git ${name} is an alias the command reads from the environment, so the guard can't tell what runs`;
    value = own.value;
  } else {
    if (configEnv.length) return `git ${name} may be an alias set through ${configEnv[0]}, so the guard can't tell what runs`;
    const r = gitq(g, ["config", "--get", want]);
    if (r.unknown || (!r.ok && r.status !== 1)) return `git ${name} may be an alias, and the guard can't read the repo's config to check`;
    if (!r.ok) return null; // not an alias: git runs git-<name> from PATH or fails
    value = r.out;
  }
  if (value.startsWith("!")) {
    const tail = rest.map((a) => (a.dyn ? a.text : `'${a.text.replace(/'/g, `'\\''`)}'`)).join(" ");
    const r = scanText(`${value.slice(1)} ${tail}`, false, { ...ctx, cwd: g.dir }, depth + 1);
    return r ? `alias git ${name}: ${r}` : null;
  }
  let words;
  try {
    words = lex(value, false).segs.flat();
  } catch (e) {
    if (e instanceof LexError) return `git ${name} is an alias the guard can't parse (${e.message})`;
    throw e;
  }
  const r = checkGit([...globals, ...words, ...rest], ctx, env, depth + 1);
  return r ? `alias git ${name} (${value}): ${r}` : null;
}

function checkPush(rest, g) {
  const pos = [];
  let tags = false;
  let ended = false;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    const t = a.text;
    if (!ended && t === "--") {
      ended = true;
      continue;
    }
    // A variable can hold a flag, a remote or a refspec, so it is never treated as the harmless one.
    if (a.dyn) return "a push argument comes from a variable, so the guard can't tell whether it forces or where it goes";
    if (a.glob) return `an unquoted glob in a push argument (${a.text}) can expand to master or main. Quote it or spell it out`;
    if (!ended && t.startsWith("-") && t.length > 1) {
      const name = t.split("=")[0];
      if (name.startsWith("--")) {
        if (name.startsWith("--force") || isLong(name, "--force")) return FORCE;
        if (isLong(name, "--mirror")) return "push --mirror overwrites every ref on the remote, master/main included";
        if (isLong(name, "--all") || isLong(name, "--branches")) return "push --all pushes every branch, master/main included";
        if (isLong(name, "--tags")) tags = true;
        if (!t.includes("=") && ["--repo", "--receive-pack", "--exec", "--push-option"].some((o) => isLong(name, o))) i++;
        continue;
      }
      for (let k = 1; k < t.length; k++) {
        if (t[k] === "f") return FORCE;
        if (t[k] === "o") {
          if (k === t.length - 1) i++;
          break;
        }
      }
      continue;
    }
    pos.push(a);
  }
  // git expands * in a refspec itself (refs/heads/*:refs/heads/*), so quoting it doesn't make it literal.
  const star = pos.find((a) => a.text.includes("*"));
  if (star) return `a wildcard refspec (${star.text}) pushes every matching branch, master/main included. Name the branch`;
  const refspecs = pos.slice(1); // the first is the remote
  if (refspecs.length === 0) {
    if (tags) return null; // push --tags with no refspec pushes tags only
    return checkCurrentPush(g, "with no refspec");
  }
  for (let i = 0; i < refspecs.length; i++) {
    const s = refspecs[i].text;
    if (s === "tag") {
      i++;
      continue;
    }
    if (s.startsWith("+")) return FORCE;
    const colon = s.indexOf(":");
    let dst = colon >= 0 ? s.slice(colon + 1) || s.slice(0, colon) : s;
    if (colon < 0 && (dst === "HEAD" || dst === "@")) {
      const hit = checkCurrentPush(g, `with ${dst}`);
      if (hit) return hit;
      continue;
    }
    dst = dst.replace(/^(?:refs\/)?heads\//, "");
    if (PROTECTED.test(dst)) return `a push to ${dst} goes straight to the default branch. Push a feature branch and open a PR`;
  }
  return null;
}

function checkCurrentPush(g, how) {
  const b = currentBranch(g);
  if (b.error) return `a push ${how} goes to the current branch, and the guard can't tell what that is`;
  if (b.name && PROTECTED.test(b.name)) return `a push ${how} from ${b.name} goes straight to the default branch. Push a feature branch and open a PR`;
  if (b.name) {
    const up = upstreamOf(g, b.name);
    const mode = gitq(g, ["config", "--get", "push.default"]);
    if (up && PROTECTED.test(up) && mode.ok && /^(?:upstream|tracking)$/.test(mode.out))
      return `a push ${how} from ${b.name} goes to its upstream ${up} (push.default=${mode.out}). Name the destination branch`;
  }
  return null;
}

function checkReset(rest, g) {
  const end = rest.findIndex((a) => a.text === "--" && !a.dyn);
  const opts = end < 0 ? rest : rest.slice(0, end); // after --, every word is a path
  if (!opts.some((a) => a.dyn || (a.text.startsWith("--") && isLong(a.text, "--hard")))) return null;
  const b = currentBranch(g);
  if (b.error) return "reset --hard: the guard can't tell which branch this is, so it can't rule out a shared one";
  if (b.name === null) return null; // detached HEAD
  if (PROTECTED.test(b.name)) return `reset --hard on ${b.name} throws away work on a shared branch`;
  const up = upstreamOf(g, b.name);
  if (up) return `reset --hard on ${b.name}, which tracks ${up}, throws away work on a shared branch. Commit or stash with -m first, or reset a local branch`;
  return null;
}

function checkClean(rest) {
  // A dry run is the only clean allowed. The last -n/--no-dry-run wins, the way git reads them, and the
  // word after -e/--exclude is a pattern, not an option.
  let dry = false;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    const t = a.text;
    if (t === "--") break;
    if (a.dyn) return "a clean option comes from a variable, so the guard can't tell whether it deletes";
    if (t.startsWith("--")) {
      if (isLong(t, "--dry-run")) dry = true;
      else if (isLong(t, "--no-dry-run")) dry = false;
      else if (!t.includes("=") && isLong(t, "--exclude")) i++;
    } else if (/^-[a-zA-Z]+$/.test(t)) {
      for (let k = 1; k < t.length; k++) {
        if (t[k] === "n") dry = true;
        if (t[k] === "e") {
          if (k === t.length - 1) i++;
          break;
        }
      }
    }
  }
  if (dry) return null;
  return "git clean deletes untracked files for good, and other agents' work may be among them. Run git clean -n to see what it would remove";
}

function checkBranch(rest, g) {
  let D = false, d = false, f = false, remote = false;
  let ended = false;
  const names = [];
  for (const a of rest) {
    const t = a.text;
    if (!ended && t === "--") {
      ended = true;
      continue;
    }
    if (ended) names.push(a);
    else if (a.dyn) return "a branch argument comes from a variable and could be -D, so the guard can't tell whether it force-deletes. Put a name from a variable after --";
    else if (t.startsWith("--")) {
      if (isLong(t, "--delete")) d = true;
      else if (isLong(t, "--force")) f = true;
      else if (isLong(t, "--remotes")) remote = true;
    } else if (t.startsWith("-") && t.length > 1) {
      for (const ch of t.slice(1)) {
        if (ch === "D") D = true;
        else if (ch === "d") d = true;
        else if (ch === "f") f = true;
        else if (ch === "r") remote = true;
      }
    } else names.push(a);
  }
  if (!(D || (d && f))) return null;
  if (!names.length) return "branch -D with no branch name the guard can check";
  for (const nm of names) {
    if (nm.dyn) return "branch -D of a branch named by a variable, so the guard can't check it is merged";
    const ref = (remote ? "refs/remotes/" : "refs/heads/") + nm.text;
    const m = isMerged(g, ref);
    if (m.error) return `branch -D ${nm.text}: ${m.error}, so the guard can't check it is merged`;
    if (!m.merged) return `branch -D ${nm.text} deletes commits that aren't merged anywhere. Merge it, or use git branch -d`;
  }
  return null;
}

function checkStash(rest, g) {
  const first = rest[0];
  const sub = first && !first.text.startsWith("-") ? first.text : null;
  if (sub && sub !== "push" && sub !== "save") return null; // list, show, pop, apply, drop, branch ...
  const args = sub ? rest.slice(1) : rest;
  let msg = null;
  const save = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const t = a.text;
    if (t === "--") break;
    if (t.startsWith("--") && isLong(t, "--message")) {
      msg = t.includes("=") ? { text: t.slice(t.indexOf("=") + 1), dyn: a.dyn } : args[++i] ?? null;
      continue;
    }
    if (/^-[a-zA-Z]+$/.test(t) && t.includes("m")) {
      const after = t.slice(t.indexOf("m") + 1);
      msg = after ? { text: after, dyn: a.dyn } : args[++i] ?? null;
      continue;
    }
    if (t.startsWith("-")) continue;
    save.push(a);
  }
  if (!msg && sub === "save" && save.length) msg = { text: save.map((w) => w.text).join(" "), dyn: save.some((w) => w.dyn) };
  if (!msg || !msg.text.trim()) return "git stash needs a unique message: git stash push -m <task-tag>. Other agents share this stash list, and an untagged stash gets popped by the wrong one";
  if (msg.dyn) return "the stash message comes from a variable, so the guard can't check it is unique. Use a literal tag";
  const list = gitq(g, ["stash", "list", "--format=%gs"]);
  if (list.unknown || !list.ok) return "git stash: the guard can't read the stash list to check the message is unique";
  const tag = msg.text.trim();
  if (list.out.split("\n").some((l) => l === tag || l.endsWith(": " + tag)))
    return `a stash with the message "${tag}" already exists. Pick a unique tag`;
  return null;
}

// ---------- commands ----------
// The structural rule. When a command has the git token anywhere in it, it is allowed only if every place
// the token appears is one of these:
//   (a) the command of a simple segment: [NAME=value ...] [keyword ...] [timeout|nice|time|nohup ...] git ...
//       (or a PowerShell "$x = git ..."), and the precise checker resolves that git as safe;
//   (b) data given to a text tool that can't run anything (INERT: echo, cat, grep, gh ...), including inside
//       a $( ) whose segments are all such tools (the git commit -m "$(cat <<'EOF' ...)" idiom);
//   (c) git run by xargs with known xargs options: xargs [opts] git ..., checked with its input as unknown.
// Anywhere else, the command is denied and the reason names the construct: ( ), $( ), backticks, a bash
// { } group, a PowerShell { } block, brace expansion, a heredoc that expands $( ), an alias, a function,
// eval/source/./iex/start/Start-Process/cmd/wsl/a shell, env or sudo in front of a command, find -exec,
// a command name from a variable or an expression (& $g, & (Get-Command git)), a pipe into anything but a
// text tool, or a command the guard doesn't model with git in its words. Constructs in a command with no
// git token in it are left alone, and so are constructs elsewhere in the command that hold no git (so
// Get-ChildItem | ForEach-Object { $_.Name }; git status passes).

// Shell words that come before a command and take no arguments of their own.
const KEYWORDS = new Set(["!", "if", "then", "else", "elif", "do", "while", "until"]);
// Wrappers the guard reads exactly: every option is parsed, and the word after them is the command.
const TRANSPARENT = new Set(["timeout", "nice", "time", "nohup"]);
// Commands that run text or another command. In a command that has git anywhere, any of these is denied,
// whatever its own words are: it may be reading the git from a pipe, a here-string, a variable or a file.
const LAUNCHERS = new Set([
  "eval", "source", ".", "exec", "command", "builtin", "coproc", "alias", "function", "trap",
  "bash", "sh", "zsh", "dash", "ksh", "mksh", "fish", "csh", "tcsh", "busybox", "cmd", "wsl", "pwsh", "powershell",
  "iex", "invoke-expression", "invoke-command", "icm", "start-job", "sajb", "start-threadjob", "start", "start-process",
  "saps", "invoke-item", "ii", "sudo", "doas", "su", "runuser", "env", "parallel", "watch", "flock", "script", "strace",
  "ltrace", "stdbuf", "unbuffer", "setsid", "ionice", "chrt", "taskset", "chronic", "caffeinate", "open", "explorer",
]);
// Text tools with no way to run a command. Git in their words is data, and they may read a pipe from git.
const INERT = new Set([
  "echo", "printf", "cat", "grep", "egrep", "fgrep", "rg", "ls", "head", "tail", "wc", "sort", "uniq", "cut", "tr",
  "tee", "nl", "diff", "cmp", "comm", "which", "type", "pwd", "basename", "dirname", "realpath", "readlink", "stat",
  "test", "[", "[[", "true", "false", ":", "gh", "mkdir", "touch", "cp", "mv", "rm",
  // PowerShell
  "write-output", "write-host", "get-content", "gc", "get-childitem", "gci", "dir", "select-string", "sls",
  "select-object", "select", "test-path", "join-path", "split-path", "resolve-path", "get-item", "gi",
  "get-location", "measure-object", "measure", "out-null", "out-string", "out-file", "format-table", "ft",
  "format-list", "fl", "sort-object", "out-host", "convertto-json", "compare-object", "get-unique", "tee-object",
]);
// Options that make an INERT tool run a program: sort --compress-program, rg --pre.
const RUNS_PROGRAM = /^--(?:pre(?:-glob)?(?:=|$)|compress)/;
// PowerShell cmdlets that take a pipe and run only their own { } block, whose statements are checked as
// segments of their own.
const PS_PIPE_BLOCKS = new Set(["foreach-object", "%", "foreach", "where-object", "where", "?"]);
const ASSIGN = /^([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*)$/;
// PowerShell assignment: $x = git ..., $x += ..., [string]$x = ..., $x=git ...
const PS_VAR = /^(?:\[[^\]]*\])*\$(?:\{[^}]*\}|[A-Za-z_][\w:]*)/;
const PS_OP = /^(?:[+\-*/%]|\?\?)?=(?!=)/;
const CDS = new Set(["cd", "pushd", "chdir", "set-location", "sl", "push-location"]);

const cmdName = (t) => t.split(/[\\/]/).pop().toLowerCase().replace(/\.exe$/, "");

function resolveDir(base, p) {
  if (process.platform === "win32" && /^\/[a-zA-Z](?:\/|$)/.test(p)) p = `${p[1]}:/${p.slice(3)}`; // Git Bash /c/x
  if (p === "~" || p.startsWith("~/")) p = path.join(os.homedir(), p.slice(1));
  if (path.isAbsolute(p)) return path.resolve(p);
  return base == null ? null : path.resolve(base, p);
}

function changeDir(args, ctx) {
  const target = args.filter((a) => !/^-/.test(a.text))[0];
  if (!target) ctx.cwd = os.homedir();
  else if (target.dyn || target.text === "-") ctx.cwd = null;
  else ctx.cwd = resolveDir(ctx.cwd, target.text);
}

// env records an assignment word (FOO=1) into a {name: {text, dyn}} map.
const assign = (env, w) => {
  const m = ASSIGN.exec(w.text);
  if (m) env[m[1]] = { text: m[2], dyn: w.dyn };
  return !!m;
};

// stripPsAssign(words) -> the words after any PowerShell "$x =" in front, so $r = git push ... is checked as
// git push .... $env:X = ... is left alone: checkSegment records it.
function stripPsAssign(words) {
  let w = words;
  for (;;) {
    const h = w[0];
    if (!h || /^\$env:/i.test(h.text)) return w;
    const v = PS_VAR.exec(h.text);
    if (!v) return w;
    let after = h.text.slice(v[0].length);
    let next = w.slice(1);
    if (!after && next[0] && PS_OP.test(next[0].text)) {
      after = next[0].text;
      next = next.slice(1);
    }
    const op = PS_OP.exec(after);
    if (!op) return w;
    const tail = after.slice(op[0].length);
    const { bodies, expand, ps, piped, group } = words;
    w = Object.assign(tail ? [{ ...h, text: tail }, ...next] : next, { bodies, expand, ps, piped, group, assigned: true });
  }
}

// unwrap(name, args) -> {cmd, args} for timeout/nice/time/nohup, read option by option, or {error}.
function unwrap(name, args) {
  let i = 0;
  const lit = (a) => a && !a.dyn;
  const bad = (why) => ({ error: `${name} ${why}, so the guard can't tell where the command starts. Run git without it` });
  if (name === "time") while (args[i]?.text === "-p") i++;
  else if (name === "nice") {
    for (;;) {
      const a = args[i];
      if (!a || a.dyn) break;
      if (a.text === "-n" || a.text === "--adjustment") {
        if (!lit(args[i + 1])) return bad("has an option value from a variable");
        i += 2;
      } else if (/^(?:-n|--adjustment=)?-?\d+$/.test(a.text) && a.text.startsWith("-")) i++;
      else break;
    }
  } else if (name === "timeout") {
    for (;;) {
      const a = args[i];
      if (!a || a.dyn || !a.text.startsWith("-")) break;
      const t = a.text;
      if (["--foreground", "--preserve-status", "-v", "--verbose"].includes(t)) i++;
      else if (t === "-s" || t === "-k" || t === "--signal" || t === "--kill-after") {
        if (!lit(args[i + 1])) return bad("has an option value from a variable");
        i += 2;
      } else if (/^(?:-[sk].+|--signal=.+|--kill-after=.+)$/.test(t)) i++;
      else return bad(`has an option (${t}) the guard doesn't know`);
    }
    if (!lit(args[i]) || !/^\d+(?:\.\d+)?[smhd]?$/.test(args[i].text)) return bad("has a duration the guard can't read");
    i++;
  }
  const a = args[i];
  if (a && a.dyn) return bad("runs a command named by a variable");
  if (a && a.text.startsWith("-")) return bad(`has an option (${a.text}) the guard doesn't know`);
  return { cmd: a ?? null, args: args.slice(i + 1) };
}

// xargsCommand(args) -> {head, args} for the command xargs runs (echo when it names none), or null when an
// xargs option isn't one the guard knows.
const XARGS_FLAGS = new Set(["-0", "--null", "-r", "--no-run-if-empty", "-t", "--verbose", "-p", "--interactive", "-x", "--exit", "-o", "--open-tty"]);
const XARGS_VALUED = new Set(["-I", "-n", "-L", "-P", "-s", "-d", "-E", "-a", "--max-args", "--max-lines", "--max-procs", "--max-chars", "--delimiter", "--eof", "--arg-file", "--replace", "--process-slot-var"]);
function xargsCommand(args) {
  let i = 0;
  for (; i < args.length; i++) {
    const a = args[i];
    const t = a.text;
    if (a.dyn) return null;
    if (!t.startsWith("-")) break;
    if (t === "--") {
      i++;
      break;
    }
    if (XARGS_FLAGS.has(t)) continue;
    if (XARGS_VALUED.has(t)) {
      i++;
      continue;
    }
    if (/^-[InLPsdEa]./.test(t) || /^-[iel]/.test(t)) continue; // -I{} -n1 -d'\n', and -i/-e/-l with an attached value
    if (t.startsWith("--") && t.includes("=") && XARGS_VALUED.has(t.split("=")[0])) continue;
    return null;
  }
  if (i >= args.length) return { head: { text: "echo", dyn: false }, args: [] };
  return { head: args[i], args: args.slice(i + 1) };
}

const wordsText = (ws) => ws.map((w) => w.text).join(" ");
const NOT_SIMPLE = "Run git as its own command";

// checkSegment(words, ctx, depth, where) -> a reason to block, or null. where names the construct the
// segment sits in ("$( )"), if any. Only called when the whole command has the git token in it.
function checkSegment(words, ctx, depth, where = null) {
  const bodies = words.bodies ?? [];
  const segText = `${wordsText(words)}\n${bodies.join("\n")}`;
  const carries = tokenIn(segText);
  for (let b = 0; b < bodies.length; b++)
    if (words.expand?.[b] && /\$\(|`|\$\{/.test(bodies[b]) && tokenIn(bodies[b]))
      return `a heredoc with an unquoted delimiter (<<EOF) runs the $( ) or backticks in its body, and the body has git in it. Quote the delimiter (<<'EOF') or ${NOT_SIMPLE.toLowerCase()}`;
  let w = words.ps ? stripPsAssign(words) : words;
  if (w.assigned && w[0]?.quoted)
    // $g = 'git': a PowerShell string, not a command. Git in a variable can be run later as & $g.
    return tokenIn(wordsText(w)) ? `a PowerShell variable assigned text with git in it can be run later (& $g), and the guard doesn't follow variables. ${NOT_SIMPLE}` : null;
  let group = where ?? (words.group ? "( )" : null);
  const env = {};
  let k = 0;
  while (k < w.length) {
    const a = w[k];
    if (!words.ps && a.brace && a.text === "{") group ??= "a { } group";
    else if (!a.quoted && a.text === "}") {
      /* the end of a group */
    } else if (assign(env, a)) {
      /* FOO=1 git ... */
    } else if (!a.quoted && !a.dyn && KEYWORDS.has(a.text)) {
      /* if git ...; then ... */
    } else break;
    k++;
  }
  for (const [name, v] of Object.entries(env))
    if (!PATH_ENV.has(name) && tokenIn(v.text))
      return `the variable ${name} is set to text with git in it, and a command can run it later ($${name}) or git can run it (an editor, pager or ssh command). ${NOT_SIMPLE}`;
  if (k >= w.length) {
    Object.assign(ctx.env, env); // FOO=1 on its own: a later git in this command may see it
    return null;
  }
  let head = w[k];
  let args = w.slice(k + 1).filter((a) => a.quoted || a.text !== "}");
  if (head.call) {
    // PowerShell & name ...: the operand is the command. & $g, & (expr) and & { } can't be read.
    if (!args.length || args[0].dyn) return `the PowerShell call operator & runs a command named by a variable or an expression, and this command has git in it. ${NOT_SIMPLE}`;
    head = args[0];
    args = args.slice(1);
  }
  let name = cmdName(head.text);
  while (TRANSPARENT.has(name) && !head.dyn) {
    const u = unwrap(name, args);
    if (u.error) return u.error;
    if (!u.cmd) return null; // timeout 5 on its own
    head = u.cmd;
    args = u.args;
    name = cmdName(head.text);
  }
  if (CDS.has(name)) return changeDir(args, ctx), null;
  if (name === "export" || name === "declare" || name === "typeset" || name === "readonly" || name === "local") {
    for (const a of args) {
      const m = ASSIGN.exec(a.text);
      if (m && !PATH_ENV.has(m[1]) && tokenIn(m[2]))
        return `${name} ${m[1]} sets a variable to text with git in it, and a command can run it later or git can run it (an editor, pager or ssh command). ${NOT_SIMPLE}`;
      assign(ctx.env, a);
    }
    return null;
  }
  const psEnv = /^\$env:([A-Za-z_][A-Za-z0-9_]*)(?:=([\s\S]*))?$/i.exec(head.text);
  if (words.ps && psEnv) {
    // PowerShell $env:GIT_DIR = 'x' sets it for every later command.
    const value = psEnv[2] !== undefined ? psEnv[2] : args.filter((a) => a.text !== "=").map((a) => a.text).join(" ");
    ctx.env[psEnv[1].toUpperCase()] = { text: value, dyn: true };
    return null;
  }
  if (head.dyn) {
    // PowerShell runs a command named by a variable only through & (handled above), so a statement that
    // starts with $x is an expression. In bash, $X git ... runs whatever $X holds.
    if (words.ps) return carries ? `a PowerShell expression with git in it (${head.text} ...): the guard doesn't evaluate expressions. ${NOT_SIMPLE}` : null;
    return `the command name ${head.text} comes from a variable, and this command has git in it, so the guard can't tell what runs. ${NOT_SIMPLE}`;
  }
  if (name === "git") {
    if (group) return `git inside ${group}: the guard checks git only as a simple command. ${NOT_SIMPLE}`;
    return checkGit(args, ctx, env, depth);
  }
  if (name === "xargs") {
    const x = xargsCommand(args);
    if (x && !x.head.dyn && cmdName(x.head.text) === "git" && !group)
      return checkGit([...x.args, { text: "<xargs input>", dyn: true }], ctx, env, depth);
    if (x && INERT.has(cmdName(x.head.text)) && !x.args.some((a) => RUNS_PROGRAM.test(a.text)) && !tokenIn(wordsText(args))) return null;
    return `xargs runs a command with its input, and this command has git in it. The guard follows only xargs [options] git .... ${NOT_SIMPLE}`;
  }
  if (name === "find" && args.some((a) => /^-(?:exec|execdir|ok|okdir)$/.test(a.text)))
    return `find -exec runs a command, and this command has git in it. ${NOT_SIMPLE}`;
  if (name === "command" && /^-[vV]$/.test(args[0]?.text ?? "")) return null; // command -v git only looks it up
  if (name === "env" && !args.some((a) => !a.text.startsWith("-") && !ASSIGN.test(a.text)) && !args.some((a) => /^(?:-S|--split-string)/.test(a.text)))
    return null; // env on its own prints the environment
  if (LAUNCHERS.has(name))
    return `${head.text} runs text or another command the guard doesn't follow, and this command has git in it. ${NOT_SIMPLE}`;
  const gh = name === "gh" && /^(?:alias|extension|ext)$/.test(args[0]?.text ?? "");
  if (INERT.has(name) && !gh && !args.some((a) => RUNS_PROGRAM.test(a.text))) return null; // git here is data
  if (words.piped && words.ps && PS_PIPE_BLOCKS.has(name) && !carries) return null; // its { } block is checked on its own
  if (words.piped)
    return `a pipe into ${head.text}: in a command that has git in it, only text tools (cat, grep, head, Select-Object ...) may read a pipe. ${NOT_SIMPLE}`;
  if (carries)
    return `${head.text} isn't a command the guard models, and git appears in it, so the guard can't tell what git runs. ${NOT_SIMPLE}`;
  return null;
}

// scanLexed walks a lexed command: its $( ) bodies first, then each segment.
function scanLexed(lx, ctx, depth, where = null) {
  for (const s of lx.subs) {
    const r = scanLexed(s, ctx, depth + 1, "$( )");
    if (r) return r;
  }
  for (const seg of lx.segs) {
    const r = checkSegment(seg, ctx, depth, where);
    if (r) return r;
  }
  return null;
}

// Loose on purpose: g"i"t and g\it are git once the shell removes the quotes, and a $'...' with an escape
// in it can spell anything ($'\x67it').
const gitShaped = (s) => /g["'`\\^]*i["'`\\^]*t|pwsh|powershell|\$'[^']*\\/i.test(s);
// PowerShell reads curly quotes as plain ones: git push origin x ‘--force’ is a force push.
const psQuotes = (s) => s.replace(/[‘’‚‛]/g, "'").replace(/[“”„]/g, '"');

// The git token: git, git.exe, or a path ending in /git or \git, as its own word. .gitignore, .git/config,
// git-guard, ~/git/repo and git@github.com are not it. Quotes, cmd's ^ escapes and empty $( ) are dropped
// first, since an inner shell would drop them ('g"i"t', g^it, g$()it), and backslashes are read both as
// escapes and as path separators. A $'...' with an escape in it can spell anything, so it counts too.
const GIT_TOKEN = /(?<![\w.\-])git(?:\.exe)?(?![\w.\-/\\@:])/i;
function tokenIn(s) {
  if (!s) return false;
  const t = s.replace(/["'`^]/g, "").replace(/\$\(\s*\)|\$\{\s*\}/g, "");
  return GIT_TOKEN.test(t.replace(/\\/g, "")) || GIT_TOKEN.test(t.replace(/\\/g, "/")) || /\$'[^']*\\/.test(s);
}
// A PowerShell -EncodedCommand is base64 of UTF-16LE text. A word that decodes to text with git in it counts
// as the git token, so pwsh -enc ... is in scope for the structural rule.
function encodedGit(s) {
  for (const m of s.matchAll(/[A-Za-z0-9+/]{12,}={0,2}/g)) {
    const d = Buffer.from(m[0], "base64").toString("utf16le");
    if (tokenIn(d)) return true;
  }
  return false;
}

function scanText(src, ps, ctx, depth) {
  if (ps) src = psQuotes(src);
  if (!tokenIn(src) && !encodedGit(src)) return null; // no git token: not this guard's business
  if (depth > MAX_DEPTH) return "the command nests too deeply for the guard to check";
  let lx;
  try {
    lx = lex(src, ps);
  } catch (e) {
    if (e instanceof LexError) return `the guard can't parse this command (${e.message})`;
    throw e;
  }
  if (lx.meta.hiddenGit) return `${lx.meta.hiddenGit}: the guard checks git only as a simple command. ${NOT_SIMPLE}`;
  for (const [a, b] of lx.meta.spans)
    if (tokenIn(src.slice(a, b)))
      return `git inside a PowerShell script block { } (try, if, foreach, %, Invoke-Command, Start-Job ...): the guard checks git only as a simple command. ${NOT_SIMPLE}`;
  const br = lx.segs.concat(...lx.subs.map((s) => s.segs)).flat().find((a) => a.brace && /\{[^{}]*(?:,|\.\.)[^{}]*\}/.test(a.text) && tokenIn(a.text));
  if (br) return `bash brace expansion (${br.text}) can spell git: the guard doesn't expand braces. Spell the words out`;
  return scanLexed(lx, ctx, depth);
}

// checkCommand(command, ps, cwd) -> a reason string to block, or null to allow.
export function checkCommand(command, ps = false, cwd = null) {
  const ctx = { cwd: typeof cwd === "string" && cwd ? path.resolve(cwd) : null, env: {} };
  return scanText(command, ps, ctx, 0);
}

// evaluate(raw stdin text) -> a reason string to block, or null to allow.
export function evaluate(raw) {
  let p;
  try {
    p = JSON.parse(raw);
  } catch {
    return "the hook input isn't valid JSON, so the guard can't check the command";
  }
  if (!p || typeof p !== "object" || Array.isArray(p)) return "the hook input isn't a JSON object";
  if (typeof p.tool_name !== "string") return gitShaped(raw) ? "the hook input has no tool_name, and it mentions git" : null;
  if (!SHELL_TOOLS.has(p.tool_name)) return null;
  const cmd = p.tool_input?.command;
  if (typeof cmd !== "string") {
    return gitShaped(JSON.stringify(p.tool_input ?? null)) ? `the ${p.tool_name} input has no command string, and it mentions git` : null;
  }
  return checkCommand(cmd, p.tool_name === "PowerShell", p.cwd);
}

function main() {
  const block = (why) => {
    process.stderr.write(`git-guard blocked this command: ${why}.\n`);
    process.exitCode = 2;
  };
  process.on("uncaughtException", (e) => block(`the guard hit an error (${e && e.message})`));
  let raw = "";
  try {
    raw = readFileSync(0, "utf8");
  } catch (e) {
    if (e?.code !== "EOF") return block("the guard couldn't read its input");
  }
  try {
    const why = evaluate(raw);
    if (why) block(why);
  } catch (e) {
    block(`the guard hit an error (${e && e.message})`);
  }
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === self.toLowerCase()) main();
