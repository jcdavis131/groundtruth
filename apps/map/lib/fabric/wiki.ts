// Wikipedia enrichment of the place fabric (server side).
//
// Place, county, state and country strata get their Wikipedia summary as a
// fact plus a Wikipedia link, and the stack records the nearest geotagged
// articles to the point. Partial failures are silent: a construct with no
// article simply carries no link. Only when the whole enrichment throws is
// Wikipedia listed in `failed`.
//
// Copy-on-write is mandatory: fabric part answers are cached and node
// objects are shared, so an enriched node is always a new object and the
// original fabric is never mutated.

import { wikiNearby, wikiSummary } from "@/lib/wiki/client";
import type { WikiArticle, WikiSummary } from "@/lib/wiki/types";
import type { ConstructNode, Fabric } from "./types";

/** First `max` characters of a text, with an ellipsis when it was cut. */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + "…";
}

/**
 * The Wikipedia article title a construct is looked up by, or null when
 * this kind carries no summary. County names arrive as "Travis, TX" (or
 * "Travis County, TX" from some answers): the article is
 * "Travis County, <state name>".
 */
export function wikiTitleForNode(node: Pick<ConstructNode, "kind" | "name">, stateName?: string | null): string | null {
  const name = node.name.trim();
  if (!name) return null;
  switch (node.kind) {
    case "place": {
      const clean = name.replace(/\s+(city|town|village)$/i, "");
      return stateName ? `${clean}, ${stateName}` : clean;
    }
    case "county": {
      if (!stateName) return null;
      const base = name.split(",")[0].trim();
      const withCounty = /\b(county|parish|borough|census area|municipality)$/i.test(base) ? base : `${base} County`;
      return `${withCounty}, ${stateName}`;
    }
    case "state":
      return name;
    case "country":
      return name;
    default:
      return null;
  }
}

export interface WikiDeps {
  summary: (title: string) => Promise<WikiSummary | null>;
  nearby: (lat: number, lon: number, opts: { radiusM: number; limit: number }) => Promise<WikiArticle[]>;
}

const DEFAULT_DEPS: WikiDeps = { summary: wikiSummary, nearby: wikiNearby };

/** Most constructs per stack that get a summary lookup (smallest first). */
export const WIKI_MAX_SUMMARIES = 4;

export async function enrichFabricWithWiki(
  fabric: Fabric,
  lon: number,
  lat: number,
  deps: WikiDeps = DEFAULT_DEPS,
): Promise<Fabric> {
  try {
    const stateName = fabric.nodes.find((n) => n.kind === "state")?.name ?? null;
    const candidates: Array<{ node: ConstructNode; title: string }> = [];
    for (const node of fabric.nodes) {
      if (candidates.length >= WIKI_MAX_SUMMARIES) break;
      const title = wikiTitleForNode(node, stateName);
      if (title) candidates.push({ node, title });
    }
    const settled = await Promise.allSettled(candidates.map((c) => deps.summary(c.title)));
    const enriched = new Map<string, WikiSummary>();
    settled.forEach((s, i) => {
      if (s.status === "fulfilled" && s.value) enriched.set(candidates[i].node.id, s.value);
    });
    const nodes = fabric.nodes.map((node) => {
      const summary = enriched.get(node.id);
      if (!summary) return node;
      return {
        ...node,
        links: [...node.links, { label: "Wikipedia", url: summary.url }],
        facts: { ...node.facts, wikipedia: truncate(summary.extract, 280) },
      };
    });
    const nearby = await deps.nearby(lat, lon, { radiusM: 10_000, limit: 5 });
    const wikiNearbyTop = nearby.slice(0, 5).map((a) => ({ title: a.title, distM: a.distM ?? 0, url: a.url }));
    return {
      ...fabric,
      nodes,
      answered: [...new Set([...fabric.answered, "wikipedia" as const])],
      wikiNearby: wikiNearbyTop,
    };
  } catch (err) {
    return {
      ...fabric,
      failed: [...fabric.failed, { source: "wikipedia" as const, error: err instanceof Error ? err.message.slice(0, 160) : String(err) }],
    };
  }
}
