// Server-side token codec on Node's zlib. Same byte format as the browser's
// CompressionStream("deflate-raw"), so a token minted in the panel decodes
// here and a token minted here decodes in the panel. Import only from route
// handlers and scripts; the browser bundle must never pull in node:zlib.

import { deflateRawSync, inflateRawSync } from "node:zlib";
import { base64urlDecode, base64urlEncode, fromCompact, LIMITS, toCompact, utf8Decode, utf8Encode, type TokenCodec, type Watchlist } from "./model";

export const nodeCodec: TokenCodec = {
  async deflate(bytes) {
    return new Uint8Array(deflateRawSync(bytes, { level: 9 }));
  },
  async inflate(bytes, maxBytes) {
    // maxOutputLength makes zlib throw (RangeError) instead of inflating a bomb.
    return new Uint8Array(inflateRawSync(bytes, { maxOutputLength: maxBytes }));
  },
};

/** Synchronous encode for route handlers. Same output as encodeToken(). */
export function encodeTokenSync(w: Watchlist): string {
  const json = JSON.stringify(toCompact(w));
  const token = base64urlEncode(new Uint8Array(deflateRawSync(utf8Encode(json), { level: 9 })));
  if (token.length > LIMITS.tokenChars) throw new Error(`token: ${token.length} characters exceeds the ${LIMITS.tokenChars} limit; shorten names or split the list`);
  return token;
}

/** Synchronous decode + validate for route handlers. Errors are user-facing sentences. */
export function decodeTokenSync(token: string): Watchlist {
  const t = token.trim();
  if (!t) throw new Error("token: empty");
  if (t.length > LIMITS.tokenChars) throw new Error(`token: longer than ${LIMITS.tokenChars} characters`);
  let json: string;
  try {
    json = utf8Decode(new Uint8Array(inflateRawSync(base64urlDecode(t), { maxOutputLength: LIMITS.inflatedBytes })));
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    throw new Error(m.startsWith("token:") ? m : "token: not a deflated watchlist (" + m + ")");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("token: inflated bytes are not JSON");
  }
  const v = fromCompact(parsed);
  if (!v.ok) throw new Error(v.errors.join("; "));
  return v.value;
}
