import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCli, loadItems } from "../lib/cite/cli";
import { createGate, type Clock, type FetchLike } from "../lib/cite/fetch";
import { listRecorded } from "../lib/cite/recorded";
import { WORLD_FIXTURES } from "../lib/cite/worldItems";

// scripts/cite-check.mjs is a thin wrapper over runCli; these drive runCli the way the script does.

const fixtureFiles = () => readdirSync(WORLD_FIXTURES).filter((f) => f.endsWith(".json")).sort().map((f) => path.join(WORLD_FIXTURES, f));

function fakeClock(): Clock & { t: number } {
  const c = {
    t: Date.parse("2026-10-20T12:00:00Z"),
    now: () => c.t,
    sleep: async (ms: number) => {
      c.t += ms;
    },
  };
  return c;
}

afterEach(() => vi.unstubAllGlobals());

describe("cite-check --fixtures", () => {
  it("is network-free and covers all twelve world fixtures", async () => {
    const boom = vi.fn(() => {
      throw new Error("the network was touched");
    });
    vi.stubGlobal("fetch", boom);
    expect(fixtureFiles().length).toBe(12);
    const r = await runCli(["--fixtures"]);
    expect(boom).not.toHaveBeenCalled();
    expect(r.code).toBe(0);
    expect(r.summary).not.toBeNull();
    expect(r.summary?.total).toBe(r.verdicts.length);
    expect(r.verdicts.length).toBeGreaterThan(100);
  });

  it("reports CONFIRMED or NOT_PUBLISHED for a valued item with a recorded reply, and itemises every other outcome", async () => {
    const r = await runCli(["--fixtures"]);
    const quiet = new Set(["CONFIRMED", "NOT_PUBLISHED", "NO_RECORD_URL"]);
    const other = r.verdicts.filter((v) => !quiet.has(v.status));
    // a CONTRADICTED, CHANGED_SINCE or UNREACHABLE is a finding: its reason, record URL and hash are printed, never swallowed
    for (const v of other) {
      expect(r.text, `${v.status} ${v.sourceId} | ${v.fact}`).toContain(v.reason);
      expect(r.text).toContain(v.recordUrl as string);
    }
    for (const v of r.verdicts.filter((x) => x.status === "NOT_PUBLISHED")) expect(r.text).toContain(v.reason);
    // items with a record URL and no recorded reply are listed, not skipped silently
    for (const it of r.unrecorded) expect(r.text).toContain(it.upstreamRecordUrl as string);
    expect(r.unrecorded.length).toBeGreaterThan(0);
  });

  it("its summary excludes UNREACHABLE, NO_RECORD_URL and REFUSED from the confirmed and wrong totals", async () => {
    const r = await runCli(["--fixtures"]);
    const s = r.summary;
    expect(s).not.toBeNull();
    if (!s) return;
    const count = (st: string) => r.verdicts.filter((v) => v.status === st).length;
    expect(s.confirmed).toBe(count("CONFIRMED"));
    expect(s.wrong).toBe(count("CONTRADICTED"));
    expect(s.unscored).toBe(count("UNREACHABLE") + count("NO_RECORD_URL") + count("REFUSED"));
    expect(s.scored).toBe(count("CONFIRMED") + count("CONTRADICTED") + count("CHANGED_SINCE_RETRIEVAL") + count("NOT_PUBLISHED"));
    expect(s.scored + s.unscored).toBe(s.total);
    expect(r.text).toMatch(/summary: \d+ items/);
    expect(r.text).toMatch(/\(unscored: in neither the confirmed nor the wrong total\)/);
    expect(r.text).toMatch(/per host \(items\):/);
  });

  it("every CONFIRMED verdict carries a sha256 and a recorded retrievedAt", async () => {
    const r = await runCli(["--fixtures"]);
    const confirmed = r.verdicts.filter((v) => v.status === "CONFIRMED");
    expect(confirmed.length).toBeGreaterThan(30);
    const known = new Set(listRecorded().map((x) => x.sha256));
    for (const v of confirmed) {
      expect(v.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(known.has(v.sha256 as string)).toBe(true);
      expect(v.fetchedAt).toMatch(/^2026-/);
    }
  });

  it("takes a world_context reply and a v3-shaped facts file as well as a fixture", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cite-check-"));
    try {
      const items = await loadItems(path.join(WORLD_FIXTURES, "austin_pt.json"));
      const pick = items.filter((i) => i.sourceId === "census-tigerweb").slice(0, 3);
      const reply = path.join(dir, "reply.json");
      const facts = path.join(dir, "facts.json");
      writeFileSync(reply, JSON.stringify({ status: 200, payload: { topics: { fabric: { items: pick } } } }));
      writeFileSync(facts, JSON.stringify({ facts: [...pick, { ...pick[0], upstreamRecordUrl: "https://example.com/not-in-the-table" }] }));
      const a = await runCli(["--fixtures", reply]);
      expect(a.verdicts.map((v) => v.status)).toEqual(["CONFIRMED", "CONFIRMED", "CONFIRMED"]);
      const b = await runCli(["--fixtures", facts]);
      expect(b.verdicts.map((v) => v.status)).toEqual(["CONFIRMED", "CONFIRMED", "CONFIRMED", "REFUSED"]);
      expect(b.summary?.confirmed).toBe(3);
      expect(b.summary?.wrong).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses to run without exactly one of --fixtures and --live", async () => {
    expect((await runCli([])).code).toBe(2);
    expect((await runCli(["--live", "--fixtures"])).code).toBe(2);
  });
});

describe("cite-check --live (a fake fetch and a fake clock)", () => {
  it("fetches each record URL once, at most one request a second per host, and counts requests per host", async () => {
    const clock = fakeClock();
    const bodies = new Map(listRecorded().map((r) => [r.url, r]));
    const seen: Array<{ url: string; at: number }> = [];
    const fetchImpl: FetchLike = async (url) => {
      seen.push({ url, at: clock.t });
      const rec = bodies.get(url);
      return rec ? { status: 200, headers: { get: () => null }, text: async () => rec.body } : { status: 403, headers: { get: () => null }, text: async () => "Access Denied" };
    };
    const austin = path.join(WORLD_FIXTURES, "austin_pt.json");
    const r = await runCli(["--live", austin], { fetchImpl, clock, gate: createGate(clock) });
    expect(r.code).toBe(0);
    expect(r.requests).toBe(seen.length);
    expect(new Set(seen.map((s) => s.url)).size).toBe(seen.length);
    expect(Object.values(r.byHost).reduce((a, b) => a + b, 0)).toBe(r.requests);
    const byHost = new Map<string, number[]>();
    for (const s of seen) byHost.set(new URL(s.url).host, [...(byHost.get(new URL(s.url).host) ?? []), s.at]);
    for (const times of byHost.values()) for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(1000);
    // what the recorded publisher replies confirm offline they confirm "live"; what the fake publisher refuses is unscored
    expect(r.summary?.wrong).toBe(0);
    expect(r.summary?.byStatus.UNREACHABLE).toBeGreaterThan(0);
    expect(r.summary?.byStatus.CONFIRMED).toBeGreaterThan(5);
    expect(r.text).toMatch(/per host \(requests made\):/);
    expect(r.text).toMatch(/requests \d+/);
  });

  it("never sends more than 400 requests in a run", async () => {
    const clock = fakeClock();
    let n = 0;
    const fetchImpl: FetchLike = async () => (n++, { status: 429, headers: { get: () => null }, text: async () => "" });
    const r = await runCli(["--live", ...fixtureFiles()], { fetchImpl, clock, gate: createGate(clock) });
    expect(n).toBeLessThanOrEqual(400);
    expect(r.requests).toBe(n);
    expect(r.summary?.wrong).toBe(0);
    expect(r.summary?.confirmed).toBe(0);
  });
});
