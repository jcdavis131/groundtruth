// AGENTS.md: "Public, keyless sources only. No paid APIs". This is the tripwire for it: every host that
// non-test source names has to be classified in hosts.allow.json (what it is, who publishes it, whether it needs a
// key). The scanner is lib/server/hosts.scan.mjs; scripts/hosts-check.mjs runs the same check in guard.yml.
// Read the header of hosts.scan.mjs for what the check sees and what it cannot.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checkAllowlist, codeOnly, describeProblems, loadAllowlist, scanHosts, settingsKeyIds } from "./hosts.scan.mjs";

const ROOT = path.resolve(__dirname, "../..");
const ALLOW_FILE = path.join(__dirname, "hosts.allow.json");

describe("hosts.allow.json", () => {
  const scan = scanHosts(ROOT);
  const allow = loadAllowlist(ALLOW_FILE);
  const res = checkAllowlist(scan, allow, { keyIds: settingsKeyIds(ROOT) });

  it("scans the app, not nothing", () => {
    expect(scan.files).toBeGreaterThan(300);
    expect(scan.hosts.has("api.weather.gov")).toBe(true);
    expect(scan.hosts.has("stream.aisstream.io")).toBe(true);
  });

  it("names every host the code names, so a new upstream is a decision someone wrote down", () => {
    expect(res.unlisted.map((u) => `${u.host} (${u.at.map((a) => `${a.file}:${a.line}`).join(", ")})`)).toEqual([]);
  });

  it("holds no entry that no code names any more", () => {
    expect(res.stale).toEqual([]);
  });

  it("classifies each host: request hosts carry a publisher and keyless true or false", () => {
    expect(res.invalid.map((i) => `${i.host}: ${i.why}`)).toEqual([]);
  });

  it("puts no key-like parameter on a host marked keyless", () => {
    expect(res.keyed.map((k) => `${k.host} at ${k.file}:${k.line}`)).toEqual([]);
  });

  it("declares every host built at run time, and nothing that is not there", () => {
    expect(res.dynamic.map((d) => `${d.file}:${d.line}`)).toEqual([]);
    expect(res.badDynamic).toEqual([]);
  });

  it("allows a key only where settings.ts offers an optional one, and names it", () => {
    const keyed = Object.entries(allow.hosts as Record<string, { kind: string; keyless?: boolean; keyIds?: string[]; optional?: boolean }>).filter(([, e]) => e.kind === "request" && e.keyless === false);
    expect(keyed.length).toBeGreaterThan(0);
    const known = settingsKeyIds(ROOT);
    for (const [host, e] of keyed) {
      expect(e.optional, host).toBe(true);
      for (const id of e.keyIds ?? []) expect(known.has(id), `${host}: ${id}`).toBe(true);
    }
    // AGENTS.md names AISStream as the key Cam still has to rule on; that mark must stay on it
    expect((allow.hosts as Record<string, { pendingCam?: boolean }>)["stream.aisstream.io"].pendingCam).toBe(true);
  });
});

