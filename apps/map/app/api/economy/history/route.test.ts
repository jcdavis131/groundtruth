import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET, OPTIONS } from "./route";

const get = (qs: string) => GET(new NextRequest(`http://localhost/api/economy/history?${qs}`));

// Only validation paths: anything that passes validation would call an upstream.
describe("history route validation", () => {
  it("unknown op lists the ops", async () => {
    const res = await get("op=nope");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/county \| us \| ic/);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
  it("county needs a five-digit FIPS", async () => {
    for (const fips of ["", "4845", "48453a", "US000"]) {
      const res = await get(`op=county&fips=${fips}`);
      expect(res.status).toBe(400);
    }
  });
  it("ic rejects malformed months", async () => {
    expect((await get("op=ic&asof=2024-13")).status).toBe(400);
    expect((await get("op=ic&from=2024")).status).toBe(400);
    expect((await get("op=ic&to=24-01")).status).toBe(400);
  });
  it("OPTIONS answers CORS preflight", () => {
    const res = OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-methods")).toContain("GET");
  });
});
