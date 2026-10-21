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
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), body);
  }
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

// mojibake: UTF-8 read as Windows-1252 and written back (the 2026-08-10 Get-Content/Set-Content round trip).
// Every fixture is written with unicode escapes, never the literal characters, so this file never matches the rule.
const mj = repo({
  "mj-eacute.md": "caf\u00C3\u00A9\n",
  "mj-sao.md": "fine line\nS\u00C3\u00A3o Paulo\n",
  "mj-aacute.md": "p\u00C3\u00A1gina\n",
  "mj-nbsp.md": "voil\u00C3\u00A0\n",
  "mj-upper.md": "PR\u00C3\u2030SENTE\n",
  "mj-quote.md": "it\u00E2\u20AC\u2122s\n",
  "mj-dash.md": "a \u00E2\u20AC\u201D b\n",
  "mj-fffd.md": "caf\uFFFD\n",
  "mj-utf16.txt": Buffer.from("\uFEFFcaf\u00C3\u00A9\n", "utf16le"),
  "mj-many.md": "ok\n" + "caf\u00C3\u00A9\n".repeat(3) + "fine\ncaf\uFFFD\n",
  "src/deep/mj.ts": "const s = 'x';\nconst t = 'don\u00E2\u20AC\u2122t';\n",
});
const rm = run(mj);
check(rm.status === 1, "a repo with mojibake fails");
for (const f of ["mj-eacute.md", "mj-sao.md", "mj-aacute.md", "mj-nbsp.md", "mj-upper.md", "mj-quote.md", "mj-dash.md", "mj-fffd.md", "mj-utf16.txt", "mj-many.md", "src/deep/mj.ts"])
  check(flags(rm.stdout, "mojibake", f), `flags mojibake in ${f}`);
const mjLine = (f) => rm.stdout.split("\n").find((l) => new RegExp(`^mojibake\\s+${esc(f)}(\\s|$)`).test(l)) ?? "";
check(/line 1: U\+00C3 U\+00A9$/.test(mjLine("mj-eacute.md")), "a finding names the line and the code points (U+00C3 U+00A9 on line 1)");
check(/line 2: U\+00C3 U\+00A3$/.test(mjLine("mj-sao.md")), "the misdecoded Sao names line 2 and U+00C3 U+00A3");
check(/line 1: U\+00C3 U\+00A0$/.test(mjLine("mj-nbsp.md")), "a no-break space after U+00C3 is named");
check(/line 1: U\+00C3 U\+2030$/.test(mjLine("mj-upper.md")), "a Windows-1252 image (U+2030) after U+00C3 is named");
check(/line 1: U\+00E2 U\+20AC$/.test(mjLine("mj-quote.md")), "the U+00E2 U+20AC pair is named, not the character after it");
check(/line 2: U\+00E2 U\+20AC$/.test(mjLine("src/deep/mj.ts")), "a finding in a nested file names its line");
check(/line 1: U\+FFFD$/.test(mjLine("mj-fffd.md")), "U+FFFD is named");
check(/line 2: U\+00C3 U\+00A9 \(\+3 more lines\)$/.test(mjLine("mj-many.md")), "a file with many bad lines names the first and counts the rest");
check(/line 1: U\+00C3 U\+00A9$/.test(mjLine("mj-utf16.txt")), "UTF-16 text is decoded first, as the crlf rule does");

