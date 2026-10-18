// The metro brief as JSON Feed 1.1.
//
// Same brief, same content-addressed ids as feed.xml; only the serialisation
// differs. renderJsonFeed's item shape (title / content_text / url /
// date_published) is deliberately the natural intermediate for an email body
// later, but phase 1 ships no delivery of any kind.

import { NextResponse } from "next/server";

import { briefFeedDoc } from "@/lib/brief/feed";
import { briefInputFromFacts, buildBrief } from "@/lib/brief/build";
import { renderJsonFeed } from "@/lib/feed/render";
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

  const now = Date.now();
  const facts = await placeFacts(scope, { now });
  const brief = buildBrief(briefInputFromFacts(facts, lens), { now, generatedAt: facts.generatedAt });

  const doc = briefFeedDoc(brief, {
    self: absoluteUrl(`/metro/${cbsa}/feed.json${lens ? `?lens=${lens}` : ""}`),
    home: SITE_URL,
    page: absoluteUrl(`/metro/${cbsa}`),
  });

  return NextResponse.json(renderJsonFeed(doc), {
    headers: { ...CORS, "cache-control": cacheControl(TTL_S), "content-type": "application/feed+json; charset=utf-8" },
  });
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS });
}
