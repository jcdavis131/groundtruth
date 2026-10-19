// The metro brief as RSS 2.0, or Atom with ?format=atom.
//
// Route handlers are dynamic by default in this version of Next — unlike
// sitemap.ts and robots.ts, which the docs say are cached — so every request
// runs placeFacts and buildBrief on origin and the explicit cache-control line
// is what lets the CDN absorb the repeats.
//
// The guid of every entry is a content hash with no wall-clock term, so two
// runs over unchanged data emit byte-identical <guid> values and a Monday
// morning poller does not re-notify. Only <lastBuildDate> and <pubDate> move.

import { briefFeedDoc } from "@/lib/brief/feed";
import { briefInputFromFacts, buildBrief } from "@/lib/brief/build";
import { renderAtom, renderRss } from "@/lib/feed/render";
import { isPersonaId } from "@/lib/personas/registry";
import { placeFacts } from "@/lib/places/facts";
import { parseMetroParam } from "@/lib/places/scope";
import { absoluteUrl, SITE_URL } from "@/lib/seo/base";
import { CORS, cacheControl } from "@/lib/server/respond";

export const revalidate = 3600;

export const maxDuration = 60;

const TTL_S = 3600;

export async function GET(req: Request, ctx: { params: Promise<{ cbsa: string }> }): Promise<Response> {
  const { cbsa } = await ctx.params;
  const scope = parseMetroParam(cbsa);
  if (!scope) return new Response("No such metropolitan area.", { status: 404, headers: { ...CORS, "content-type": "text/plain; charset=utf-8" } });

  const url = new URL(req.url);
  const rawLens = url.searchParams.get("lens");
  const lens = rawLens && isPersonaId(rawLens) ? rawLens : null;
  const atom = url.searchParams.get("format") === "atom";

  const now = Date.now();
  const facts = await placeFacts(scope, { now });
  const brief = buildBrief(briefInputFromFacts(facts, lens), { now, generatedAt: facts.generatedAt });

  const page = absoluteUrl(`/metro/${cbsa}`);
  const self = absoluteUrl(`/metro/${cbsa}/feed.xml${lens ? `?lens=${lens}` : ""}${atom ? `${lens ? "&" : "?"}format=atom` : ""}`);
  const doc = briefFeedDoc(brief, { self, home: SITE_URL, page });

  const headers = {
    ...CORS,
    "cache-control": cacheControl(TTL_S),
    "content-type": atom ? "application/atom+xml; charset=utf-8" : "application/rss+xml; charset=utf-8",
  };
  return new Response(atom ? renderAtom(doc) : renderRss(doc), { headers });
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS });
}
