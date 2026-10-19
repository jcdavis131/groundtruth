// /api/employers?op=equity serves the bundled RSU/vesting dossiers. No
// network: the dossiers ship in lib/companies/data/equity_dossiers.json.
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";

const get = (qs: string) => GET(new NextRequest(`http://localhost/api/employers?${qs}`));

describe("/api/employers op=equity", () => {
  it("serves a dossier by ticker, case-insensitively", async () => {
    const res = await get("op=equity&ticker=jpm");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        ticker: string;
        company: string;
        vesting: Array<{ form: string; url: string; statement: string }>;
        blackoutWindowEstimate: { label: string; statement: string } | null;
      };
      provenance: Array<{ source: { id: string } }>;
      caveats: string[];
      meta: { op: string; ticker: string; found: boolean };
    };
    expect(body.data.ticker).toBe("JPM");
    expect(body.data.company).toMatch(/JPMorgan/);
    expect(body.data.vesting.length).toBeGreaterThan(0);
    for (const v of body.data.vesting) {
      expect(v.form).toMatch(/10-K|DEF 14A|20-F|40-F/);
      expect(v.url).toMatch(/^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\//);
    }
    expect(body.data.blackoutWindowEstimate?.label).toMatch(/ESTIMATE/i);
    expect(body.provenance[0].source.id).toBe("sec-edgar");
    expect(body.caveats.some((c) => /estimate/i.test(c))).toBe(true);
    expect(body.meta).toMatchObject({ op: "equity", ticker: "JPM", found: true });
  });

  it("404s for a ticker outside the pilot batch and names the batch", async () => {
    const res = await get("op=equity&ticker=AAPL");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("AAPL");
    expect(body.error).toContain("JPM");
  });

  it("400s without a ticker", async () => {
    const res = await get("op=equity");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/ticker is required/);
  });

  it("still serves the other ops after the equity case was added", async () => {
    const res = await get("op=top&limit=2");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data.length).toBe(2);
  });
});
