// The only place text becomes embeddable (an EmbedInput). Three doors:
//
//   recordText(cardId, row)  a record's text, from its card's embedText fields
//   cardText(card)           a catalogue card's own prose
//   queryText(q)             what someone typed into a search
//
// plus receivedRecordText(props), which re-reads the record text our own route
// builders attached to a feature (properties.extra.embedText) after it crossed
// the wire. The embedder takes nothing else, so a field outside a card's
// embedText (a name, an owner, an address, free text) cannot reach it: a raw
// string does not compile.
//
// recordText reads only the card's embedText fields from the row a builder
// hands it (the builder passes its decoded values under the upstream field
// names, e.g. PAD-US Own_Type "Private" for "PVT"), and re-checks each field
// against DENY_FIELD at run time. Since B0 (2026-10-18) the text starts with
// the card's short title and agency (RECORD_HEAD) and its place, and a card on
// PUBLIC_NAME_RULE (hospitals, public schools, dams with a published
// non-private owner, federal and state PAD-US units) may add the record's
// published name, which its builder passes only under that card's rule (always
// the name the feature is labelled by). No other name is embedded: a name
// that can be a person's or a business's, or a private holding labelled by id,
// stays with the palette's letter-by-letter match, which owns the label-by-id
// rules. Ids are matched by letters, never embedded.

import type { EmbedInput } from "@/lib/embed/types";
import type { BaseProps } from "@/lib/layers/types";
import { EMBED_TEXT, PLACE_FIELD_RANK, PUBLIC_NAME_RULE, RECORD_HEAD, embeddableField, fieldLabel, type CollectionId } from "./embedFields";

const MAX_VALUE_CHARS = 160;

function value(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : null;
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  return s ? s.slice(0, MAX_VALUE_CHARS) : null;
}

/**
 * A record's embeddable text (B0, 2026-10-18), "; "-joined labelled segments in this order:
 *   "collection: <card short title>; agency: <publisher>"  (RECORD_HEAD, the same for every record of a card)
 *   "name: <published name>"                               (only for a PUBLIC_NAME_RULE card, when its builder passes one)
 *   its place fields, city then county then state          (PLACE_FIELD_RANK)
 *   the card's other embedText fields, in EMBED_TEXT order
 * Null when no field has a value (absent, never "null" or 0): a head alone is not a record. Throws for
 * an unknown card, a field that is not embeddable, or a public name on a card whose rule allows none.
 */
export function recordText(
  cardId: CollectionId,
  row: Readonly<Record<string, unknown>>,
  publicName?: string | null,
): EmbedInput | null {
  const fields: readonly string[] | undefined = EMBED_TEXT[cardId];
  if (!fields) throw new Error(`no collection "${cardId}"`);
  if (publicName != null && !(cardId in PUBLIC_NAME_RULE)) throw new Error(`${cardId}: no public name may be embedded`);
  const place: Array<[number, number, string]> = [];
  const rest: string[] = [];
  fields.forEach((f, i) => {
    if (!embeddableField(f)) throw new Error(`${cardId}: field ${f} may not be embedded`);
    const label = fieldLabel(cardId, f);
    if (!label) throw new Error(`${cardId}: no label for ${f}`);
    const v = value(row[f]);
    if (v == null) return;
    const rank = PLACE_FIELD_RANK[f];
    if (rank != null) place.push([rank, i, `${label}: ${v}`]);
    else rest.push(`${label}: ${v}`);
  });
  if (!place.length && !rest.length) return null;
  const head = RECORD_HEAD[cardId];
  const name = value(publicName);
  const parts = [
    ...(head ? [`collection: ${head.collection}`, `agency: ${head.agency}`] : []),
    ...(name ? [`name: ${name}`] : []),
    ...place.sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((p) => p[2]),
    ...rest,
  ];
  return parts.join("; ") as EmbedInput;
}

/** What a builder adds to a feature's extra. */
export interface RecordEmbedExtra {
  embedText?: string;
}

/** `x` with the record text attached, or `x` unchanged when there is none. */
export function withEmbedText<T extends object>(x: T, text: EmbedInput | null): T & RecordEmbedExtra {
  return text == null ? x : { ...x, embedText: text };
}

/** The record text a route builder attached to a feature, after the wire. Only recordText writes that field. */
export function receivedRecordText(p: Pick<BaseProps, "extra">): EmbedInput | null {
  const x = p.extra;
  if (!x || typeof x !== "object") return null;
  const t = (x as RecordEmbedExtra).embedText;
  return typeof t === "string" && t.trim() ? (t as EmbedInput) : null;
}

export const QUERY_MIN = 2;
export const QUERY_MAX = 200;

/** A search query, trimmed; null when outside QUERY_MIN..QUERY_MAX characters. */
export function queryText(q: string): EmbedInput | null {
  const s = q.replace(/\s+/g, " ").trim();
  if (s.length < QUERY_MIN || s.length > QUERY_MAX) return null;
  return s as EmbedInput;
}
