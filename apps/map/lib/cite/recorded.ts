// Recorded publisher replies (lib/cite/__fixtures__/publisher/<sourceId>/<recordId>.json), written by scripts/publisher-record.mjs.
// The header carries the URL, retrievedAt and the sha256 and byte count of the full body as received; a trimmed body says so.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { recordIdOf } from "./hosts";
import type { PublisherReply } from "./types";

export const PUBLISHER_FIXTURES = fileURLToPath(new URL("./__fixtures__/publisher/", import.meta.url));

export interface Recorded {
  sourceId: string;
  recordId: string;
  url: string;
  retrievedAt: string;
  status: number;
  bytes: number;
  sha256: string;
  trimmed: string | null;
  body: string;
}

export function listRecorded(sourceId?: string): Recorded[] {
  const sources = sourceId ? [sourceId] : existsSync(PUBLISHER_FIXTURES) ? readdirSync(PUBLISHER_FIXTURES) : [];
  return sources.flatMap((s) => {
    const dir = path.join(PUBLISHER_FIXTURES, s);
    return existsSync(dir)
      ? readdirSync(dir)
          .filter((f) => f.endsWith(".json"))
          .sort()
          .map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")) as Recorded)
      : [];
  });
}

/** The recorded reply for exactly this URL, or null. */
export function recordedFor(sourceId: string, url: string): Recorded | null {
  const file = path.join(PUBLISHER_FIXTURES, sourceId, `${recordIdOf(sourceId, url)}.json`);
  if (!existsSync(file)) return null;
  const r = JSON.parse(readFileSync(file, "utf8")) as Recorded;
  return r.url === url ? r : null;
}

export function toReply(r: Recorded): PublisherReply {
  return { status: r.status, body: r.body, fetchedAt: r.retrievedAt, sha256: r.sha256 };
}
