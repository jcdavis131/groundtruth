import { beforeAll, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classify, MATCHERS, plan, summarize, type CiteItem, type PublisherReply, type Verdict } from "./citeCheck";
import { createGate, fetchPublisher, inTable, MAX_REQUESTS, MIN_GAP_MS, sha256Hex, type Clock, type FetchLike } from "./fetch";
import { RECORD_HOSTS, SEC_USER_AGENT, USER_AGENT, recordIdOf, refusal, userAgentFor } from "./hosts";
import { runLive, runRecorded } from "./live";
import { listRecorded, recordedFor, toReply, type Recorded } from "./recorded";
import { WORLD_FIXTURES, worldItems } from "./worldItems";

// cite-check checks an item against the publisher's own record. These tests run it on the recorded publisher replies
// (lib/cite/__fixtures__/publisher, written by scripts/publisher-record.mjs) and on tampered copies of them.

let ITEMS: CiteItem[] = [];

/**
 * Sources with a matcher and no recorded publisher reply, and why. A source goes here only when the publisher would not
 * answer when the replies were recorded (2026-10-20); `node scripts/publisher-record.mjs --from-fixtures --per-source 4`
 * records them when it does, and the entry is then deleted. Its matcher is exercised on a hand-built body below instead,
 * which proves the code path and nothing about the publisher's real shape.
 */
const UNRECORDED: Record<string, string> = {
  "usace-nid": "geospatial.sec.usace.army.mil answered every record query with HTTP 200 and {\"error\":{\"code\":503,\"message\":\"Wait timeout for the request exceeded\"}} or a 60 to 280 s timeout on 2026-10-20 (the layer metadata page answered); tried again after review on 2026-10-20, same (HTTP 200 with a 500 or 503 error object, three different NIDIDs, 90 to 120 s timeout)",
};

beforeAll(async () => {
  const files = readdirSync(WORLD_FIXTURES).filter((f) => f.endsWith(".json")).sort();
  ITEMS = (await Promise.all(files.map((f) => worldItems(path.join(WORLD_FIXTURES, f))))).flat() as CiteItem[];
});

/** An item of this source (and fact, if given) whose record URL has a recorded reply that CONFIRMS it, with that reply. */
function confirmed(sourceId: string, fact?: RegExp): { item: CiteItem; rec: Recorded } {
  for (const item of ITEMS) {
    if (item.sourceId !== sourceId || !item.upstreamRecordUrl || (fact && !fact.test(item.fact))) continue;
    const rec = recordedFor(sourceId, item.upstreamRecordUrl);
    if (rec && classify(item, toReply(rec)).status === "CONFIRMED") return { item, rec };
  }
  throw new Error(`no ${sourceId} item ${fact ?? ""} is confirmed by a recorded reply`);
}

const reply = (rec: Recorded, body: string): PublisherReply => ({ status: 200, body, fetchedAt: rec.retrievedAt });
const stub = (status: number, body = ""): PublisherReply => ({ status, body, fetchedAt: "2026-10-20T00:00:00.000Z" });

