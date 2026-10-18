import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { buildPayload, checkWebhookUrl, dispatch, ipv6Hextets, isPrivateHost, isPrivateIpv4, isPrivateIpv6, sampleEvent, sign, verify } from "./webhook";

describe("URL guard", () => {
  const blocked = [
    "http://example.com/hook",
    "ftp://example.com/",
    "https://localhost/hook",
    "https://LOCALHOST:8443/hook",
    "https://foo.localhost/",
    "https://printer.local/",
    "https://db.internal/",
    "https://svc.home.arpa/",
    "https://127.0.0.1/",
    "https://127.1.2.3/",
    "https://10.0.0.5/",
    "https://172.16.0.1/",
    "https://172.31.255.254/",
    "https://192.168.1.1/",
    "https://169.254.169.254/latest/meta-data",
    "https://100.64.1.1/",
    "https://0.0.0.0/",
    "https://224.0.0.1/",
    "https://255.255.255.255/",
    "https://198.18.0.1/",
    "https://2130706433/", // 127.0.0.1 as a decimal
    "https://0x7f000001/",
    "https://0177.0.0.1/",
    "https://[::1]/",
    "https://[::]/",
    "https://[fc00::1]/",
    "https://[fd12:3456::1]/",
    "https://[fe80::1]/",
    "https://[::ffff:127.0.0.1]/",
    "https://[::ffff:10.0.0.1]/",
    "https://[64:ff9b::a00:1]/",
    "https://metadata.google.internal/",
    "https://intranet/",
    "https://user:pw@example.com/hook",
    "not a url",
    "",
  ];
  const allowed = ["https://example.com/hook", "https://hooks.example.org:8443/a/b?c=d", "https://8.8.8.8/", "https://[2606:4700::1111]/", "https://172.32.0.1/", "https://11.0.0.1/", "https://192.169.0.1/"];

  it.each(blocked)("blocks %s", (u) => {
    expect(checkWebhookUrl(u).ok).toBe(false);
  });
  it.each(allowed)("allows %s", (u) => {
    expect(checkWebhookUrl(u).ok).toBe(true);
  });
  it("gives reasons", () => {
    const r = checkWebhookUrl("http://example.com");
    expect(!r.ok && r.reason).toMatch(/https/);
    const p = checkWebhookUrl("https://10.1.1.1/");
    expect(!p.ok && p.reason).toMatch(/private/);
    expect(checkWebhookUrl("https://example.com/" + "a".repeat(3000)).ok).toBe(false);
  });
  it("helpers", () => {
    expect(isPrivateIpv4([172, 15, 0, 1])).toBe(false);
    expect(isPrivateIpv4([172, 16, 0, 1])).toBe(true);
    expect(ipv6Hextets("::1")).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(ipv6Hextets("2001:db8::8:800:200c:417a")).toEqual([0x2001, 0xdb8, 0, 0, 8, 0x800, 0x200c, 0x417a]);
    expect(ipv6Hextets("::ffff:192.168.0.1")).toEqual([0, 0, 0, 0, 0, 0xffff, 0xc0a8, 1]);
    expect(ipv6Hextets("1::2::3")).toBeNull();
    expect(ipv6Hextets("1:2:3:4:5:6:7:8:9")).toBeNull();
    expect(isPrivateIpv6([0x2001, 0xdb8, 0, 0, 0, 0, 0, 1])).toBe(true);
    expect(isPrivateHost("example.com.")).toBe(false);
    expect(isPrivateHost("[zzz]")).toBe(true);
  });
});

describe("signing", () => {
  it("HMAC-SHA256 hex with the sha256= prefix, verifiable in constant time", () => {
    const body = '{"a":1}';
    const sig = sign(body, "topsecret");
    expect(sig).toBe("sha256=" + createHmac("sha256", "topsecret").update(body).digest("hex"));
    expect(verify(body, "topsecret", sig)).toBe(true);
    expect(verify(body, "topsecret", " " + sig + " ")).toBe(true);
    expect(verify(body, "wrong", sig)).toBe(false);
    expect(verify(body + " ", "topsecret", sig)).toBe(false);
    expect(verify(body, "topsecret", null)).toBe(false);
    expect(verify(body, "topsecret", "sha256=short")).toBe(false);
  });
  it("payload shape", () => {
    const p = buildPayload([sampleEvent(0)], { watchlistId: "w", title: "T", sample: true }, "2026-01-01T00:00:00.000Z");
    expect(p).toMatchObject({ type: "gev.watch.events", watchlistId: "w", title: "T", sample: true, generatedAt: "2026-01-01T00:00:00.000Z" });
    expect(p.events[0].firedAt).toBe("1970-01-01T00:00:00.000Z");
  });
});

interface Call {
  url: string;
  init: RequestInit;
}

