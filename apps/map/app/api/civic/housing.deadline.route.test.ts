// /api/civic?op=housing&part=: the parts and the vouchers/QCT answer run at once, so a box whose
// DDA answer never comes back answers in about one 35 s deadline (not two, against maxDuration
// 60), with dda null and a caveat, never 0 or an empty collection. The real cache (its deadline is
// what is under test) and fake timers; HUD's answers are the 2026-10-17 captures. No network.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import hcvAustin from "@/lib/civic/fixtures/hud-hcv-austin.json";
import qctAustin from "@/lib/civic/fixtures/hud-qct-austin.json";
import lihtcAustin from "@/lib/civic/fixtures/hud-lihtc-austin.json";
import { HCV_LAYER, QCT_LAYER } from "@/lib/civic/housing";
import { DDA_LAYER, LIHTC_LAYER } from "@/lib/civic/taxcredit";

const { GET, maxDuration } = await import("./route");

const calls: string[] = [];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  calls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      const u = String(url);
      calls.push(u);
      // DDA never answers.
      if (u.startsWith(`${DDA_LAYER}/query?`)) return new Promise<Response>(() => {});
      const body = u.startsWith(`${HCV_LAYER}/query?`) ? hcvAustin : u.startsWith(`${QCT_LAYER}/query?`) ? qctAustin : u.startsWith(`${LIHTC_LAYER}/query?`) ? lihtcAustin : null;
      if (body == null) return Promise.reject(new Error(`unexpected request ${u}`));
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

type Body = { data: Record<string, unknown>; ddaCount?: number | null; lihtcCount?: number | null; caveats: string[]; provenance: Array<{ seriesId?: string; source: { id: string } }> };

describe("op=housing with a part that misses its deadline", () => {
  it("asks every layer at once and answers within one deadline: the late part is null with a caveat, never 0", async () => {
    const t0 = Date.now();
    const pending = GET(new NextRequest("http://localhost/api/civic?op=housing&bbox=-97.9,30.1,-97.6,30.4&part=dda,lihtc"));
    // A few gate slots (500 ms apart) in, all four layers have been asked while DDA still hangs:
    // the vouchers and QCT do not wait for the parts.
    await vi.advanceTimersByTimeAsync(3_000);
    for (const layer of [DDA_LAYER, LIHTC_LAYER, HCV_LAYER, QCT_LAYER]) expect(calls.some((c) => c.startsWith(`${layer}/query?`)), layer).toBe(true);
    await vi.advanceTimersByTimeAsync(34_000);
    const res = await pending;
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThanOrEqual(37_000);
    expect(elapsed).toBeLessThan(50_000);
    expect(maxDuration).toBe(60);

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as Body;
    expect(body.data.dda).toBeNull();
    expect(body.ddaCount).toBeNull();
    expect((body.data.lihtc as { features: unknown[] }).features).toHaveLength(134);
    expect(body.lihtcCount).toBe(134);
    expect((body.data.hcv as { features: unknown[] }).features).toHaveLength(259);
    expect(body.caveats.join(" ")).toMatch(/DDA answer did not arrive within 35 s, so dda is null \(unknown\), not 0/);
    // no provenance row claims a DDA retrieval that never landed
    expect(body.provenance.some((p) => String(p.seriesId ?? "").startsWith("Difficult_Development_Areas"))).toBe(false);
  });
});