// Look-alikes that must pass: text written correctly in UTF-8, a capital A-tilde that is a letter, CJK, emoji.
const mjClean = repo({
  "accents.md": "caf\u00E9 na\u00EFve S\u00E3o Paulo \u00FCber se\u00F1or fa\u00E7ade \u00E2me P\u00E2ques \u00E0 la carte \u00E8 \u00E9\n",
  "capitals.md":
    "S\u00C3O PAULO A\u00C7\u00C3O M\u00C3E P\u00C3O AMANH\u00C3\nUm \u00C3 so, \u00C3. \u00C3, \u00C30 \u00C3-x \u00C3\u00C3 \"\u00C3\" '\u00C3'\n",
  "smart.md": "it\u2019s \u201Cquoted\u201D \u2014 dash \u2026 \u20AC5 \u2122 \u00E2 \u20AC (apart) \u00E2\n",
  "cjk.md": "\u65E5\u672C\u8A9E\u306E\u30C6\u30AD\u30B9\u30C8 \u4E2D\u6587 \uD55C\uAD6D\uC5B4\n",
  "emoji.md": "party \uD83C\uDF89 rocket \uD83D\uDE80 flag \uD83C\uDDFA\uD83C\uDDF8 family \uD83D\uDC68\u200D\uD83D\uDC69\u200D\uD83D\uDC67\n",
  "cyrillic.md": "\u041F\u0440\u0438\u0432\u0435\u0442 \u03B1\u03B2\u03B3\n",
  "bom.md": "\uFEFFplain text with a byte order mark\n",
  // Not text: a NUL in the first 8000 bytes makes it binary, which the rule does not read (the crlf rule does not either).
  "blob.dat": Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from("caf\u00C3\u00A9 \uFFFD", "utf8")]),
});
const rmc = run(mjClean);
check(rmc.status === 0, `correct accents, capital A-tilde letters, smart punctuation, CJK, emoji, Cyrillic and a binary file pass${rmc.status ? ": " + rmc.stdout.trim() : ""}`);

// mojibake, wider: the same misdecoding for the lead bytes 0xE2 (U+2000-U+2FFF: quotes, dashes, stars, circles, arrows)
// and 0xC2 (U+0080-U+00BF: middle dot, no-break space, degree, section). Fixtures are built from code points with
// String.fromCharCode, so this file holds no escape text and never matches the rule.
const cp = (...n) => String.fromCharCode(...n);
const [A, a] = [cp(0xC2), cp(0xE2)]; // capital A-circumflex, a-circumflex
// The 27 Windows-1252 images of the bytes 0x80-0x9F that are not C1 controls, listed here on purpose and not read from
// guard.mjs, so a change to the class there is noticed here.
const IMAGES = [0x20AC, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017D, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, 0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x017E, 0x0178];
const CONT = [...Array.from({ length: 0x40 }, (_, i) => 0x80 + i), ...IMAGES]; // what a continuation byte reads back as
check(IMAGES.length === 27 && new Set(IMAGES).size === 27 && CONT.length === 91, "the continuation class under test has 91 members (64 + 27 images)");
const sweep = (lead, chars) => chars.map((c) => cp(lead, c) + "\n").join("");
const mjw = repo({
  "mjw-star.md": "rated 5 " + cp(0xE2, 0x02DC, 0x2026) + " stars\n",
  "mjw-circle.md": "ok\nmarker " + cp(0xE2, 0x2014, 0x017D) + " here\n",
  "mjw-arrow.md": "a " + cp(0xE2, 0x2020, 0x2019) + " b\n",
  "mjw-latin1.md": "it" + cp(0xE2, 0x0080, 0x0099) + "s\n",
  "mjw-middot.md": "Wells Fargo Bank " + cp(0xC2, 0xB7) + " BRANCH\n",
  "mjw-nbsp.md": "5" + cp(0xC2, 0xA0) + "km\n",
  "mjw-degree.md": "72" + cp(0xC2, 0xB0) + "F\n",
  "mjw-section.md": "see " + cp(0xC2, 0xA7) + " 4\n",
  "mjw-utf16.txt": Buffer.from(cp(0xFEFF) + "x " + cp(0xE2, 0x02DC, 0x2026) + "\n", "utf16le"),
  "mjw-mixed.md": "fine\n5" + cp(0xC2, 0xB0) + "\nstar " + cp(0xE2, 0x02DC, 0x2026) + "\n",
  "mjw-sweep-e2.md": sweep(0xE2, CONT),
  "mjw-sweep-c2.md": sweep(0xC2, CONT),
});
const rmw = run(mjw);
check(rmw.status === 1, "a repo with the U+00E2 and U+00C2 families fails");
for (const f of ["mjw-star.md", "mjw-circle.md", "mjw-arrow.md", "mjw-latin1.md", "mjw-middot.md", "mjw-nbsp.md", "mjw-degree.md", "mjw-section.md", "mjw-utf16.txt", "mjw-mixed.md", "mjw-sweep-e2.md", "mjw-sweep-c2.md"])
  check(flags(rmw.stdout, "mojibake", f), `flags mojibake in ${f}`);
