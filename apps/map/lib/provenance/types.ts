// Provenance envelope: every number the API or the HUD shows can say where it
// came from, which release it belongs to and when it was fetched, in a shape a
// script can read and a research note can cite.
//
// Contract shared by every workstream (series, indicators, releases, screener,
// companies, MCP). Keep it small and additive; never remove a field.

/** A public data source we relay or compute from. */
export interface SourceRef {
  /** Stable machine id, e.g. "bls-qcew", "zillow-zhvi", "usgs-water", "fred", "sec-edgar". */
  id: string;
  /** Human name as it should appear in a citation. */
  name: string;
  /** Publisher / agency. */
  publisher: string;
  /** Landing page or documentation URL. */
  url: string;
  /** Licence or terms in a few words ("public domain", "CC BY 4.0", "free with attribution"). */
  license: string;
  /** Key in LICENCE_TERMS (lib/provenance/licenceTerms.ts) when the licence maps to one with confidence. `license` stays as the human note. */
  licenseId?: string;
}

/**
 * One input of a computed value: the receipt of what it was computed from. Three fields are the receipt
 * (the source, the publisher's own URL, when we fetched it); the rest say which release it was and where
 * the reply names the rows. Additive: a reader that ignores `inputs` reads every older reply as before.
 */
export interface ProvenanceInput {
  /** Id of the SourceRef the input was read from ("epa-npl-status", "census-tigerweb"). */
  sourceId: string;
  /**
   * The publisher's own URL for the input: the record when one row was used, or the layer or table when the value
   * aggregates rows of it (a county count over a whole layer). Absent when the publisher has no URL for it.
   */
  upstreamRecordUrl?: string;
  /** When we fetched the input, ISO 8601 (a bare date when that is all the input's own file states). */
  retrievedAt: string;
  /** When the upstream published or last edited the input, when it states one. */
  releasedAt?: string;
  /** Where the reply lists the rows this was computed from, as a path into the reply body ("data.siteIds": county to EPA site ids). */
  rowIdsAt?: string;
}

export interface Provenance {
  source: SourceRef;
  /** Upstream series / dataset / table identifier when one exists ("MORTGAGE30US", "07032000:00065", "CIK0000320193"). */
  seriesId?: string;
  /** The exact upstream URL the value was read from, when it is safe and useful to share. */
  upstreamUrl?: string;
  /** Period the value describes, ISO date or "2026-Q1" / "2026-07". */
  period?: string;
  /** When the upstream published this value, ISO 8601, when known. */
  releasedAt?: string;
  /** When we fetched it, ISO 8601. */
  retrievedAt: string;
  /** "published" = relayed as-is, "estimate" = computed here from published values, "snapshot" = our own observation of a live feed. */
  kind: "published" | "estimate" | "snapshot";
  /** Free-text method for estimates, or the formula that was run. */
  method?: string;
  /**
   * For kind "estimate": the inputs the value was computed from, each with its receipt. A value computed here from
   * publisher rows is an estimate and names them; lib/provenance/estimates.ts holds the rule. An entry with `inputs`
   * is never "published" (published = relayed as-is).
   */
  inputs?: ProvenanceInput[];
  /** Upstream revision policy or flag ("preliminary", "revised", "final"). */
  revision?: string;
  /** Caveats a reader must see. */
  notes?: string[];
}

/** A value with its provenance attached. */
export interface Sourced<T> {
  value: T;
  provenance: Provenance;
}

/** Response envelope for API routes that opt in. `data` is the payload; `provenance` lists every source used. */
export interface Enveloped<T> {
  data: T;
  provenance: Provenance[];
  /** ISO time the response was assembled. */
  generatedAt: string;
  /** Free text caveats about the whole response. */
  caveats?: string[];
}

/** Render a citation line for a provenance record (Chicago-ish, plain text). */
export function citation(p: Provenance, accessed = p.retrievedAt): string {
  const parts = [p.source.publisher, p.source.name];
  if (p.seriesId) parts.push(`series ${p.seriesId}`);
  if (p.period) parts.push(`period ${p.period}`);
  if (p.releasedAt) parts.push(`released ${p.releasedAt.slice(0, 10)}`);
  parts.push(p.upstreamUrl ?? p.source.url);
  parts.push(`accessed ${accessed.slice(0, 10)}`);
  if (p.kind === "estimate") parts.push("estimate computed by Embedding Atlas" + (p.method ? `: ${p.method}` : ""));
  if (p.kind === "snapshot") parts.push("Embedding Atlas snapshot of a live feed");
  return parts.join(". ") + ".";
}

/** Build a provenance record with the retrieval time filled in. */
export function provenance(source: SourceRef, fields: Omit<Provenance, "source" | "retrievedAt"> & { retrievedAt?: string }): Provenance {
  return { source, retrievedAt: fields.retrievedAt ?? new Date().toISOString(), ...fields };
}
