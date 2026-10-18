// Server-side (Node runtime) loader for the shipped embedder: reads the
// derived files from public/embed/<dir>/ (traced into the /api/catalog
// function by next.config.ts outputFileTracingIncludes), checks each sha256
// against lib/embed/pins.ts and memoises the model per instance. About 8 MB.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { POTION, POTION_ID } from "./pins";
import { Potion } from "./potion";

let memo: Potion | null = null;

function read(name: keyof typeof POTION.derived, root: string): Buffer {
  const b = readFileSync(path.join(root, "public", POTION.dir, name));
  const got = createHash("sha256").update(b).digest("hex");
  if (got !== POTION.derived[name]) throw new Error(`${name}: sha256 ${got} does not match the pin`);
  return b;
}

/** The pinned potion-base-8M embedder, read once per process. `root` defaults to the working directory (the project root under next start and vitest). */
export function potionNode(root = process.cwd()): Potion {
  if (memo) return memo;
  const table = read("table.i8", root);
  const scales = read("scales.f32", root);
  const vocab = read("vocab.txt", root).toString("utf8").split("\n");
  if (vocab[vocab.length - 1] === "") vocab.pop();
  // Copy into fresh, aligned buffers (a Buffer can sit at any offset in a shared pool).
  const t = new Int8Array(table.length);
  t.set(new Int8Array(table.buffer, table.byteOffset, table.length));
  const s = new Float32Array(scales.length / 4);
  new Uint8Array(s.buffer).set(scales);
  memo = new Potion({ id: POTION_ID, vocab, dims: POTION.dims, table: t, scales: s, maxTokens: POTION.maxTokens });
  return memo;
}
