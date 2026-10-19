// The catalogue as JSON: every curated collection eye draws or reads, with
// what a record is, its sources (expanded from the SOURCES registry: name,
// publisher, url, licence), coverage, freshness and where it was read, what is
// left out and why, caveats, and the ops that serve it. Static (bundled with
// the app; no upstream call), CORS open, an hour at the edge.
//
//   /api/catalog                  every collection, plus the layers not yet catalogued
//   /api/catalog?id=nrhp-listed   one collection (404 with the list of ids when unknown)
//   /api/catalog?layer=crithab    a layer's collections
//   /api/catalog?op=search&q=...  the collections ranked by meaning (embedding of the
//                                 query against each card's own prose; collections only,
//                                 records are searched in the browser palette)
//   /api/catalog?op=place-export&collection=npl-status|ust-releases-county|ust-facilities-county|fuds-properties
//                                 a committed per-county aggregate (a candidate
//                                 vector-places tower; docs/place-towers.md):
//                                 npl-status by year, the others one static snapshot
//
// The same entries are listed for people at /catalog.
//
// Caching (node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md,
// "Caching"): Route Handlers are not cached by default and this one reads the request's
// search params, so every branch runs per request and the edge caches it by URL through
// the s-maxage line. op=search embeds the query with the pinned potion-base-8M read from
// public/embed (traced into this function by next.config.ts) once per instance; the
// query is not logged.

import type { NextRequest } from "next/server";
import { badRequest, notFound, ok, options } from "@/lib/server/respond";
import { COLLECTIONS, catalogued, collection, collectionsForLayer, type Collection } from "@/lib/catalog/collections";
import { CARD_VECTORS, rankCards } from "@/lib/catalog/cardIndex";
import { PLACE_EXPORTS, placeExport } from "@/lib/catalog/placeExport";
import { QUERY_MAX, QUERY_MIN, queryText } from "@/lib/catalog/recordText";
import { POTION } from "@/lib/embed/pins";
import { potionNode } from "@/lib/embed/loadNode";
import { LAYER_IDS, type LayerId } from "@/lib/layers/types";
import { source } from "@/lib/provenance/sources";

export const OPTIONS = options;

/** A collection with its sources expanded from the registry; `round` is internal curation bookkeeping and is not published. */
function view(c: Collection) {
  const out: Omit<Collection, "sources" | "round"> & { round?: Collection["round"]; sources: ReturnType<typeof source>[]; globe: string } = { ...c, sources: c.sources.map((id) => source(id)), globe: `/?layers=${c.layer}` };
  delete out.round;
  return out;
}

const CAVEATS = [
  "The catalogue describes each collection as it was read on the dates given (freshness.recordedOn, coverage.count.countedOn); it is not a live status.",
  "Layers listed in `uncatalogued` are drawn by eye but have no catalogue entry yet; their sources are in the About panel's Signal sources.",
];

const SEARCH_CAVEATS = [
  "Collections only: the query is compared with each card's own description (title, what it holds, what a record is, its shelf), not with the records. Records loaded on the globe are searched by meaning in the palette.",
  "A score is the cosine between two text embeddings: it says the descriptions read alike, not that a collection answers the question. Names and ids are matched by letters in the palette, never by meaning.",
  `Embeddings: potion-base-8M by MinishLab (Model2Vec, MIT), a static model distilled from BAAI bge-base-en-v1.5, int8, pinned at ${POTION.commit.slice(0, 8)}. On MinishLab's own MTEB table its retrieval score is 31.11 against all-MiniLM-L6-v2's 42.92.`,
];

function search(q: string | null, limitRaw: string | null) {
  const text = queryText(q ?? "");
  if (!text) return badRequest(`q must be ${QUERY_MIN} to ${QUERY_MAX} characters`);
  const limit = limitRaw == null ? 5 : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) return badRequest("limit must be an integer from 1 to 10");
  const v = potionNode().embed(text);
  const embedder = { id: CARD_VECTORS.embedder.id, model: POTION.model, commit: POTION.commit, tableSha256: POTION.derived["table.i8"], licence: POTION.licence };
  // A query with no word in the vocabulary has no vector: an empty answer, not a ranking of noise.
  const hits = v ? rankCards(v, limit).map((h) => ({ ...h, ops: collection(h.id)!.ops, catalog: `/catalog#${h.id}` })) : [];
  return ok({ hits, embedder, matched: v != null }, { ttlS: 3600, caveats: SEARCH_CAVEATS });
}

export function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const op = q.get("op");
  if (op === "search") return search(q.get("q"), q.get("limit"));
  if (op === "place-export") {
    const id = q.get("collection");
    const x = id ? placeExport(id) : null;
    if (!x) return badRequest(`collection must be one of: ${PLACE_EXPORTS.join(", ")}`, { collections: PLACE_EXPORTS });
    return ok(x.data, { ttlS: 3600, caveats: x.caveats });
  }
  if (op != null) return badRequest(`unknown op "${op}"`, { ops: ["search", "place-export"] });
  const id = q.get("id");
  const layer = q.get("layer");
  const uncatalogued = LAYER_IDS.filter((l) => !catalogued().includes(l));
  if (id != null) {
    const c = collection(id);
    if (!c) return notFound(`no collection "${id}"`, { ids: COLLECTIONS.map((x) => x.id) });
    return ok({ collection: view(c) }, { ttlS: 3600, caveats: CAVEATS });
  }
  if (layer != null) {
    if (!(LAYER_IDS as string[]).includes(layer)) return badRequest(`unknown layer "${layer}"`, { layers: catalogued() });
    return ok({ layer, collections: collectionsForLayer(layer as LayerId).map(view) }, { ttlS: 3600, caveats: CAVEATS });
  }
  return ok({ collections: COLLECTIONS.map(view), catalogued: catalogued(), uncatalogued }, { ttlS: 3600, caveats: CAVEATS });
}