function fakeFetch(script: Array<(call: Call) => Response | Error>): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} };
    calls.push(call);
    const step = script[Math.min(calls.length - 1, script.length - 1)];
    const out = step(call);
    if (out instanceof Error) throw out;
    return out;
  }) as typeof fetch;
  return { fetch: f, calls };
}

const base = { secret: "s3cret-s3cret", watchlistId: "w", title: "W", now: () => 1_700_000_000_000 };

describe("dispatch", () => {
  it("POSTs signed JSON once on 2xx, with redirect:manual and a timeout signal", async () => {
    const { fetch, calls } = fakeFetch([() => new Response(null, { status: 204 })]);
    const r = await dispatch([sampleEvent(0)], { ...base, url: "https://example.com/hook", fetchImpl: fetch });
    expect(r).toEqual({ ok: true, status: 204, attempts: 1, deliveredTo: "https://example.com/hook", error: undefined });
    expect(calls).toHaveLength(1);
    const { init } = calls[0];
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("manual");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const headers = init.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
    expect(headers["x-gev-timestamp"]).toBe("2023-11-14T22:13:20.000Z");
    expect(verify(String(init.body), base.secret, headers["x-gev-signature"])).toBe(true);
    const body = JSON.parse(String(init.body));
    expect(body.type).toBe("gev.watch.events");
    expect(body.events).toHaveLength(1);
  });

  it("refuses unsafe URLs and weak secrets without calling fetch", async () => {
    const { fetch, calls } = fakeFetch([() => new Response("", { status: 200 })]);
    const a = await dispatch([], { ...base, url: "https://10.0.0.1/", fetchImpl: fetch });
    expect(a.ok).toBe(false);
    expect(a.error).toMatch(/private/);
    const b = await dispatch([], { ...base, secret: "short", url: "https://example.com/", fetchImpl: fetch });
    expect(b.error).toMatch(/secret/);
    expect(calls).toHaveLength(0);
  });

  it("retries once after a network error, then gives up", async () => {
    const { fetch, calls } = fakeFetch([() => new Error("ECONNRESET")]);
    const r = await dispatch([], { ...base, url: "https://example.com/", fetchImpl: fetch });
    expect(r.ok).toBe(false);
    expect(r.attempts).toBe(2);
    expect(r.error).toBe("ECONNRESET");
    expect(calls).toHaveLength(2);
  });

  it("retries once after a 5xx and succeeds", async () => {
    const { fetch } = fakeFetch([() => new Response("", { status: 503 }), () => new Response("", { status: 200 })]);
    const r = await dispatch([], { ...base, url: "https://example.com/", fetchImpl: fetch });
    expect(r).toMatchObject({ ok: true, status: 200, attempts: 2 });
  });

  it("does not retry a 4xx", async () => {
    const { fetch, calls } = fakeFetch([() => new Response("", { status: 401 })]);
    const r = await dispatch([], { ...base, url: "https://example.com/", fetchImpl: fetch });
    expect(r).toMatchObject({ ok: false, status: 401, attempts: 1 });
    expect(r.error).toMatch(/401/);
    expect(calls).toHaveLength(1);
  });

  it("follows one https redirect to a public host, re-posting the same signed body", async () => {
    const { fetch, calls } = fakeFetch([() => new Response("", { status: 307, headers: { location: "/v2/hook" } }), () => new Response("", { status: 200 })]);
    const r = await dispatch([], { ...base, url: "https://example.com/hook", fetchImpl: fetch });
    expect(r).toMatchObject({ ok: true, attempts: 2, deliveredTo: "https://example.com/v2/hook" });
    expect(calls[1].init.body).toBe(calls[0].init.body);
  });

  it("refuses redirects to http, to private hosts, and a second redirect", async () => {
    const http = fakeFetch([() => new Response("", { status: 302, headers: { location: "http://example.com/x" } })]);
    expect((await dispatch([], { ...base, url: "https://example.com/", fetchImpl: http.fetch })).error).toMatch(/redirect refused: url must use https/);
    const priv = fakeFetch([() => new Response("", { status: 302, headers: { location: "https://169.254.169.254/" } })]);
    expect((await dispatch([], { ...base, url: "https://example.com/", fetchImpl: priv.fetch })).error).toMatch(/redirect refused/);
    const twice = fakeFetch([() => new Response("", { status: 302, headers: { location: "https://example.org/" } }), () => new Response("", { status: 302, headers: { location: "https://example.net/" } })]);
    const r = await dispatch([], { ...base, url: "https://example.com/", fetchImpl: twice.fetch });
    expect(r.error).toMatch(/only one redirect/);
    expect(twice.calls).toHaveLength(2);
  });

  it("reports a timeout", async () => {
    const f = (async (_u: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      })) as typeof fetch;
    const r = await dispatch([], { ...base, url: "https://example.com/", fetchImpl: f, timeoutMs: 1000 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/timed out after 1000 ms/);
    expect(r.attempts).toBe(2);
  }, 10_000);
});
