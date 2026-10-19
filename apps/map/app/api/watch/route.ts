// Watchlist API: evaluate a list against the public sources and answer as a
// feed, JSON, or a signed webhook. Stateless by design: the list travels in
// the URL as a compact token, so no account, key or database is needed.
//
//   GET  /api/watch?t=<token>&format=rss|atom|json|jsonfeed   evaluate + render
//   GET  /api/watch?id=<id>&format=...                        same, for a published list
//   GET  /api/watch?op=metrics                                metric ids per item kind
//   POST /api/watch            { watchlist }                  validate, mint the token,
//                                                             store when a KV is on
//   POST /api/watch?op=test-webhook  { url, secret }          signed sample payload
//   POST /api/watch?op=dispatch      { token|id, url, secret } evaluate and deliver
//
// POST ops that send traffic elsewhere need the `x-gev-cron-secret` header to
// match GEV_CRON_SECRET (404 when the operator has not set one), so a public
// deployment cannot be used to spray requests at third parties.
//
// Evaluation is cached 5 minutes per token, which also bounds how often the
// upstream tables are re-read on behalf of feed readers that poll too keenly.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { cached } from "@/lib/server/cache";
import { cacheControl } from "@/lib/server/respond";
import type { Provenance } from "@/lib/provenance/types";
import { evaluate, type Evaluation, type WatchState } from "@/lib/watch/evaluate";
import { renderAtom, renderJsonFeed, renderRss, type FeedInput } from "@/lib/watch/feed";
import { defaultFetchers } from "@/lib/watch/fetchers";
import { defaultKv, type KeyValueStore } from "@/lib/watch/kv";
import { ID_RE, LIMITS, METRICS_BY_KIND, setTokenCodec, validateWatchlist, type RuleWindow, type Watchlist } from "@/lib/watch/model";
import { collectProvenance, resolveAll, type ResolveResult } from "@/lib/watch/resolve";
import { decodeTokenSync, encodeTokenSync, nodeCodec } from "@/lib/watch/token-node";
import { dispatch, sampleEvent } from "@/lib/watch/webhook";

export const maxDuration = 60;

setTokenCodec(nodeCodec);

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, x-gev-cron-secret",
} as const;

const EVAL_TTL_MS = 5 * 60_000;
const STATE_TTL_MS = 30 * 86_400_000;
const MAX_BODY_BYTES = 64 * 1024;
const FORMATS = ["rss", "atom", "json", "jsonfeed"] as const;
type Format = (typeof FORMATS)[number];

function json(body: Record<string, unknown>, status = 200, ttlS = 0) {
  return NextResponse.json(body, { status, headers: { ...CORS, "cache-control": cacheControl(ttlS) } });
}

function bad(message: string, details?: unknown, status = 400) {
  const body: Record<string, unknown> = { error: message };
  if (details !== undefined) body.details = details;
  return json(body, status);
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

/** Public origin for permalinks: the operator's override, else what the request says. */
function originOf(req: NextRequest): string {
  return (process.env.GEV_PUBLIC_ORIGIN || req.nextUrl.origin).replace(/\/$/, "");
}

function feedUrls(origin: string, token: string) {
  const base = `${origin}/api/watch?t=${encodeURIComponent(token)}`;
  return { rss: `${base}&format=rss`, atom: `${base}&format=atom`, json: `${base}&format=json`, jsonfeed: `${base}&format=jsonfeed` };
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 32);
}

function cronSecretOk(req: NextRequest): "unset" | "bad" | "ok" {
  const want = process.env.GEV_CRON_SECRET?.trim();
  if (!want) return "unset";
  const got = (req.headers.get("x-gev-cron-secret") ?? "").trim();
  const a = Buffer.from(want);
  const b = Buffer.from(got);
  return a.length === b.length && timingSafeEqual(a, b) ? "ok" : "bad";
}

async function readJsonBody(req: NextRequest): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; error: string }> {
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return { ok: false, error: `body larger than ${MAX_BODY_BYTES} bytes` };
  try {
    const parsed: unknown = JSON.parse(text || "{}");
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { ok: false, error: "body must be a JSON object" };
    return { ok: true, body: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, error: "body is not JSON" };
  }
}

// ---------------------------------------------------------------- stored lists and state

interface StoredList {
  token: string;
  storedAt: string;
}

async function loadStored(kv: KeyValueStore | null, id: string): Promise<StoredList | null> {
  if (!kv || !ID_RE.test(id)) return null;
  const raw = await kv.get(`watch:${id}`).catch(() => null);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredList;
  } catch {
    return null;
  }
}