describe("the scanner, on planted code", () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "hosts-scan-"));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  function plant(files: Record<string, string>): string {
    const root = mkdtempSync(path.join(tmp, "app-"));
    for (const [rel, body] of Object.entries(files)) {
      const f = path.join(root, rel);
      mkdirSync(path.dirname(f), { recursive: true });
      writeFileSync(f, body, "utf8");
    }
    return root;
  }
  const entry = { kind: "request", publisher: "Planted Publisher", keyless: true };

  it("flags a new host in a fetch call and in a URL constant, with where", () => {
    const root = plant({
      "lib/a.ts": 'export async function a() { return fetch("https://planted.example.org/api?x=1"); }\n',
      "app/api/b/route.ts": 'const BASE = "https://also-planted.example.net/v2";\nexport const url = `${BASE}/x`;\n',
    });
    const scan = scanHosts(root);
    const res = checkAllowlist(scan, { hosts: {} });
    expect(res.unlisted.map((u) => u.host)).toEqual(["also-planted.example.net", "planted.example.org"]);
    expect(describeProblems(res).join("\n")).toContain("lib/a.ts:1");
    // naming them clears it
    const ok = checkAllowlist(scan, { hosts: { "planted.example.org": entry, "also-planted.example.net": entry } });
    expect(describeProblems(ok)).toEqual([]);
  });

  it("flags a websocket host and a Python host too", () => {
    const root = plant({
      "lib/s.ts": 'const ws = new WebSocket("wss://stream.planted.example.org/v0");\n',
      "dataops/p.py": 'URL = "https://py-planted.example.org/data.csv"\n',
    });
    expect([...scanHosts(root).hosts.keys()].sort()).toEqual(["py-planted.example.org", "stream.planted.example.org"]);
  });

  it("skips tests, fixtures, node_modules and comment lines", () => {
    const root = plant({
      "lib/a.test.ts": 'fetch("https://in-test.example.org/");\n',
      "lib/__fixtures__/f.ts": 'export const u = "https://in-fixture.example.org/";\n',
      "lib/node_modules/x/i.js": 'export const u = "https://in-modules.example.org/";\n',
      "lib/c.ts": '// see https://in-comment.example.org/docs\n/** also https://in-jsdoc.example.org/ */\n * https://in-block.example.org/\nexport const x = 1; // https://trailing.example.org/\n',
      "dataops/c.py": '# https://py-comment.example.org/\nx = 1  # https://py-trailing.example.org/\n',
    });
    expect([...scanHosts(root).hosts.keys()]).toEqual([]);
  });

  it("still reads a URL whose // is inside a string", () => {
    expect(codeOnly('const u = "https://kept.example.org/a"; // note')).toBe('const u = "https://kept.example.org/a";');
    expect(codeOnly("  // https://dropped.example.org/")).toBe("");
    expect(codeOnly("x = 'https://kept.example.org/' # note", true)).toBe("x = 'https://kept.example.org/'");
  });

  it("reports a host built at run time and wants it declared with a reason", () => {
    const root = plant({ "lib/d.ts": "export const u = (h: string) => `https://${h}/api`;\n" });
    const scan = scanHosts(root);
    expect(scan.dynamic).toEqual([{ file: "lib/d.ts", line: 1 }]);
    expect(checkAllowlist(scan, { hosts: {} }).dynamic).toHaveLength(1);
    expect(checkAllowlist(scan, { hosts: {}, dynamic: [{ file: "lib/d.ts", why: "builds a link from a record" }] }).dynamic).toEqual([]);
    expect(checkAllowlist(scan, { hosts: {}, dynamic: [{ file: "lib/gone.ts", why: "x" }] }).badDynamic).toHaveLength(1);
  });

  it("fails a stale entry, so a removed host cannot be re-added unseen", () => {
    const root = plant({ "lib/a.ts": 'export const u = "https://planted.example.org/";\n' });
    const res = checkAllowlist(scanHosts(root), { hosts: { "planted.example.org": entry, "removed.example.org": entry } });
    expect(res.stale).toEqual(["removed.example.org"]);
  });

  it("fails entries that are not well formed", () => {
    const root = plant({ "lib/a.ts": 'export const u = "https://planted.example.org/";\n' });
    const scan = scanHosts(root);
    const why = (e: unknown) => checkAllowlist(scan, { hosts: { "planted.example.org": e } }, { keyIds: new Set(["REAL_KEY"]) }).invalid.map((i) => i.why);
    expect(why({ kind: "request", keyless: true })).toEqual(["a request host needs a publisher"]);
    expect(why({ kind: "request", publisher: "P" })).toEqual(["a request host needs keyless: true or false"]);
    expect(why({ kind: "shrug" })).toHaveLength(1);
    expect(why({ kind: "link" })).toEqual([]);
    expect(why({ kind: "identifier" })).toEqual([]);
    // keyless false: an optional, user-entered key from settings.ts, named, with a note
    expect(why({ kind: "request", publisher: "P", keyless: false })).toHaveLength(3);
    expect(why({ kind: "request", publisher: "P", keyless: false, keyIds: ["NOT_A_KEY"], optional: true, note: "n" })).toEqual(["keyId NOT_A_KEY is not in settings.ts API_KEYS"]);
    expect(why({ kind: "request", publisher: "P", keyless: false, keyIds: ["REAL_KEY"], optional: true, note: "what it unlocks" })).toEqual([]);
    expect(why({ kind: "request", publisher: "P", keyless: false, keyIds: ["REAL_KEY"], note: "n" })).toHaveLength(1);
  });

  it("fails a key-like parameter on a host marked keyless, unless the entry says why it is not a credential", () => {
    const root = plant({ "lib/k.ts": 'export const u = "https://planted.example.org/api?format=json&key=abc123";\n' });
    const scan = scanHosts(root);
    expect(scan.keyed).toEqual([{ host: "planted.example.org", file: "lib/k.ts", line: 1 }]);
    expect(checkAllowlist(scan, { hosts: { "planted.example.org": entry } }).keyed).toHaveLength(1);
    expect(checkAllowlist(scan, { hosts: { "planted.example.org": { ...entry, keyParamNote: "a file path, not a credential" } } }).keyed).toEqual([]);
    const keyed = { kind: "request", publisher: "P", keyless: false, keyIds: ["K"], optional: true, note: "n" };
    expect(checkAllowlist(scan, { hosts: { "planted.example.org": keyed } }, { keyIds: new Set(["K"]) }).keyed).toEqual([]);
  });
});
