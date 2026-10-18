import { describe, expect, it } from "vitest";
import { cached, cacheDelete, DeadlineError } from "./cache";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("cached", () => {
  it("shares one producer between concurrent callers and serves the stored value within the TTL", async () => {
    let calls = 0;
    const produce = async () => {
      calls++;
      await sleep(5);
      return calls;
    };
    const [a, b] = await Promise.all([cached("t:share", 60_000, produce), cached("t:share", 60_000, produce)]);
    expect([a.value, b.value]).toEqual([1, 1]);
    const c = await cached("t:share", 60_000, produce);
    expect(c).toMatchObject({ value: 1, hit: true });
    expect(calls).toBe(1);
  });

  it("stops waiting at the deadline and keeps the value that lands afterwards", async () => {
    const slow = () => sleep(40).then(() => "late");
    await expect(cached("t:deadline", 60_000, slow, { deadlineMs: 5 })).rejects.toBeInstanceOf(DeadlineError);
    await sleep(60);
    const r = await cached("t:deadline", 60_000, () => Promise.resolve("never asked"), { deadlineMs: 5 });
    expect(r).toMatchObject({ value: "late", hit: true });
  });

  it("fails fast during the cool-down after a failure, only for callers that opted in", async () => {
    let calls = 0;
    const failing = async () => {
      calls++;
      throw new Error("upstream down");
    };
    await expect(cached("t:cool", 60_000, failing, { coolMs: 60_000 })).rejects.toThrow("upstream down");
    await expect(cached("t:cool", 60_000, failing, { coolMs: 60_000 })).rejects.toThrow("upstream down");
    expect(calls).toBe(1);
    // A caller without coolMs is not turned away.
    await expect(cached("t:cool", 60_000, failing)).rejects.toThrow("upstream down");
    expect(calls).toBe(2);
  });

  it("during the cool-down a caller with nothing stored waits on the query still in flight, instead of failing", async () => {
    // identify waits 2.5 s for NAD and gives up; mode=addresses asks for the same key straight after.
    let calls = 0;
    const slow = () => {
      calls++;
      return sleep(40).then(() => "late");
    };
    await expect(cached("t:inflight", 60_000, slow, { deadlineMs: 5, coolMs: 60_000 })).rejects.toBeInstanceOf(DeadlineError);
    const r = await cached("t:inflight", 60_000, slow, { deadlineMs: 500, coolMs: 60_000 });
    expect(r).toMatchObject({ value: "late", hit: false });
    expect(calls).toBe(1);
    // Landed: the cool-down is over and the value is stored.
    expect(await cached("t:inflight", 60_000, slow, { deadlineMs: 5, coolMs: 60_000 })).toMatchObject({ value: "late", hit: true });
  });

  it("during the cool-down a held value is served at once, not waited for", async () => {
    await cached("t:held", 1, () => Promise.resolve("old"));
    await sleep(5);
    const slow = () => sleep(300).then(() => "new");
    expect(await cached("t:held", 1, slow, { deadlineMs: 5, coolMs: 60_000 })).toMatchObject({ value: "old", hit: true });
    const t0 = Date.now();
    expect(await cached("t:held", 1, slow, { deadlineMs: 1_000, coolMs: 60_000 })).toMatchObject({ value: "old", hit: true });
    expect(Date.now() - t0).toBeLessThan(150);
  });

  it("once the query in flight has failed, the cool-down fails fast without asking again", async () => {
    let calls = 0;
    const failsLate = async () => {
      calls++;
      await sleep(20);
      throw new Error("upstream down");
    };
    await expect(cached("t:fail-late", 60_000, failsLate, { deadlineMs: 5, coolMs: 60_000 })).rejects.toBeInstanceOf(DeadlineError);
    await sleep(40);
    await expect(cached("t:fail-late", 60_000, failsLate, { deadlineMs: 500, coolMs: 60_000 })).rejects.toThrow("upstream down");
    expect(calls).toBe(1);
  });

  it("says the deadline as set, not rounded to a whole second", async () => {
    await expect(cached("t:msg", 60_000, () => sleep(60).then(() => 1), { deadlineMs: 20 })).rejects.toThrow("t:msg: no answer within 0.02 s");
  });

  it("cacheDelete drops the value and the cool-down, so the next caller asks again", async () => {
    await expect(cached("t:del", 60_000, () => Promise.reject(new Error("x")), { coolMs: 60_000 })).rejects.toThrow("x");
    cacheDelete("t:del");
    const r = await cached("t:del", 60_000, () => Promise.resolve("fresh"), { coolMs: 60_000 });
    expect(r).toMatchObject({ value: "fresh", hit: false });
    cacheDelete("t:del");
    const again = await cached("t:del", 60_000, () => Promise.resolve("again"));
    expect(again.value).toBe("again");
  });

  it("serves the stale value when a refresh fails", async () => {
    await cached("t:stale", 1, () => Promise.resolve("old"));
    await sleep(5);
    const r = await cached("t:stale", 1, () => Promise.reject(new Error("down")));
    expect(r).toMatchObject({ value: "old", hit: true });
  });
});
