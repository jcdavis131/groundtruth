// Browser loader for the shipped embedder: fetches the derived files from our
// own origin (/embed/<dir>/, no third-party hop and no CSP change), checks
// each sha256 against lib/embed/pins.ts with WebCrypto, and memoises the model
// for the session. Loaded lazily, never at page load. About 8 MB on the wire
// and in memory; the path carries the model pin, so HTTP caching is safe.

import { POTION, POTION_ID } from "./pins";
import { Potion } from "./potion";

let pending: Promise<Potion> | null = null;

async function fetchVerified(name: keyof typeof POTION.derived, signal?: AbortSignal): Promise<ArrayBuffer> {
  const res = await fetch(`/${POTION.dir}/${name}`, { signal });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
  const hex = Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
  if (hex !== POTION.derived[name]) throw new Error(`${name}: sha256 does not match the pin`);
  return buf;
}

/** The pinned embedder, fetched and verified once per page; a failure clears the memo so a later call retries. */
export function potionBrowser(): Promise<Potion> {
  if (!pending) {
    pending = (async () => {
      const [table, scales, vocabBuf] = await Promise.all([fetchVerified("table.i8"), fetchVerified("scales.f32"), fetchVerified("vocab.txt")]);
      const vocab = new TextDecoder().decode(vocabBuf).split("\n");
      if (vocab[vocab.length - 1] === "") vocab.pop();
      return new Potion({ id: POTION_ID, vocab, dims: POTION.dims, table: new Int8Array(table), scales: new Float32Array(scales), maxTokens: POTION.maxTokens });
    })();
    pending.catch(() => {
      pending = null;
    });
  }
  return pending;
}