const mjwLine = (f) => rmw.stdout.split("\n").find((l) => new RegExp(`^mojibake\\s+${esc(f)}(\\s|$)`).test(l)) ?? "";
check(/line 1: U\+00E2 U\+02DC$/.test(mjwLine("mjw-star.md")), "the broken star (U+00E2 U+02DC U+2026) is named by its first two code points");
check(/line 2: U\+00E2 U\+2014$/.test(mjwLine("mjw-circle.md")), "the broken circle (U+00E2 U+2014 U+017D) is named, on line 2");
check(/line 1: U\+00E2 U\+2020$/.test(mjwLine("mjw-arrow.md")), "a broken arrow (U+00E2 U+2020 U+2019) is named");
check(/line 1: U\+00E2 U\+0080$/.test(mjwLine("mjw-latin1.md")), "a Latin-1 decode (U+00E2 U+0080 U+0099) is named");
check(/line 1: U\+00C2 U\+00B7$/.test(mjwLine("mjw-middot.md")), "the misdecoded middle dot (U+00C2 U+00B7) is named");
check(/line 1: U\+00C2 U\+00A0$/.test(mjwLine("mjw-nbsp.md")), "the misdecoded no-break space (U+00C2 U+00A0) is named");
check(/line 1: U\+00C2 U\+00B0$/.test(mjwLine("mjw-degree.md")), "the misdecoded degree sign (U+00C2 U+00B0) is named");
check(/line 1: U\+00C2 U\+00A7$/.test(mjwLine("mjw-section.md")), "the misdecoded section sign (U+00C2 U+00A7) is named");
check(/line 1: U\+00E2 U\+02DC$/.test(mjwLine("mjw-utf16.txt")), "UTF-16 text with the broken star is decoded first, as the crlf rule does");
check(/line 2: U\+00C2 U\+00B0 \(\+1 more line\)$/.test(mjwLine("mjw-mixed.md")), "a file with both families names the first and counts the other");
check(/line 1: U\+00E2 U\+0080 \(\+90 more lines\)$/.test(mjwLine("mjw-sweep-e2.md")), "all 91 members of the class are flagged after U+00E2");
check(/line 1: U\+00C2 U\+0080 \(\+90 more lines\)$/.test(mjwLine("mjw-sweep-c2.md")), "all 91 members of the class are flagged after U+00C2");

// Look-alikes that must pass: a-circumflex and capital A-circumflex as letters, the same marks written correctly, and
// every ordinary character after either lead.
const letters = [...Array.from({ length: 0x5F }, (_, i) => 0x20 + i), ...Array.from({ length: 0x40 }, (_, i) => 0xC0 + i), 0x0141, 0x0107, 0x011F, 0x0416, 0x65E5];
const mjwClean = repo({
  "circumflex.md": "p" + a + "t" + cp(0xE9) + " ch" + a + "teau " + a + "me R" + a + "mnicu c" + a + "nd tr" + a + "ne b" + a + "timent\n",
  "capital.md": A + "GE " + A + " la " + A + "ME TR" + A + "NE\n" + A + " 5 " + A + "5 " + A + "-x " + A + ", " + A + ". " + A + '" ' + A + "\n" + a + "\n" + a + A + " " + a + a + " " + A + A + "\n",
  "eof-a.md": "ends with " + a,
  "eof-capital.md": "ends with " + A,
  "correct-marks.md": "rated 5 " + cp(0x2605) + " " + cp(0x25CE) + " 72" + cp(0xB0) + "F Wells " + cp(0xB7) + " Branch 5" + cp(0xA0) + "km " + cp(0xA7) + "4 " + cp(0x2192) + " " + cp(0xA9) + " " + cp(0xAB) + "x" + cp(0xBB) + " it" + cp(0x2019) + "s " + cp(0x201C) + "q" + cp(0x201D) + " " + cp(0x2014) + " " + cp(0x2026) + "\n",
  "sweep-e2.md": sweep(0xE2, letters) + a + cp(0xD83C, 0xDF89) + "\n",
  "sweep-c2.md": sweep(0xC2, letters) + A + cp(0xD83C, 0xDF89) + "\n",
});
const rmwc = run(mjwClean);
check(rmwc.status === 0, `a-circumflex and capital A-circumflex as letters, the marks written correctly, and every ordinary character after either lead pass${rmwc.status ? ": " + rmwc.stdout.trim().split("\n").slice(0, 5).join(" | ") : ""}`);