/** State is keyed by list id + token hash: an edited list starts fresh, and a stranger's token cannot pollute a published one. */
function stateKey(wl: Watchlist, token: string): string {
  return `watchstate:${wl.id}:${tokenHash(token).slice(0, 16)}`;
}

async function loadState(kv: KeyValueStore | null, key: string): Promise<WatchState | null> {
  if (!kv) return null;
  const raw = await kv.get(key).catch(() => null);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as WatchState;
    return s && s.version === 1 && s.values ? s : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- evaluation

interface EvalResult {
  watchlist: Watchlist;
  results: ResolveResult[];
  evaluation: Evaluation;
  provenance: Provenance[];
  generatedAt: string;
  stateful: boolean;
}

async function evaluateToken(token: string, wl: Watchlist, origin: string): Promise<{ value: EvalResult; age: number }> {
  const key = "watch:eval:" + tokenHash(token);
  const r = await cached(key, EVAL_TTL_MS, async () => {
    const now = Date.now();
    // The longest window any rule asks for decides the series look-back.
    const windows = wl.rules.map((r) => r.window).filter((w): w is RuleWindow => !!w);
    const window: RuleWindow | undefined = windows.includes("30d") ? "30d" : windows.includes("7d") ? "7d" : windows[0];
    const results = await resolveAll(wl.items, { origin, now, window, fetchers: defaultFetchers });
    const kv = defaultKv();
    const sk = stateKey(wl, token);
    const prev = await loadState(kv, sk);
    const evaluation = evaluate(wl, results, prev, now);
    let stateful = false;
    if (kv) {
      try {
        await kv.set(sk, JSON.stringify(evaluation.state), { ttlMs: STATE_TTL_MS });
        stateful = true;
      } catch {
        evaluation.caveats.push("State could not be written (read-only file system?); crossings are evaluated statelessly.");
      }
    }
    return { watchlist: wl, results, evaluation, provenance: collectProvenance(results), generatedAt: new Date(now).toISOString(), stateful };
  });
  return { value: r.value, age: r.age };
}

function render(format: Format, ev: EvalResult, origin: string, token: string, cacheAge: number) {
  const urls = feedUrls(origin, token);
  const input: FeedInput = { watchlist: ev.watchlist, results: ev.results, evaluation: ev.evaluation, selfUrl: urls[format === "jsonfeed" ? "jsonfeed" : format === "json" ? "json" : format], homeUrl: `${origin}/`, generatedAt: ev.generatedAt };
  const headers = { ...CORS, "cache-control": cacheControl(300) };
  switch (format) {
    case "rss":
      return new Response(renderRss(input), { headers: { ...headers, "content-type": "application/rss+xml; charset=utf-8" } });
    case "atom":
      return new Response(renderAtom(input), { headers: { ...headers, "content-type": "application/atom+xml; charset=utf-8" } });
    case "jsonfeed":
      return NextResponse.json(renderJsonFeed(input), { headers: { ...headers, "content-type": "application/feed+json; charset=utf-8" } });
    case "json":
    default:
      return NextResponse.json(
        {
          id: ev.watchlist.id,
          stateful: ev.stateful,
          cacheAge,
          urls,
          data: {
            watchlist: ev.watchlist,
            items: ev.results,
            events: ev.evaluation.events,
            checked: ev.evaluation.checked,
            skipped: ev.evaluation.skipped,
          },
          provenance: ev.provenance,
          generatedAt: ev.generatedAt,
          caveats: ev.evaluation.caveats,
        },
        { headers },
      );
  }
}

/** Resolve `t=` or `id=` to a token + list; 400/404 responses when neither works. */
async function tokenFrom(req: NextRequest, q: URLSearchParams, body?: Record<string, unknown>): Promise<{ token: string; wl: Watchlist } | NextResponse> {
  const t = (q.get("t") ?? (typeof body?.token === "string" ? body.token : "")).trim();
  const id = (q.get("id") ?? (typeof body?.id === "string" ? body.id : "")).trim().toLowerCase();
  let token = t;
  if (!token && id) {
    if (!ID_RE.test(id)) return bad("id: 3-64 lower-case letters, digits and '-'");
    const stored = await loadStored(defaultKv(), id);
    if (!stored) return bad(`no published watchlist "${id}" on this server (publish with POST /api/watch, or pass the token as t=)`, undefined, 404);
    token = stored.token;
  }
  if (!token) return bad("t=<token> or id=<published id> required; POST { watchlist } to mint a token");
  if (token.length > LIMITS.tokenChars) return bad(`token longer than ${LIMITS.tokenChars} characters`);
  try {
    return { token, wl: decodeTokenSync(token) };
  } catch (err) {
    return bad(err instanceof Error ? err.message : "token: undecodable");
  }
}

// ---------------------------------------------------------------- handlers

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  if (q.get("op") === "metrics") return json({ data: METRICS_BY_KIND, generatedAt: new Date().toISOString() }, 200, 3600);
  const fmtRaw = (q.get("format") ?? "rss").toLowerCase();
  if (!(FORMATS as readonly string[]).includes(fmtRaw)) return bad(`format: one of ${FORMATS.join(", ")}`);
  const format = fmtRaw as Format;
  const src = await tokenFrom(req, q);
  if (src instanceof NextResponse) return src;
  const origin = originOf(req);
  try {
    const { value, age } = await evaluateToken(src.token, src.wl, origin);
    return render(format, value, origin, src.token, age);
  } catch (err) {
    return bad(err instanceof Error ? err.message : "evaluation failed", undefined, 502);
  }
}

