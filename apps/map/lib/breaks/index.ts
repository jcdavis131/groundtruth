// breaks/1: the cut points a styled layer bins against, committed with where they came from.
// STUB for the red commit: the types are final, the loaders throw until the files are committed.

import type { PlacesMeasure } from "@/lib/civic/places";

export type BreaksMethod = "quintile-nearest-rank" | "zero-bin-quartile-nearest-rank";

export interface BreaksPage {
  url: string;
  sha256: string;
  lastModified: string | null;
  rows: number;
}

export interface BreaksSource {
  url: string;
  retrievedAt: string;
  lastModified: string | null;
  /** sha256 of the one fetched body; a paginated source lists `pages` instead. */
  sha256?: string;
  pages?: BreaksPage[];
}

export interface BreaksFile {
  schema: "breaks/1";
  layer: string;
  measure: string;
  period: string;
  valueType: string;
  method: BreaksMethod;
  rule: string;
  breaks: number[];
  n: number;
  nNull: number;
  universe: string;
  source: BreaksSource;
  input: { path: string; sha256: string };
}

const NOT_COMMITTED = "breaks/1 files are not committed yet";

export function placesBreaks(measure: PlacesMeasure): BreaksFile {
  throw new Error(`${NOT_COMMITTED}: ${measure}`);
}

export const PLACE_EXPORT_BREAKS: Readonly<Record<string, BreaksFile>> = {};

export function scaleOf(file: BreaksFile): { universe: string; n: number } {
  throw new Error(`${NOT_COMMITTED}: ${file.layer}`);
}

export function tractCaveat(file: BreaksFile): string {
  throw new Error(`${NOT_COMMITTED}: ${file.layer}`);
}