// An allow entry waives a file by its exact bytes, as it does for size; the other content scans still run on it.
const legacy = "caf\u00C3\u00A9\n";
check(run(repo({ "legacy.txt": legacy, "guard.allow.json": allowJson("legacy.txt", sha(legacy)) })).status === 0,
  "an allow-listed file with mojibake and its reviewed hash passes");
const rw1 = run(repo({ "legacy.txt": legacy + "more\n", "guard.allow.json": allowJson("legacy.txt", sha(legacy)) }));
check(rw1.status === 1 && flags(rw1.stdout, "allow", "legacy.txt") && flags(rw1.stdout, "mojibake", "legacy.txt"),
  "an allow-listed file whose bytes changed fails again, on the hash and on the mojibake");
const crlfLegacy = "caf\u00C3\u00A9\r\n";
const rw2 = run(repo({ "legacy.txt": crlfLegacy, "guard.allow.json": allowJson("legacy.txt", sha(crlfLegacy)) }));
check(rw2.status === 1 && flags(rw2.stdout, "crlf", "legacy.txt") && !flags(rw2.stdout, "mojibake", "legacy.txt"),
  "the waiver covers mojibake only: an allow-listed file still fails crlf");
const keyedMj = "AKIA" + caps + " caf\u00C3\u00A9\n";
const rw3 = run(repo({ "k.txt": keyedMj, "guard.allow.json": allowJson("k.txt", sha(keyedMj)) }));
check(rw3.status === 1 && flags(rw3.stdout, "secret", "k.txt") && !flags(rw3.stdout, "mojibake", "k.txt"),
  "an allow-listed mojibake file is still scanned for secrets");
check(flags(run(repo({ "other.txt": legacy, "legacy.txt": "x\n", "guard.allow.json": allowJson("legacy.txt", sha("x\n")) })).stdout, "mojibake", "other.txt"),
  "an allow entry for one file waives no other file");

// Workflow actions must be pinned to a full commit sha; a tag or branch fails. Only workflow files are judged.
const hex = "0123456789abcdef".repeat(3).slice(0, 40);
const steps = (...uses) => "on: push\njobs:\n  a:\n    steps:\n" + uses.map((u) => `      - uses: ${u}\n`).join("");
const pinned = repo({
  ".github/workflows/ok.yml": steps(`actions/checkout@${hex} # v4`, `"actions/setup-node@${hex}"`, "./.github/actions/local"),
  ".github/workflows/ok2.yaml": "jobs:\n  a:\n    uses: org/repo/.github/workflows/w.yml@" + hex + "\n",
  "README.md": "Don't write uses: actions/checkout@v4 in a workflow.\n",
  ".github/notes.yml": "uses: actions/checkout@v4\n",
});
const rp = run(pinned);
check(rp.status === 0, `sha-pinned and local actions pass, and non-workflow files aren't judged${rp.status ? ": " + rp.stdout.trim() : ""}`);
const unpinnedRepo = repo({
  ".github/workflows/tag.yml": steps("actions/checkout@v4"),
  ".github/workflows/branch.yaml": steps("'actions/setup-node@main'"),
  ".github/workflows/short.yml": steps("actions/checkout@" + hex.slice(0, 7) + " # v4"),
  ".github/workflows/upper.yml": steps("actions/checkout@" + hex.toUpperCase()),
  ".github/workflows/bare.yml": steps("actions/checkout"),
  ".github/workflows/docker.yml": steps("docker://alpine:3.20"),
  ".github/workflows/reusable.yml": "jobs:\n  a:\n    uses: org/repo/.github/workflows/w.yml@v1\n",
});
const ru = run(unpinnedRepo);
check(ru.status === 1, "a repo with tag-pinned actions fails");
for (const f of ["tag.yml", "branch.yaml", "short.yml", "upper.yml", "bare.yml", "docker.yml", "reusable.yml"])
  check(flags(ru.stdout, "pin", ".github/workflows/" + f), `flags pin in ${f}`);
