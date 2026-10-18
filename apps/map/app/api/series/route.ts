// Series API: read the snapshot series the collectors write (counts of ships
// at ports, aircraft at cargo hubs, river stages, reservoir levels, quake
// counts), keyless and CORS-open like /api/water and /api/economy.
//
//   /api/series?op=list[&prefix=snapshot:port-vessels]      every series (metadata only)
//   /api/series?op=get&id=snapshot:port-vessels:USLAX        one series, sample cadence
//       [&from=ISO|ms][&to=][&limit=5000][&rollup=daily-mean|daily-max|daily-last][&format=csv]
//   /api/series?op=get&ids=a,b,c                             up to 20 series at once (data is a list)
//   /api/series?op=collectors                                what each collector samples and stores
//   POST /api/series?op=collect[&only=quakes,gauges]         run collectors now; requires the
//       x-gev-cron-secret header to equal GEV_CRON_SECRET and 404s when that env is unset
//
// Responses use the Enveloped shape from lib/provenance/types.ts: `data`,
// `provenance[]` (one record per series, saying which feed it was reduced
// from and how) and `generatedAt`. Series files change every three hours, so
// reads are edge-cached for five minutes.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { provenance, type Provenance } from "@/lib/provenance/types";
import { source } from "@/lib/provenance/sources";
import { cronAuth, csvFileName, envelope, parseGetParams, parseOnly, parseOp, parsePrefix } from "@/lib/series/api";
import { runCollectors } from "@/lib/series/collect";
import { describeCollectors } from "@/lib/series/collectors";
import { listSeries, readSeries, seriesToCsv, type ReadSeries } from "@/lib/series/read";
import { defaultStore } from "@/lib/series/store";

// A collect run on a serverless host is a fallback for the GitHub Action;
// the AIS listen window is trimmed below to fit this budget.
export const maxDuration = 60;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, x-gev-cron-secret",
};

const READ_TTL_S = 300;
const COLLECTORS_TTL_S = 3600;

function json(body: unknown, ttlS: number, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { ...CORS, "cache-control": `public, max-age=0, s-maxage=${ttlS}, stale-while-revalidate=${ttlS}` },
  });
}

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status, headers: { ...CORS, "cache-control": "no-store" } });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const op = parseOp(q.get("op"));
  if (!op.ok) return bad(op.error);
  try {
    if (op.value === "list") {
      const prefix = parsePrefix(q.get("prefix"));
      if (!prefix.ok) return bad(prefix.error);
      const metas = await listSeries(defaultStore(), prefix.value);
      return json(envelope(metas, metas.map((m) => m.provenance)), READ_TTL_S);
    }

    if (op.value === "get") {
      const p = parseGetParams(q);
      if (!p.ok) return bad(p.error);
      const { ids, single, from, to, limit, rollup, format } = p.value;
      const store = defaultStore();
      const found: ReadSeries[] = [];
      const missing: string[] = [];
      for (const id of ids) {
        const s = await readSeries(store, id, { from, to, limit, rollup });
        if (s) found.push(s);
        else missing.push(id);
      }
      if (single && found.length === 0) return bad(`unknown series ${ids[0]}`, 404);
      if (format === "csv") {
        return new Response(seriesToCsv(found), {
          headers: {
            ...CORS,
            "content-type": "text/csv; charset=utf-8",
            "content-disposition": `attachment; filename="${csvFileName(ids)}"`,
            "cache-control": `public, max-age=0, s-maxage=${READ_TTL_S}, stale-while-revalidate=${READ_TTL_S}`,
          },
        });
      }
      const caveats: string[] = [];
      if (missing.length) caveats.push(`unknown series: ${missing.join(", ")}`);
      if (rollup) caveats.push(`points rolled up to one per UTC day (${rollup}); the store keeps sample cadence`);
      const truncated = found.filter((s) => s.available > s.points.length).map((s) => s.id);
      if (truncated.length) caveats.push(`limit ${limit} applied, newest kept: ${truncated.join(", ")}`);
      const prov: Provenance[] = found.map((s) => s.provenance);
      return json(envelope(single ? found[0] : found, prov, caveats), READ_TTL_S);
    }

    if (op.value === "collectors") {
      const data = describeCollectors();
      const prov = provenance(source("gev-snapshot"), { kind: "snapshot", notes: ["Registry: lib/series/collectors/index.ts"] });
      return json(envelope(data, [prov]), COLLECTORS_TTL_S);
    }

    // op=collect is POST only; say so instead of 404 so a curl typo is obvious.
    return bad("op=collect requires POST with the x-gev-cron-secret header", 405);
  } catch (err) {
    return bad(err instanceof Error ? err.message : "series read failed", 502);
  }
}

export async function POST(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const op = parseOp(q.get("op"));
  if (!op.ok) return bad(op.error);
  if (op.value !== "collect") return bad(`op=${op.value} is GET only`, 405);
  // Invisible unless an operator has configured the secret.
  const auth = cronAuth(req.headers.get("x-gev-cron-secret"), process.env.GEV_CRON_SECRET);
  if (auth === "unset") return bad("not found", 404);
  if (auth === "denied") return bad("bad or missing x-gev-cron-secret", 401);
  const only = parseOnly(q.get("only"));
  if (!only.ok) return bad(only.error);
  try {
    const listenS = Number(process.env.GEV_SNAPSHOT_LISTEN_S);
    const report = await runCollectors({
      store: defaultStore(),
      only: only.value,
      keys: { AISSTREAM_KEY: process.env.AISSTREAM_KEY },
      // Keep the whole run inside maxDuration: a short AIS window and tighter budgets.
      listenMs: Number.isFinite(listenS) && listenS > 0 ? Math.min(listenS, 40) * 1000 : 30_000,
      timeoutScale: 0.5,
      logger: (line) => console.log(`[series collect] ${line}`),
    });
    const prov = provenance(source("gev-snapshot"), { kind: "snapshot", method: "runCollectors() via POST /api/series?op=collect" });
    const caveats = report.failed.length ? [`${report.failed.length} collector(s) failed; see data.failed`] : undefined;
    const status = report.ran.length === 0 && report.failed.length > 0 ? 502 : 200;
    return NextResponse.json(envelope(report, [prov], caveats), { status, headers: { ...CORS, "cache-control": "no-store" } });
  } catch (err) {
    return bad(err instanceof Error ? err.message : "collect failed", 502);
  }
}