export async function POST(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const op = q.get("op") ?? "publish";
  const body = await readJsonBody(req);
  if (!body.ok) return bad(body.error);
  const origin = originOf(req);

  if (op === "publish") {
    const v = validateWatchlist(body.body.watchlist ?? body.body);
    if (!v.ok) return bad("watchlist failed validation", v.errors);
    let token: string;
    try {
      token = encodeTokenSync(v.value);
    } catch (err) {
      return bad(err instanceof Error ? err.message : "token: could not encode");
    }
    const kv = defaultKv();
    let stored = false;
    let storeError: string | undefined;
    if (kv) {
      try {
        await kv.set(`watch:${v.value.id}`, JSON.stringify({ token, storedAt: new Date().toISOString() } satisfies StoredList));
        stored = true;
      } catch (err) {
        storeError = err instanceof Error ? err.message : String(err);
      }
    }
    const urls = feedUrls(origin, token);
    const caveats = [...v.warnings];
    if (!kv) caveats.push("This server keeps no store (GEV_WATCH_KV=off); the token URLs work, the short id does not.");
    else if (!stored) caveats.push(`Store write failed (${storeError}); the token URLs work, the short id does not.`);
    return json({
      data: { id: v.value.id, token, stored, urls, shortUrls: stored ? { rss: `${origin}/api/watch?id=${v.value.id}&format=rss`, atom: `${origin}/api/watch?id=${v.value.id}&format=atom`, json: `${origin}/api/watch?id=${v.value.id}&format=json` } : null, tokenChars: token.length, limit: LIMITS.tokenChars },
      generatedAt: new Date().toISOString(),
      caveats,
    });
  }

  if (op === "test-webhook" || op === "dispatch") {
    const auth = cronSecretOk(req);
    if (auth === "unset") return bad("webhook delivery is not enabled on this server (set GEV_CRON_SECRET)", undefined, 404);
    if (auth === "bad") return bad("x-gev-cron-secret header does not match", undefined, 401);
    const url = typeof body.body.url === "string" ? body.body.url : "";
    const secret = typeof body.body.secret === "string" ? body.body.secret : "";
    if (!url) return bad("url: an https URL the signed POST goes to");
    if (secret.length < 8 || secret.length > 256) return bad("secret: 8-256 characters; the receiver verifies X-GEV-Signature with it");
    if (op === "test-webhook") {
      const result = await dispatch([sampleEvent()], { url, secret, watchlistId: "sample", title: "Sample watchlist", sample: true });
      return json({ data: result, generatedAt: new Date().toISOString() }, result.ok ? 200 : 502);
    }
    const src = await tokenFrom(req, q, body.body);
    if (src instanceof NextResponse) return src;
    try {
      const { value } = await evaluateToken(src.token, src.wl, origin);
      const always = body.body.always === true;
      if (!value.evaluation.events.length && !always) {
        return json({ data: { delivered: false, reason: "no events fired; pass always:true to deliver an empty payload", events: 0 }, provenance: value.provenance, generatedAt: value.generatedAt, caveats: value.evaluation.caveats });
      }
      const result = await dispatch(value.evaluation.events, { url, secret, watchlistId: value.watchlist.id, title: value.watchlist.title });
      return json({ data: { delivered: result.ok, events: value.evaluation.events.length, result }, provenance: value.provenance, generatedAt: value.generatedAt, caveats: value.evaluation.caveats }, result.ok ? 200 : 502);
    } catch (err) {
      return bad(err instanceof Error ? err.message : "evaluation failed", undefined, 502);
    }
  }

  return bad("unknown op: publish (default) | test-webhook | dispatch");
}