check(/line 5: actions\/checkout@v4$/m.test(ru.stdout), "a pin finding names the line and the value");

// eval-leak: nothing gradable (gold, KEY, split outputs) is committed, by name or by header marker.
// The marker strings are joined so this file never carries one.
const marker = (kind) => ["groundtruth", "eval", kind, "v1"].join("-");
const leaky = repo({
  "gold.json": "{}\n",
  "KEY.json": "{}\n",
  "split.json": "{}\n",
  "eval/gold-v4.json": "{}\n",
  "eval/split.v4.json": "{}\n",
  "eval/KEY": "x\n",
  "eval/grades/key_blind.csv": "a,b\n",
  "notes/renamed.txt": '{"marker": "' + marker("gold") + '"}\n',
  "notes/renamed2.md": "header " + marker("split") + "\n",
  "notes/renamed3.md": "header " + marker("key") + "\n",
});
const rl = run(leaky);
check(rl.status === 1, "a repo with gold, KEY or split files fails");
for (const f of ["gold.json", "KEY.json", "split.json", "eval/gold-v4.json", "eval/split.v4.json", "eval/KEY", "eval/grades/key_blind.csv", "notes/renamed.txt", "notes/renamed2.md", "notes/renamed3.md"])
  check(flags(rl.stdout, "eval-leak", f), `flags eval-leak in ${f}`);
const evalClean = repo({
  "eval/split.mjs": "// code\n",
  "eval/split.test.mjs": "// code\n",
  "eval/gold/build-gold.mjs": "// code\n",
  "eval/gold.test.mjs": "// code\n",
  "eval/score.py": "# code\n",
  "eval/README.md": "Gold, the KEY and split files stay outside the repo.\n",
  "apps/keyboard.json": "{}\n",
  "data/monkey.json": "{}\n",
  "docs/goldfish.md": "x\n",
});
const rc = run(evalClean);
check(rc.status === 0, `eval code, docs and look-alike names pass${rc.status ? ": " + rc.stdout.trim() : ""}`);

// rules: a "Checked here" row of AGENTS.md's table must name a tracked path and an existing workflow file.
const table = (...rows) =>
  "# Rules\n\n## Record rules and what enforces them\n\nProse mentioning `scripts/nope.mjs` and `.github/workflows/nope.yml` is not judged.\n\n| Rule | Enforced by | Status |\n|---|---|---|\n" +
  rows.map((r) => `| ${r.join(" | ")} |`).join("\n") + "\n\nAfter the table.\n";
