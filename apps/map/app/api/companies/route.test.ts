// /api/companies?op=company with SEC answered from small in-test payloads. No
// network. Checks the two things the 2026-09-30 hotfix changed: every SEC call
// sends SEC_USER_AGENT (no URL token, which SEC answers with 403), and a CIK
// that belongs to an individual is refused before anything about it is cached
// or returned.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { SEC_USER_AGENT } from "@/lib/companies/edgar";

/** Every key and value the route or the EDGAR readers asked the cache to hold. */
const cacheLog = vi.hoisted(() => [] as Array<{ key: string; value: unknown }>);
/** Set by the tests that need the real cache (repeat requests, an SEC outage). */
const cacheMode = vi.hoisted(() => ({ real: false }));

vi.mock("@/lib/server/cache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/cache")>();
  return {
    ...actual,
    // No memo unless a test switches the real cache on; either way, remember what would be held.
    cached: async <T,>(k: string, ttl: number, produce: () => Promise<T>) => {
      const r = cacheMode.real ? await actual.cached(k, ttl, produce) : { value: await produce(), age: 0, hit: false };
      cacheLog.push({ key: k, value: r.value });
      return r;
    },
  };
});

vi.mock("@/lib/server/upstream", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/upstream")>()),
  // No politeness waits between test requests.
  polite: <T,>(_n: string, _i: number, _b: number, fn: () => Promise<T>) => fn(),
}));

import { GET } from "./route";

const TICKERS_EXCHANGE = {
  fields: ["cik", "name", "ticker", "exchange"],
  data: [
    [320193, "Apple Inc.", "AAPL", "Nasdaq"],
    [2115436, "Exxon Mobil Corp", "XOM", "NYSE"],
  ],
};

const recent = { accessionNumber: [], form: [], filingDate: [], reportDate: [], primaryDocument: [], primaryDocDescription: [] };

const operating = (cik: number, name: string) => ({
  cik: String(cik),
  name,
  sic: "3571",
  sicDescription: "Electronic Computers",
  entityType: "operating",
  addresses: { business: { street1: "1 MAIN ST", city: "AUSTIN", stateOrCountry: "TX", zipCode: "78701" } },
  filings: { recent },
});

/** What EDGAR serves for an insider who only files ownership forms. */
const INDIVIDUAL = {
  cik: "1234567",
  name: "DOE JANE Q",
  sic: "",
  entityType: "other",
  addresses: { business: { street1: "9 PRIVATE LANE", city: "AUSTIN", stateOrCountry: "TX", zipCode: "78746" } },
  filings: { recent },
};

const SUBMISSIONS: Record<string, unknown> = {
  "0000320193": operating(320193, "Apple Inc."),
  "0002115436": operating(2115436, "Exxon Mobil Corp"),
  "0000034088": operating(34088, "Exxon Mobil Corp"),
  "0000999999": operating(999999, "Unlisted Operating Co"),
  "0000888888": operating(888888, "Outage Test Co"),
  "0000777777": operating(777777, "Repeat Test Co"),
  "0001234567": INDIVIDUAL,
};

const asked: Array<{ url: URL; ua: string | null }> = [];
/** When set, every SEC URL answers 503. */
const sec = { down: false };

beforeEach(() => {
  cacheLog.length = 0;
  asked.length = 0;
  cacheMode.real = false;
  sec.down = false;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    asked.push({ url, ua: new Headers(init?.headers).get("user-agent") });
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (sec.down) return new Response("Service Unavailable", { status: 503 });
    if (url.pathname === "/files/company_tickers_exchange.json") return json(TICKERS_EXCHANGE);
    const sub = url.pathname.match(/^\/submissions\/CIK(\d{10})\.json$/);
    if (sub) return SUBMISSIONS[sub[1]] ? json(SUBMISSIONS[sub[1]]) : json({ error: "not found" }, 404);
    if (url.pathname.startsWith("/api/xbrl/companyfacts/")) return json({ error: "not found" }, 404);
    throw new Error(`unexpected fetch ${url}`);
  });
});

const get = (qs: string) => GET(new NextRequest(`http://localhost/api/companies?${qs}`));

describe("/api/companies op=company", () => {
  it("sends SEC_USER_AGENT, with a contact and no URL token, on every SEC call", async () => {
    expect(SEC_USER_AGENT).toMatch(/contact: \S+@\S+/);
    expect(SEC_USER_AGENT).not.toMatch(/https?:|github\.com|\(\+/);
    const res = await get("op=company&ticker=AAPL");
    expect(res.status).toBe(200);
    const sec = asked.filter((a) => /(^|\.)sec\.gov$/.test(a.url.hostname));
    expect(sec.length).toBeGreaterThan(0);
    for (const a of sec) expect(a.ua, a.url.href).toBe(SEC_USER_AGENT);
  });

  it("refuses an individual's CIK with a 404 that names nothing, and caches nothing about them", async () => {
    const res = await get("op=company&cik=1234567");
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).not.toContain("DOE");
    expect(body).not.toContain("PRIVATE");
    // Only the yes/no verdict may be held for an individual's CIK.
    const held = cacheLog.filter((e) => e.key.includes("1234567"));
    expect(held).toEqual([{ key: "companies:admit:1234567", value: false }]);
    expect(JSON.stringify(cacheLog)).not.toContain("DOE");
  });

  it("refuses a CIK SEC does not know with a 404, not a 502", async () => {
    const res = await get("op=company&cik=4444444");
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toContain("not a company");
  });

  it("serves an operating company that is not on the listed universe", async () => {
    const res = await get("op=company&cik=999999");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { profile: { name: string; entityType: string } } };
    expect(body.data.profile.name).toBe("Unlisted Operating Co");
  });

  it("resolves a ticker from the live list before the bundle (XOM moved to a new CIK), and says where the old reports are", async () => {
    const res = await get("op=company&ticker=XOM");
    expect(res.status).toBe(200);
    expect(asked.some((a) => a.url.pathname === "/submissions/CIK0002115436.json")).toBe(true);
    expect(asked.some((a) => a.url.pathname === "/submissions/CIK0000034088.json")).toBe(false);
    const body = (await res.json()) as { caveats?: string[] };
    expect(body.caveats?.some((c) => c.includes("CIK 34088") && c.includes("op=company&cik=34088"))).toBe(true);
  });

  it("fetches an unlisted company's submissions once on a cold request, and not again while its dossier is held", async () => {
    cacheMode.real = true;
    const subs = () => asked.filter((a) => a.url.pathname === "/submissions/CIK0000777777.json").length;
    expect((await get("op=company&cik=777777")).status).toBe(200);
    expect(subs()).toBe(1);
    expect((await get("op=company&cik=777777")).status).toBe(200);
    expect((await get("op=company&cik=777777")).status).toBe(200);
    expect(subs()).toBe(1);
  });

  it("keeps serving a held dossier for an unlisted company while SEC is down", async () => {
    cacheMode.real = true;
    expect((await get("op=company&cik=888888")).status).toBe(200);
    sec.down = true;
    const res = await get("op=company&cik=888888");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: { profile: { name: string } } }).data.profile.name).toBe("Outage Test Co");
  });

  it("keeps a bundled CIK reachable even when it is no longer on the live list", async () => {
    const res = await get("op=company&cik=34088");
    expect(res.status).toBe(200);
  });
});
