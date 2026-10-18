// The county brief as JSON Feed 1.1.
//
// Same brief, same content-addressed entry ids and the same hour-long memo as
// feed.xml — deliberately the same cache key, so a reader on RSS and a reader
// on JSON Feed inside one window are served from one assembly and cannot
// disagree about what the county's findings were.
//
// This is not the provenance envelope and does not pretend to be. JSON Feed is
// a fixed external standard with no room for { ...meta, data, provenance,
// generatedAt }, so a script that wants the findings AND their sources in one
// object reads /api/brief instead; this endpoint is for feed readers, and the
// digest item carries the citation list in its content_text so a reader that
// never visits the page still sees where the numbers came from.
//
// renderJsonFeed's item shape — title, content_text, url, date_published — is
// also the natural intermediate for an email body, which is why it is worth
// shipping before there is a list to send to.

import type { NextRequest } from "next/server";

import { briefInputFromFacts, buildBrief } from "@/lib/brief/build";
import { briefFeedDoc } from "@/lib/brief/feed";
import { renderJsonFeed } from "@/lib/feed/render";
import type { IndicatorCategory } from "@/lib/indicators/types";
import { PERSONA_BY_ID, isPersonaId, type PersonaId } from "@/lib/personas/registry";
import { placeFacts } from "@/lib/places/facts";
import { parseCountyParam, scopeBriefPath, scopeId, scopeLensBriefPath, scopePath } from "@/lib/places/scope";
import { SITE_URL, absoluteUrl } from "@/lib/seo/base";
import { cached } from "@/lib/server/cache";
import { CORS, badRequest, cacheControl, notFound, options, withCors } from "@/lib/server/respond";
import { jsonError } from "@/lib/server/upstream";

export const revalidate = 3600;

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

  const rawLens = (req.nextUrl.searchParams.get("lens") ?? "").trim();
  if (rawLens && !isPersonaId(rawLens)) return badRequest(`unknown lens: ${LENSES}`, { lens: rawLens });
  const lens: PersonaId | null = rawLens ? (rawLens as PersonaId) : null;

  const base = scopePath(scope);
  const self = absoluteUrl(`${base}/feed.json${lens ? `?lens=${lens}` : ""}`);
  const page = absoluteUrl(lens ? scopeLensBriefPath(scope, lens) : scopeBriefPath(scope));

  try {
    const r = await cached(`place:feed:${scopeId(scope)}:${lens ?? "default"}`, TTL_MS, async () => {
      const now = Date.now();
      const generatedAt = new Date(now).toISOString();
      const facts = await placeFacts(scope, { now, retrievedAt: generatedAt, indicatorCategory: categoryFor(lens) });
      return buildBrief(briefInputFromFacts(facts, lens), { now, generatedAt });
    });
    const doc = briefFeedDoc(r.value, { self, home: SITE_URL, page });
    return new Response(JSON.stringify(renderJsonFeed(doc), null, 2), {
      headers: {
        ...CORS,
        "content-type": "application/feed+json; charset=utf-8",
        "cache-control": cacheControl(TTL_S),
      },
    });
  } catch (err) {
    return withCors(jsonError(err));
  }
}