const okRow = ["A rule", "`scripts/a.mjs`, run by `.github/workflows/w.yml`", "Checked here"];
const base = { "scripts/a.mjs": "// a\n", ".github/workflows/w.yml": steps(`actions/checkout@${hex}`) };
const rulesOk = repo({ ...base, "AGENTS.md": table(okRow, ["Judgement", "Nothing yet", "Review only"], ["Eye only", "eye: `lib/x.ts`", "Checked in eye"]) });
const rr0 = run(rulesOk);
check(rr0.status === 0, `a table whose Checked rows name tracked paths and an existing workflow passes${rr0.status ? ": " + rr0.stdout.trim() : ""}`);
const rr1 = run(repo({ ...base, "AGENTS.md": table(["Gone", "`scripts/missing.mjs`", "Checked here"]) }));
check(rr1.status === 1 && flags(rr1.stdout, "rules", "AGENTS.md:9"), "a Checked row naming only an untracked path fails");
const rr2 = run(repo({ ...base, "AGENTS.md": table(["No wf", "`scripts/a.mjs`, run by `.github/workflows/ghost.yml`", "Checked here"]) }));
check(rr2.status === 1 && flags(rr2.stdout, "rules", "AGENTS.md:9") && /ghost\.yml/.test(rr2.stdout), "a Checked row naming a missing workflow fails");
const rr3 = run(repo({ ...base, "AGENTS.md": table(["Nothing", "Nothing yet", "Checked here"]) }));
check(rr3.status === 1, "a Checked row naming no path at all fails");
const rr4 = run(repo({ "AGENTS.md": table(["Gone", "`scripts/missing.mjs`", "Review only"]) }));
check(rr4.status === 0, "a row that is not marked Checked is not judged");
const rr5 = run(repo({ "README.md": "x\n" }));
check(rr5.status === 0, "a repo with no AGENTS.md is not judged");

// rules, Tested rows: a row whose Status starts "Tested" (and says here) gets the path and workflow check and
// nothing else. Every path-looking token it names must resolve to a tracked file, and it must name at least one;
// it is not asked to name a mutant. A Checked row keeps its looser "at least one tracked path" reading.
const tested = (rule, by, status = "Tested here, no rule mutant yet") => [rule, by, status];
const rt0 = run(repo({ ...base, "AGENTS.md": table(tested("Tested ok", "`scripts/a.mjs`, run by `.github/workflows/w.yml`")) }));
check(rt0.status === 0, `a Tested row naming tracked paths and an existing workflow, and no mutant, passes${rt0.status ? ": " + rt0.stdout.trim() : ""}`);
const rt1 = run(repo({ ...base, "AGENTS.md": table(tested("Gone", "`scripts/missing.mjs`")) }));
check(rt1.status === 1 && flags(rt1.stdout, "rules", "AGENTS.md:9") && /missing\.mjs/.test(rt1.stdout), "a Tested row naming only an untracked path fails");
const rt2 = run(repo({ ...base, "AGENTS.md": table(tested("Half stale", "`scripts/a.mjs`, `scripts/stale.mjs`")) }));
check(rt2.status === 1 && flags(rt2.stdout, "rules", "AGENTS.md:9") && /stale\.mjs/.test(rt2.stdout) && !/scripts\/a\.mjs/.test(rt2.stdout),
  "a Tested row naming one stale path beside a tracked one fails, and names only the stale one");
const rt3 = run(repo({ ...base, "AGENTS.md": table(tested("No wf", "`scripts/a.mjs`, run by `.github/workflows/ghost.yml`")) }));
check(rt3.status === 1 && flags(rt3.stdout, "rules", "AGENTS.md:9") && /workflow .*ghost\.yml/.test(rt3.stdout) && (rt3.stdout.match(/ghost\.yml/g) ?? []).length === 1,
  "a Tested row naming a missing workflow fails, once");
const rt4 = run(repo({ ...base, "AGENTS.md": table(tested("Nothing", "Nothing yet")) }));
check(rt4.status === 1 && flags(rt4.stdout, "rules", "AGENTS.md:9"), "a Tested row naming no path at all fails");
const rt5 = run(repo({ ...base, "AGENTS.md": table(tested("Mutant too", "`scripts/a.mjs`. Mutants: `some-break`.")) }));
check(rt5.status === 0, "a Tested row is neither required nor refused a Mutants: list");