/** Replace the first JSON value equal to `from` (anywhere in the tree) with `to`; the body re-serialised. */
function swapJson(body: string, from: string | number, to: string | number): string {
  let done = false;
  const walk = (v: unknown): unknown => {
    // a number the publisher sends as a string ("3", "148.199") matches too, and stays a string
    if (!done && (v === from || (typeof v === "string" && typeof from === "number" && v === String(from)))) {
      done = true;
      return typeof v === "string" ? String(to) : to;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  const out = JSON.stringify(walk(JSON.parse(body)));
  if (!done) throw new Error(`${String(from)} not found in the body`);
  return out;
}

/** The QCEW data row (own_code 0, industry_code 10) as cells, and the body with a cell of that row replaced. */
function qcewCell(body: string, col: string, to: string): string {
  const lines = body.split("\n");
  const head = lines[0].split(",").map((h) => h.replace(/"/g, ""));
  const i = head.indexOf(col);
  const li = lines.findIndex((l, n) => n > 0 && /^"\d+","0","10",/.test(l));
  const cells = lines[li].split(",");
  cells[i] = to;
  lines[li] = cells.join(",");
  return lines.join("\n");
}

describe("the verdicts, flipped one by one on recorded publisher replies", () => {
  it("CONFIRMED comes with the body's sha256", () => {
    const { item, rec } = confirmed("bls-qcew", /employment/);
    const v = classify(item, toReply(rec));
    expect(v.status).toBe("CONFIRMED");
    expect(v.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(v.sha256).toBe(rec.sha256);
    expect(v.publisherValue).toBe(item.value);
    expect(v.period).toBe("2026 Q1");
    expect(v.recordUrl).toBe(item.upstreamRecordUrl);
    expect(v.fetchedAt).toBe(rec.retrievedAt);
    // a reply that arrives without a hash gets one computed from its body
    const bare = classify(item, { status: 200, body: rec.body, fetchedAt: rec.retrievedAt });
    expect(bare.status).toBe("CONFIRMED");
    expect(bare.sha256).toBe(sha256Hex(rec.body));
  });

  it("1. a changed value is CONTRADICTED", () => {
    const { item, rec } = confirmed("bls-qcew", /employment/);
    const v = classify(item, reply(rec, qcewCell(rec.body, "month3_emplvl", String(Number(item.value) + 1000))));
    expect(v.status).toBe("CONTRADICTED");
    expect(v.reason).toMatch(/month3_emplvl/);
    expect(v.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("1b. every JSON-bodied matcher flips to CONTRADICTED when the publisher's compared value changes", () => {
    const flipped: string[] = [];
    for (const sourceId of Object.keys(MATCHERS)) {
      if (sourceId === "bls-qcew" || sourceId === "usdm" || sourceId in UNRECORDED) continue; // CSV: covered by their own cases; unrecorded: no reply to change
      const { item, rec } = confirmed(sourceId);
      const v = classify(item, toReply(rec));
      const pv = v.publisherValue;
      if (pv === null || pv === undefined || typeof pv === "boolean") continue;
      const bad = typeof pv === "number" ? pv + 1000 : `${pv} (changed)`;
      let body: string;
      try {
        body = swapJson(rec.body, pv, bad);
      } catch {
        continue; // a value the matcher derives (a status word, a joined list) is not a single field of the body
      }
      const mutated = classify(item, reply(rec, body));
      expect(["CONTRADICTED"], `${sourceId}: ${item.fact} with the publisher's value changed`).toContain(mutated.status);
      flipped.push(sourceId);
    }
    expect(flipped.length).toBeGreaterThanOrEqual(10);
  });

  it("2. a newer period or release is CHANGED_SINCE_RETRIEVAL, even where the value still agrees", () => {
    const q = confirmed("bls-qcew", /employment/);
    const vq = classify(q.item, reply(q.rec, qcewCell(q.rec.body, "qtr", '"2"')));
    expect(vq.status).toBe("CHANGED_SINCE_RETRIEVAL");
    expect(vq.period).toBe("2026 Q2");
    const n = confirmed("fema-nri", /overall risk rating/);
    const vn = classify(n.item, reply(n.rec, swapJson(n.rec.body, "December 2025", "June 2026")));
    expect(vn.status).toBe("CHANGED_SINCE_RETRIEVAL");
    expect(vn.period).toBe("June 2026");
  });

  it("3. the publisher's own suppression flag is NOT_PUBLISHED", () => {
    const q = confirmed("bls-qcew", /wage/);
    const vq = classify(q.item, reply(q.rec, qcewCell(q.rec.body, "disclosure_code", '"N"')));
    expect(vq.status).toBe("NOT_PUBLISHED");
    expect(vq.reason).toMatch(/disclosure_code N/);
    expect(vq.sha256).toMatch(/^[0-9a-f]{64}$/);
    const n = confirmed("fema-nri", /overall risk rating/);
    expect(classify(n.item, reply(n.rec, swapJson(n.rec.body, "Relatively High", "Insufficient Data"))).status).toBe("NOT_PUBLISHED");
    expect(classify(n.item, reply(n.rec, swapJson(n.rec.body, "Relatively High", "Data Unavailable"))).status).toBe("NOT_PUBLISHED");
  });

  it("4. HTTP 403, 429, 5xx, a timeout, an empty body and a renamed field are UNREACHABLE: unscored, never wrong", () => {
    const { item, rec } = confirmed("census-tigerweb", /^county$/);
    for (const s of [403, 429, 500, 503, 404]) {
      const v = classify(item, stub(s, "Access Denied"));
      expect(v.status, `HTTP ${s}`).toBe("UNREACHABLE");
      expect(v.sha256).toBeNull();
    }
    expect(classify(item, { status: 0, body: "", fetchedAt: "2026-10-20T00:00:00.000Z", error: "The operation was aborted due to timeout" }).status).toBe("UNREACHABLE");
    expect(classify(item, stub(200, "")).status).toBe("UNREACHABLE");
    expect(classify(item, stub(200, "<html>maintenance</html>")).status).toBe("UNREACHABLE");
    // the publisher renamed NAME: nothing to compare, so no verdict on the item, and certainly not CONFIRMED
    const renamed = classify(item, reply(rec, rec.body.replaceAll('"NAME"', '"FULLNAME"')));
    expect(renamed.status).toBe("UNREACHABLE");
    expect(renamed.reason).toMatch(/unreadable/);
    // ArcGIS reports a backend failure as HTTP 200 with an error object
    expect(classify(item, stub(200, '{"error":{"code":500,"message":"Error performing query operation","details":[]}}')).status).toBe("UNREACHABLE");
  });

  it("5. an item with no record URL is NO_RECORD_URL", () => {
    const { item } = confirmed("fema-nri", /overall risk rating/);
    const bare: CiteItem = { ...item };
    delete bare.upstreamRecordUrl;
    expect(classify(bare, stub(200, "{}")).status).toBe("NO_RECORD_URL");
    expect("refused" in plan(bare)).toBe(true);
    // every no-URL item the tool emits for these fixtures lands here, never anywhere else
    const noUrl = ITEMS.filter((i) => !i.upstreamRecordUrl);
    expect(noUrl.length).toBeGreaterThan(0);
    for (const i of noUrl) expect(classify(i, stub(200, "{}")).status).toBe("NO_RECORD_URL");
    // an NWS alert expires: its record cannot be re-fetched later, so it is not machine-verifiable either
    const alert = ITEMS.find((i) => i.fact === "NWS alert");
    if (alert) expect(classify(alert, stub(200, "{}")).status).toBe("NO_RECORD_URL");
  });

  it("6. a host not in the table is refused, and nothing is fetched", async () => {
    const { item } = confirmed("census-tigerweb", /^county$/);
    const offTable: CiteItem[] = [
      { ...item, upstreamRecordUrl: "https://example.com/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/82/query?where=GEOID%3D'48453'" },
      { ...item, upstreamRecordUrl: "https://tigerweb.geo.census.gov.evil.example/arcgis/rest/services/x/GEOID%3D'48453'" },
      { ...item, sourceId: "made-up-source" },
      { ...item, sourceId: "zillow-zhvi", upstreamRecordUrl: "https://www.zillow.com/research/data/" },
    ];
    for (const o of offTable) {
      expect("refused" in plan(o), o.upstreamRecordUrl).toBe(true);
      expect(classify(o, toReply(recordedFor("census-tigerweb", item.upstreamRecordUrl as string) as Recorded)).status).toBe("REFUSED");
    }
    const calls: string[] = [];
    const clock = fakeClock();
    const r = await runLive(offTable, { fetchImpl: async (u) => (calls.push(u), emptyOk()), clock, gate: createGate(clock) });
    expect(calls).toEqual([]);
    expect(r.requests).toBe(0);
    expect(r.summary.byStatus.REFUSED).toBe(offTable.length);
    await expect(fetchPublisher("https://example.com/x", { fetchImpl: async (u) => (calls.push(u), emptyOk()), clock, gate: createGate(clock) })).rejects.toThrow(/not in the host table/);
    expect(calls).toEqual([]);
    expect(inTable("https://example.com/x")).toBe(false);
  });

  it("7. an id the item names but the record URL lacks is refused, and nothing is fetched", async () => {
    const wrongId: CiteItem[] = [];
    for (const [src, fact] of [["census-tigerweb", /^county$/], ["fema-openfema", /^FEMA declaration$/], ["cms-provider-data", /./], ["epa-ucmr5-pat", /highest/], ["sec-edgar", /./], ["bls-qcew", /employment/], ["usdm", /./]] as const) {
      const { item } = confirmed(src, fact);
      expect(plan(item), `${src} baseline plan`).toHaveProperty("url");
      wrongId.push({ ...item, code: item.code ? item.code.slice(0, -1) + (item.code.endsWith("9") ? "8" : "9") : item.code, period: src === "bls-qcew" ? "2025 Q4" : src === "usdm" ? "2026-09-01" : item.period });
    }
    for (const o of wrongId) {
      const p = plan(o);
      expect("refused" in p, `${o.sourceId} ${o.code} ${o.period}`).toBe(true);
      if ("refused" in p) expect(p.refused).toMatch(/does not name/);
    }
    const calls: string[] = [];
    const clock = fakeClock();
    const r = await runLive(wrongId, { fetchImpl: async (u) => (calls.push(u), emptyOk()), clock, gate: createGate(clock) });
    expect(calls).toEqual([]);
    expect(r.summary.byStatus.REFUSED).toBe(wrongId.length);
  });

  it("8. a difference beyond the declared tolerance is CONTRADICTED; within it, CONFIRMED", () => {
    // average weekly wage: whole USD, so the tolerance is 0.5 (the item rounds)
    const w = confirmed("bls-qcew", /wage/);
    const wageCsv = (to: string) => reply(w.rec, qcewCell(w.rec.body, "avg_wkly_wage", to));
    expect(classify(w.item, wageCsv(String(Number(w.item.value) + 0.4))).status).toBe("CONFIRMED");
    expect(classify(w.item, wageCsv(String(Number(w.item.value) - 0.4))).status).toBe("CONFIRMED");
    expect(classify(w.item, wageCsv(String(Number(w.item.value) + 0.6))).status).toBe("CONTRADICTED");
    expect(classify(w.item, wageCsv(String(Number(w.item.value) + 1))).status).toBe("CONTRADICTED");
    // employment is a count: tolerance 0
    const e = confirmed("bls-qcew", /employment/);
    expect(classify(e.item, reply(e.rec, qcewCell(e.rec.body, "month3_emplvl", String(Number(e.item.value) + 1)))).status).toBe("CONTRADICTED");
    // elevation: tolerance 1 m
    const el = confirmed("usgs-epqs");
    const at = (m: number) => reply(el.rec, JSON.stringify({ location: {}, value: String(m) }));
    expect(classify(el.item, at(Number(el.item.value) + 0.9)).status).toBe("CONFIRMED");
    expect(classify(el.item, at(Number(el.item.value) + 1.1)).status).toBe("CONTRADICTED");
    // expected annual loss: whole USD (0.5)
    const eal = confirmed("fema-nri", /expected annual loss/);
    const pub = classify(eal.item, toReply(eal.rec)).publisherValue as number;
    const alt = (d: number) => reply(eal.rec, swapJson(eal.rec.body, pub, Number(eal.item.value) + d));
    expect(classify(eal.item, alt(0.4)).status).toBe("CONFIRMED");
    expect(classify(eal.item, alt(0.7)).status).toBe("CONTRADICTED");
    // a code is exact: one digit off is a different record
    const t = confirmed("census-tigerweb", /^county$/);
    expect(classify(t.item, reply(t.rec, swapJson(t.rec.body, t.item.code as string, `${t.item.code}0`))).status).toBe("CONTRADICTED");
    // drought shares: 0.1 percentage point
    const d = confirmed("usdm");
    const usdmRow = d.rec.body.split("\n");
    const cells = usdmRow[1].split(",");
    const head = usdmRow[0].split(",");
    const bump = (cls: string, by: number) => {
      const c = [...cells];
      c[head.indexOf(cls)] = (Number(c[head.indexOf(cls)]) + by).toFixed(2);
      return reply(d.rec, [usdmRow[0], c.join(","), ...usdmRow.slice(2)].join("\n"));
    };
    expect(classify(d.item, bump("D1", 0.09)).status).toBe("CONFIRMED");
    expect(classify(d.item, bump("D1", 0.5)).status).toBe("CONTRADICTED");
  });

  it("a record that does not exist at the publisher is CONTRADICTED, not unscored", () => {
    const { item, rec } = confirmed("census-tigerweb", /^county$/);
    const none = swapJson(rec.body, "Travis County", "x");
    const empty = JSON.stringify({ ...JSON.parse(none), features: [] });
    expect(classify(item, reply(rec, empty)).status).toBe("CONTRADICTED");
  });
});

describe("a batch", () => {
  it("UNREACHABLE, NO_RECORD_URL and REFUSED never enter the confirmed or wrong totals", () => {
    const a = confirmed("census-tigerweb", /^county$/);
    const b = confirmed("bls-qcew", /employment/);
    const bare: CiteItem = { ...a.item };
    delete bare.upstreamRecordUrl;
    const verdicts: Verdict[] = [
      classify(a.item, toReply(a.rec)), // CONFIRMED
      classify(b.item, reply(b.rec, qcewCell(b.rec.body, "month3_emplvl", "1"))), // CONTRADICTED
      classify(b.item, reply(b.rec, qcewCell(b.rec.body, "disclosure_code", '"N"'))), // NOT_PUBLISHED
      classify(a.item, stub(403)), // UNREACHABLE
      classify(a.item, stub(429)), // UNREACHABLE
      classify(a.item, stub(503)), // UNREACHABLE
      classify(bare, stub(200, "{}")), // NO_RECORD_URL
      classify({ ...a.item, sourceId: "made-up-source" }, stub(200, "{}")), // REFUSED
    ];
    const s = summarize(verdicts);
    expect(s.total).toBe(8);
    expect(s.byStatus).toMatchObject({ CONFIRMED: 1, CONTRADICTED: 1, NOT_PUBLISHED: 1, UNREACHABLE: 3, NO_RECORD_URL: 1, REFUSED: 1, CHANGED_SINCE_RETRIEVAL: 0 });
    expect(s.confirmed).toBe(1);
    expect(s.wrong).toBe(1);
    expect(s.scored).toBe(3);
    expect(s.unscored).toBe(5);
    expect(s.confirmed + s.wrong + s.unscored + s.byStatus.NOT_PUBLISHED + s.byStatus.CHANGED_SINCE_RETRIEVAL).toBe(s.total);
    // blocking the whole batch moves nothing into wrong
    const blocked = summarize([a.item, b.item, a.item].map((i) => classify(i, stub(403))));
    expect(blocked.wrong).toBe(0);
    expect(blocked.confirmed).toBe(0);
    expect(blocked.unscored).toBe(3);
  });

  it("never reports CONFIRMED without a sha256 (replies checked as a set)", () => {
    const { verdicts } = runRecorded(ITEMS);
    const ok = verdicts.filter((v) => v.status === "CONFIRMED");
    expect(ok.length).toBeGreaterThan(30);
    for (const v of ok) expect(v.sha256, `${v.sourceId} ${v.fact}`).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("what the recorded fixtures cover", () => {
  it("every host a world fixture cites in upstreamRecordUrl has a matcher, and is in the host table", () => {
    const cited = new Set(ITEMS.filter((i) => i.upstreamRecordUrl).map((i) => i.sourceId));
    expect(cited.size).toBeGreaterThanOrEqual(15);
    for (const s of cited) {
      expect(RECORD_HOSTS[s], `${s}: a host in hosts.ts`).toBeDefined();
      expect(MATCHERS[s], `${s}: a matcher in lib/cite/matchers`).toBeDefined();
    }
    for (const i of ITEMS) {
      if (!i.upstreamRecordUrl || i.fact === "NWS alert") continue;
      expect(refusal(i), `${i.sourceId} | ${i.fact}: the plan does not refuse a URL the tool itself wrote`).toBeNull();
    }
  });

  it("every matcher has at least two recorded publisher records", () => {
    for (const s of Object.keys(MATCHERS)) {
      if (s in UNRECORDED) expect(listRecorded(s).length, `${s}: listed as unrecorded, so it has none (delete its entry once it does)`).toBe(0);
      else expect(listRecorded(s).length, `${s}: recorded replies`).toBeGreaterThanOrEqual(2);
    }
  });

  it("every recorded reply carries its URL, retrievedAt and the body's sha256, and sits on its source's host", () => {
    const all = listRecorded();
    expect(all.length).toBeGreaterThanOrEqual(2 * (Object.keys(MATCHERS).length - Object.keys(UNRECORDED).length));
    for (const r of all) {
      const where = `${r.sourceId}/${r.recordId}`;
      expect(r.status, where).toBe(200);
      expect(RECORD_HOSTS[r.sourceId], where).toBeDefined();
      expect(r.url, where).toMatch(RECORD_HOSTS[r.sourceId]);
      expect(r.retrievedAt, where).toMatch(/^2026-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
      expect(r.sha256, where).toMatch(/^[0-9a-f]{64}$/);
      expect(r.recordId, where).toBe(recordIdOf(r.sourceId, r.url));
      if (r.trimmed === null) {
        expect(sha256Hex(r.body), `${where}: the header hash is the body's`).toBe(r.sha256);
        expect(Buffer.byteLength(r.body, "utf8"), where).toBe(r.bytes);
      } else {
        expect(r.bytes, `${where}: a trimmed body is smaller than what was received`).toBeGreaterThan(Buffer.byteLength(r.body, "utf8"));
        expect(r.trimmed.length, where).toBeGreaterThan(5);
      }
    }
  });

  it("the recorded replies, read by their matchers, are never unreadable and never refused", () => {
    const { verdicts } = runRecorded(ITEMS);
    const bad = verdicts.filter((v) => v.status === "UNREACHABLE" || v.status === "REFUSED");
    expect(bad.map((v) => `${v.status} ${v.sourceId} | ${v.fact}: ${v.reason}`)).toEqual([]);
  });
});

describe("a matcher with no recorded reply, on a hand-built body (not a publisher record)", () => {
  // Field names are the ones the record URL asks the NID layer for (outFields); the values are made up for this test.
  const body = (over: Record<string, unknown> = {}) =>
    JSON.stringify({ features: [{ attributes: { NIDID: "XX00001", NAME: "Test Dam", PRIMARY_OWNER_TYPE: "Local Government", OWNER_TYPES: "Local Government", HAZARD_POTENTIAL: "High", CONDITION_ASSESSMENT: "Fair", YEAR_COMPLETED: 1960, ...over } }] });
  const item: CiteItem = {
    fact: "dam",
    value: "Test Dam",
    code: "nid:XX00001",
    note: "hazard potential High; condition Fair; completed 1960; owner type Local Government; within 0.1 degrees of the point",
    sourceId: "usace-nid",
    upstreamRecordUrl: "https://geospatial.sec.usace.army.mil/dls/rest/services/NID/National_Inventory_of_Dams_Public_Service/FeatureServer/0/query?where=NIDID%3D'XX00001'&outFields=NIDID,NAME,PRIMARY_OWNER_TYPE,OWNER_TYPES,HAZARD_POTENTIAL,CONDITION_ASSESSMENT,YEAR_COMPLETED&returnGeometry=false&f=json",
    retrievedAt: "2026-10-19T00:00:00.000Z",
  };
  const r = (b: string): PublisherReply => ({ status: 200, body: b, fetchedAt: "2026-10-20T00:00:00.000Z" });

  it("confirms, contradicts and reads an ArcGIS error as unscored", () => {
    expect(classify(item, r(body())).status).toBe("CONFIRMED");
    expect(classify(item, r(body({ HAZARD_POTENTIAL: "Low" }))).status).toBe("CONTRADICTED");
    expect(classify(item, r(body({ YEAR_COMPLETED: 1961 }))).status).toBe("CONTRADICTED");
    expect(classify(item, r('{"error":{"code":503,"message":"Wait timeout for the request exceeded","details":[]}}')).status).toBe("UNREACHABLE");
    expect(classify(item, r('{"features":[]}')).status).toBe("CONTRADICTED");
  });

  it("a private dam labelled by id (null name, no NAME asked for) is compared on its other fields", () => {
    const priv: CiteItem = { ...item, value: null, upstreamRecordUrl: (item.upstreamRecordUrl as string).replace("NIDID,NAME,", "NIDID,") };
    const noName = JSON.stringify({ features: [{ attributes: { NIDID: "XX00001", PRIMARY_OWNER_TYPE: "Local Government", OWNER_TYPES: "Local Government", HAZARD_POTENTIAL: "High", CONDITION_ASSESSMENT: "Fair", YEAR_COMPLETED: 1960 } }] });
    expect(classify(priv, r(noName)).status).toBe("CONFIRMED");
  });
});

/** A fake clock whose sleep advances time instead of waiting. */
function fakeClock(start = Date.parse("2026-10-20T12:00:00Z")): Clock & { t: number } {
  const c = {
    t: start,
    now: () => c.t,
    sleep: async (ms: number) => {
      c.t += ms;
    },
  };
  return c;
}

const emptyOk = () => ({ status: 200, headers: { get: () => null }, text: async () => '{"features":[]}' });

describe("the fetch layer", () => {
  it("keeps one request a second per host, fetches only table URLs, and sends no token-shaped User-Agent", async () => {
    const clock = fakeClock();
    const calls: Array<{ url: string; host: string; at: number; ua: string }> = [];
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push({ url, host: new URL(url).host, at: clock.t, ua: init.headers["user-agent"] });
      return emptyOk();
    };
    const items = ITEMS.filter((i) => i.upstreamRecordUrl && !("refused" in plan(i)));
    const r = await runLive(items, { fetchImpl, clock, gate: createGate(clock) });
    expect(calls.length).toBeGreaterThan(30);
    expect(r.requests).toBe(calls.length);
    expect(new Set(calls.map((c) => c.url)).size, "one request per unique record URL").toBe(calls.length);
    // per host: at least MIN_GAP_MS between two requests
    const byHost = new Map<string, number[]>();
    for (const c of calls) byHost.set(c.host, [...(byHost.get(c.host) ?? []), c.at]);
    expect(byHost.size).toBeGreaterThanOrEqual(8);
    for (const [host, times] of byHost) for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1], `${host} request ${i}`).toBeGreaterThanOrEqual(MIN_GAP_MS);
    // never outside the table
    for (const c of calls) expect(inTable(c.url), c.url).toBe(true);
    // the accepted User-Agent per host, none carrying a token-shaped string
    const tokenShaped = /github|gh[pousr]_[A-Za-z0-9]{16,}|xox[abprs]-|sk-[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{12,}|bearer|curl|[A-Za-z0-9+/_-]{32,}/i;
    for (const c of calls) {
      expect(c.ua, c.url).not.toMatch(tokenShaped);
      expect(c.ua, c.url).toBe(c.host.endsWith("sec.gov") ? SEC_USER_AGENT : USER_AGENT);
    }
    expect(calls.some((c) => c.host === "data.sec.gov")).toBe(true);
    expect(userAgentFor("https://data.bls.gov/cew/x")).toBe(USER_AGENT);
    expect(userAgentFor("https://data.bls.gov/cew/x")).not.toMatch(/github|contact/);
  });

  it("two requests to one host are a second apart even when they are asked for together", async () => {
    vi.useFakeTimers();
    try {
      const clock: Clock = { now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };
      const gate = createGate(clock);
      const stamps: number[] = [];
      const all = Promise.all([1, 2, 3, 4].map(async () => (await gate("data.bls.gov"), stamps.push(Date.now()))));
      // another host does not wait behind them
      const other: number[] = [];
      const o = gate("tigerweb.geo.census.gov").then(() => other.push(Date.now()));
      const t0 = Date.now();
      await vi.advanceTimersByTimeAsync(5000);
      await Promise.all([all, o]);
      expect(stamps.length).toBe(4);
      for (let i = 1; i < stamps.length; i++) expect(stamps[i] - stamps[i - 1]).toBeGreaterThanOrEqual(MIN_GAP_MS);
      expect(other[0]).toBe(t0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops at the request cap: the rest are UNREACHABLE (unscored), never wrong", async () => {
    expect(MAX_REQUESTS).toBe(400);
    const clock = fakeClock();
    let n = 0;
    const items = ITEMS.filter((i) => i.upstreamRecordUrl && !("refused" in plan(i)));
    const refused403 = async () => (n++, { status: 403, headers: { get: () => null }, text: async () => "Access Denied" });
    const r = await runLive(items, { fetchImpl: refused403, clock, gate: createGate(clock), maxRequests: 5 });
    expect(n).toBe(5);
    expect(r.requests).toBe(5);
    expect(r.summary.byStatus.UNREACHABLE).toBeGreaterThan(10);
    expect(r.verdicts.some((v) => /request cap \(5\) reached/.test(v.reason))).toBe(true);
    expect(r.summary.wrong).toBe(0);
  });

  it("does not follow a redirect to a URL outside the table", async () => {
    const clock = fakeClock();
    const seen: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      seen.push(url);
      return { status: 302, headers: { get: (h: string) => (h === "location" ? "https://example.com/elsewhere" : null) }, text: async () => "" };
    };
    const { item } = confirmed("census-tigerweb", /^county$/);
    const out = await fetchPublisher(item.upstreamRecordUrl as string, { fetchImpl, clock, gate: createGate(clock) });
    expect(seen).toEqual([item.upstreamRecordUrl]);
    expect(out.status).toBe(302);
    expect(out.error).toMatch(/outside the host table/);
    expect(out.sha256).toBeUndefined();
  });

  it("reports a network failure as status 0, never throws", async () => {
    const clock = fakeClock();
    const { item } = confirmed("census-tigerweb", /^county$/);
    const out = await fetchPublisher(item.upstreamRecordUrl as string, {
      fetchImpl: async () => {
        throw new Error("fetch failed");
      },
      clock,
      gate: createGate(clock),
    });
    expect(out.status).toBe(0);
    expect(out.error).toBe("fetch failed");
  });

  it("the User-Agent strings are the ones the app already sends", () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const ua = readFileSync(path.join(root, "server", "ua.ts"), "utf8");
    const edgar = readFileSync(path.join(root, "companies", "edgar.ts"), "utf8");
    expect(ua).toContain(`export const USER_AGENT = ${JSON.stringify(USER_AGENT)};`);
    expect(edgar).toContain(`export const SEC_USER_AGENT = ${JSON.stringify(SEC_USER_AGENT)};`);
  });
});
