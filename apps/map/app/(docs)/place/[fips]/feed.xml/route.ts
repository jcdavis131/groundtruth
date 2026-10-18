// The county brief as RSS 2.0, or Atom with ?format=atom, or one lens of it
// with ?lens=.
//
// Route handlers are dynamic by default in this version — unlike sitemap.ts and
// robots.ts, which the docs say are cached — so every request assembles the
// facts and builds the brief on origin. That is fine and is absorbed twice
// over: cacheControl(3600) hands the edge an s-maxage plus a
// stale-while-revalidate window, and the assembly itself is memoised for the
// same hour, so repeats inside a window are not just cheap, they are the same
// bytes. buildBrief is pure, so that identity is a property of the code rather
// than of the cache happening to be warm.
//
// The one thing this endpoint has to get right is guid stability. A reader
// polls hourly and decides what is new by guid alone, so an id with a clock in
// it re-notifies on every poll over unchanged data. Finding.id is a content
// hash over kind, scope, metric, period and value with no timestamp term, and
// briefFeedEntries namespaces it by scope — so two runs a week apart over the
// same data emit byte-identical <guid> elements and only <lastBuildDate> and
// <pubDate> move.
//
// With no egress the brief has no findings and the feed still has one item: the
// digest, which says in words that nothing crossed a line and which sources
// could not be reached. An empty <channel> would look like a broken feed.

import type { NextRequest } from "next/server";

import { briefInputFromFacts, buildBrief } from "@/lib/brief/build";
import { briefFeedDoc } from "@/lib/brief/feed";
import { renderAtom, renderRss } from "@/lib/feed/render";
import type { IndicatorCategory } from "@/lib/indicators/types";
import { PERSONA_BY_ID, isPersonaId, type PersonaId } from "@/lib/personas/registry";
import { placeFacts } from "@/lib/places/facts";
import { parseCountyParam, scopeBriefPath, scopeId, scopeLensBriefPath, scopePath } from "@/lib/places/scope";
import { SITE_URL, absoluteUrl } from "@/lib/seo/base";
import { cached } from "@/lib/server/cache";
import { CORS, badRequest, cacheControl, notFound, options, withCors } from "@/lib/server/respond";
import { jsonError } from "@/lib/server/upstream";

/** One hour, the same window the brief page regenerates on. */
export const revalidate = 3600;

/**
 * A feed request assembles a whole place: TIGERweb, two Zillow files, a QCEW
 * quarter, FDIC and USAspending on a cold cache. Same ceiling as any render.
 */
export const maxDuration = 60;

const TTL_S = 3600;
const TTL_MS = TTL_S * 1000;

const LENSES = Object.keys(PERSONA_BY_ID).sort().join(" | ");

export const OPTIONS = options;

/** The national indicator set a lens narrows to; "explorer" and an "all" category narrow nothing. */
function categoryFor(lens: PersonaId | null): IndicatorCategory | undefined {
  if (!lens) return undefined;
  const c = PERSONA_BY_ID[lens].indicatorCategory;
  return c && c !== "all" ? c : undefined;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ fips: string }> }) {
  const { fips } = await ctx.params;
  const scope = parseCountyParam(fips);
  if (!scope) return notFound(`no county with FIPS ${fips}`, { fips });

  const q = req.nextUrl.searchParams;

  const rawLens = (q.get("lens") ?? "").trim();
  if (rawLens && !isPersonaId(rawLens)) return badRequest(`unknown lens: ${LENSES}`, { lens: rawLens });
  const lens: PersonaId | null = rawLens ? (rawLens as PersonaId) : null;

  const format = (q.get("format") ?? "").trim().toLowerCase();
  if (format && format !== "rss" && format !== "atom") return badRequest("format=rss|atom", { format });
  const atom = format === "atom";

  const base = scopePath(scope);
  const query = `${atom ? "?format=atom" : ""}${lens ? `${atom ? "&" : "?"}lens=${lens}` : ""}`;
  const self = absoluteUrl(`${base}/feed.xml${query}`);
  // Entry links anchor into the brief page, which gives every finding an id
  // equal to that finding's own hash — the same hash the guid carries.
  const page = absoluteUrl(lens ? scopeLensBriefPath(scope, lens) : scopeBriefPath(scope));

  try {
    const r = await cached(`place:feed:${scopeId(scope)}:${lens ?? "default"}`, TTL_MS, async () => {
      const now = Date.now();
      const generatedAt = new Date(now).toISOString();
      const facts = await placeFacts(scope, { now, retrievedAt: generatedAt, indicatorCategory: categoryFor(lens) });
      return buildBrief(briefInputFromFacts(facts, lens), { now, generatedAt });
    });
    const doc = briefFeedDoc(r.value, { self, home: SITE_URL, page });
    return new Response(atom ? renderAtom(doc) : renderRss(doc), {
      headers: {
        ...CORS,
        "content-type": atom ? "application/atom+xml; charset=utf-8" : "application/rss+xml; charset=utf-8",
        "cache-control": cacheControl(TTL_S),
      },
    });
  } catch (err) {
    return withCors(jsonError(err));
  }
}