// Bare basenames: a token with no directory that matches exactly one tracked file's name resolves to it.
const rb0 = run(repo({ ...base, "AGENTS.md": table(tested("Bare", "`a.mjs`, run by `w.yml`")) }));
check(rb0.status === 0, `a bare basename that matches exactly one tracked file passes, workflows included${rb0.status ? ": " + rb0.stdout.trim() : ""}`);
const rb1 = run(repo({ ...base, "apps/dup.mjs": "// 1\n", "scripts/dup.mjs": "// 2\n", "AGENTS.md": table(tested("Dup", "`scripts/a.mjs`, `dup.mjs`")) }));
check(rb1.status === 1 && flags(rb1.stdout, "rules", "AGENTS.md:9") && /apps\/dup\.mjs/.test(rb1.stdout) && /scripts\/dup\.mjs/.test(rb1.stdout),
  "a bare basename that matches two tracked files fails and names both");
const rb2 = run(repo({ ...base, "AGENTS.md": table(tested("Gone bare", "`scripts/a.mjs`, `gone.mjs`")) }));
check(rb2.status === 1 && flags(rb2.stdout, "rules", "AGENTS.md:9") && /gone\.mjs/.test(rb2.stdout), "a bare basename that matches no tracked file fails");
const rb3 = run(repo({ ...base, "apps/m/lib/x.mjs": "// x\n", "AGENTS.md": table(tested("Tail", "`scripts/a.mjs`, `lib/x.mjs`")) }));
check(rb3.status === 1 && flags(rb3.stdout, "rules", "AGENTS.md:9") && /lib\/x\.mjs/.test(rb3.stdout), "a token with a directory is not resolved by its tail");

// What is not a path is not judged: dotted identifiers, globs, directories, flags, a Mutants: label.
const rn0 = run(repo({ ...base, "AGENTS.md": table(tested("Not paths", "`scripts/a.mjs` (`fieldStyle.colorFor`, `Date.now`, `outFields=*`, `*Style`, `raw/`, `apps/map/lib`, `Mutants:`)")) }));
check(rn0.status === 0, `dotted identifiers, globs, directories and labels in a Tested row are not paths${rn0.status ? ": " + rn0.stdout.trim() : ""}`);
// A command with its argument: the path is the judged word, wherever it sits in the span.
const rn1 = run(repo({ ...base, "AGENTS.md": table(tested("Command", "`node scripts/a.mjs --flag`")) }));
check(rn1.status === 0, "a path after a command word in one backticked span is read and passes when tracked");
const rn2 = run(repo({ ...base, "AGENTS.md": table(tested("Command gone", "`scripts/a.mjs`, `node scripts/gone.mjs`")) }));
check(rn2.status === 1 && /scripts\/gone\.mjs/.test(rn2.stdout), "a stale path after a command word in one backticked span fails");

// Which rows are Tested rows: the Status starts Tested and says here, like a Checked row. Others are not judged.
const ro0 = run(repo({ ...base, "AGENTS.md": table(tested("In eye", "eye: `lib/search/x.ts`", "Tested in eye")) }));
check(ro0.status === 0, "a row Tested elsewhere (in eye) is not judged against this repo");
const ro1 = run(repo({ ...base, "AGENTS.md": table(tested("Not tested", "`scripts/missing.mjs`", "Review only")) }));
check(ro1.status === 0, "a row that is neither Checked nor Tested is not judged");
// The Checked reading is unchanged: some tracked path is enough, so a Checked row can still cite eye paths beside its own.
const ro2 = run(repo({ ...base, "AGENTS.md": table(["Checked with eye", "eye: `lib/search/x.ts`. Here, `scripts/a.mjs`", "Checked here"]) }));
check(ro2.status === 0, "a Checked row keeps its at-least-one-tracked-path reading");

// prereg-check has its own self-test; guard.yml runs this file, so run it from here too.
const pre = spawnSync(process.execPath, [path.join(path.dirname(guard), "prereg-check.test.mjs")], { encoding: "utf8" });
process.stdout.write(pre.stdout);
check(pre.status === 0, "scripts/prereg-check.test.mjs passes");

for (const d of made) rmSync(d, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks pass");
process.exitCode = failed ? 1 : 0;
