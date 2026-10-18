// /api/rsu?op=events with the calendar store replaced by in-memory test events:
// a withheld reporting owner is left out of data and meta.total with no marker,
// a malformed withholding setting fails the answer closed, and the default op
// stays blackout. No files, no network.
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { RsuEvent } from "@/lib/rsu/events";
import { WITHHELD_ENV, WITHHELD_KEY_ENV, withheldDigest } from "@/lib/people/suppressed";

const event = (id: string, filer_cik: string): RsuEvent => ({
  event_id: id,
  event_type: "vest",
  event_date: "2026-03-02",
  knowable_date: "2026-03-04",
  knowable_estimated: false,
  issuer_cik: "1",
  issuer_ticker: "TEST",
  issuer_name: "Test issuer",
  filer_name: `Test owner ${id}`,
  filer_cik,
  shares: 10,
  price: null,
  security_title: "Restricted Stock Units",
  source: "form4",
  confidence: "high",
  provenance: { parser: "test" },
});

const EVENTS = [event("a", "111"), event("b", "222"), event("c", "")];

vi.mock("@/lib/rsu/events", () => ({
  allRsuEvents: () => EVENTS,
  rsuEventsFiltered: () => EVENTS,
  rsuEventProvenance: () => ({ source: "test", pulled: null, note: "" }),
}));

const { GET } = await import("./route");

const get = async (query: string) => {
  const res = await GET(new NextRequest(`http://localhost/api/rsu${query}`));
  return { status: res.status, body: await res.json() };
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/rsu?op=events", () => {
  it("serves every event when nothing is withheld", async () => {
    const { status, body } = await get("?op=events");
    expect(status).toBe(200);
    expect(body.data.map((e: RsuEvent) => e.event_id)).toEqual(["a", "b", "c"]);
    expect(body.meta).toMatchObject({ count: 3, total: 3 });
  });

  it("leaves a withheld owner out of data and total, with no marker", async () => {
    const key = "test-key";
    vi.stubEnv(WITHHELD_KEY_ENV, key);
    vi.stubEnv(WITHHELD_ENV, withheldDigest("222", key));
    const { status, body } = await get("?op=events");
    expect(status).toBe(200);
    expect(body.data.map((e: RsuEvent) => e.event_id)).toEqual(["a", "c"]);
    expect(body.meta).toMatchObject({ count: 2, total: 2 });
    expect(JSON.stringify(body)).not.toContain("222");
  });

  it("fails closed when the withholding setting is malformed", async () => {
    vi.stubEnv(WITHHELD_ENV, "not-a-digest");
    vi.stubEnv(WITHHELD_KEY_ENV, "test-key");
    const { status, body } = await get("?op=events");
    expect(status).toBe(500);
    expect(body.data).toBeUndefined();
    expect(body.error).toContain(WITHHELD_ENV);
  });
});

describe("GET /api/rsu default op", () => {
  it("stays blackout", async () => {
    const { status, body } = await get("");
    expect(status).toBe(200);
    expect(body.status).toBe("not_publicly_disclosed");
  });
});
