// Derive the shipped embedder files from potion-base-8M (MinishLab, MIT).
//
//   node scripts/build-embed-weights.mjs <dir with model.safetensors, tokenizer.json, config.json>
//
// Run once per model pin; the output is committed. Reads the fp32 table
// (checking the safetensors header says F32 [rows, 256]) and writes, under
// public/embed/potion-base-8M-<commit8>/:
//
//   table.i8     rows x 256 int8, row-major (row = int8 x scale)
//   scales.f32   one little-endian fp32 scale per row (max |x| / 127)
//   vocab.txt    tokenizer.json model.vocab in id order, one token per line
//   manifest.json  upstream and derived sha256s, shape, licence, credit
//   LICENSE      MinishLab's MIT text (travels with the files)
//
// The upstream files were downloaded from huggingface.co at the commit below
// (no key, no sign-in). Memory: one 30 MB buffer plus the 7.7 MB output.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const COMMIT = "bf8b056651a2c21b8d2565580b8569da283cab23";
const DIMS = 256;
const src = process.argv[2];
if (!src) {
  console.error("usage: node scripts/build-embed-weights.mjs <model dir>");
  process.exit(2);
}
const out = join(process.cwd(), "public", "embed", `potion-base-8M-${COMMIT.slice(0, 8)}`);
const sha = (b) => createHash("sha256").update(b).digest("hex");

const st = readFileSync(join(src, "model.safetensors"));
const tokJson = readFileSync(join(src, "tokenizer.json"));
const cfg = readFileSync(join(src, "config.json"));

const headerLen = Number(st.readBigUInt64LE(0));
const header = JSON.parse(st.subarray(8, 8 + headerLen).toString("utf8"));
const t = header.embeddings;
if (!t || t.dtype !== "F32" || t.shape.length !== 2 || t.shape[1] !== DIMS) throw new Error(`unexpected tensor: ${JSON.stringify(header)}`);
const [rows] = t.shape;
const [b0, b1] = t.data_offsets;
if (b1 - b0 !== rows * DIMS * 4) throw new Error("data_offsets do not match the shape");

const tok = JSON.parse(tokJson.toString("utf8"));
if (tok.model?.type !== "WordPiece") throw new Error(`tokenizer model is ${tok.model?.type}`);
const vocab = Object.entries(tok.model.vocab).sort((a, b) => a[1] - b[1]);
vocab.forEach(([, id], i) => {
  if (id !== i) throw new Error(`vocab ids are not contiguous at ${i}`);
});
if (vocab.length !== rows) throw new Error(`vocab has ${vocab.length} tokens, table has ${rows} rows`);
for (const [w] of vocab) if (/[\r\n]/.test(w)) throw new Error(`token with a line break: ${JSON.stringify(w)}`);

// Copy the body out so the Float32Array is aligned whatever the Buffer's offset.
const body = new Float32Array(st.buffer.slice(st.byteOffset + 8 + headerLen + b0, st.byteOffset + 8 + headerLen + b1));
const q = new Int8Array(rows * DIMS);
const scales = new Float32Array(rows);
let worst = 1;
for (let r = 0; r < rows; r++) {
  const off = r * DIMS;
  let max = 0;
  for (let j = 0; j < DIMS; j++) max = Math.max(max, Math.abs(body[off + j]));
  const s = max / 127;
  scales[r] = s;
  if (s === 0) continue;
  let dotv = 0, na = 0, nb = 0;
  for (let j = 0; j < DIMS; j++) {
    const v = Math.max(-127, Math.min(127, Math.round(body[off + j] / s)));
    q[off + j] = v;
    dotv += body[off + j] * v * s;
    na += body[off + j] ** 2;
    nb += (v * s) ** 2;
  }
  worst = Math.min(worst, dotv / Math.sqrt(na * nb));
}

mkdirSync(out, { recursive: true });
const tableBuf = Buffer.from(q.buffer);
const scalesBuf = Buffer.from(scales.buffer);
const vocabBuf = Buffer.from(vocab.map(([w]) => w).join("\n") + "\n", "utf8");
writeFileSync(join(out, "table.i8"), tableBuf);
writeFileSync(join(out, "scales.f32"), scalesBuf);
writeFileSync(join(out, "vocab.txt"), vocabBuf);

const manifest = {
  model: "minishlab/potion-base-8M",
  source: `https://huggingface.co/minishlab/potion-base-8M/tree/${COMMIT}`,
  commit: COMMIT,
  licence: "MIT (model card front matter license: mit; text in LICENSE, from github.com/MinishLab/model2vec)",
  credit: "Embeddings: potion-base-8M by MinishLab (Model2Vec, MIT), distilled from BAAI bge-base-en-v1.5. Tokenizer vocabulary: BAAI bge-base-en-v1.5, re-indexed by MinishLab.",
  upstream: { "model.safetensors": sha(st), "tokenizer.json": sha(tokJson), "config.json": sha(cfg) },
  tensor: { name: "embeddings", dtype: t.dtype, shape: t.shape },
  derived: {
    "table.i8": { sha256: sha(tableBuf), bytes: tableBuf.length, format: `int8 [${rows}, ${DIMS}] row-major; row = int8 x scale` },
    "scales.f32": { sha256: sha(scalesBuf), bytes: scalesBuf.length, format: `float32 little-endian [${rows}], max |row| / 127` },
    "vocab.txt": { sha256: sha(vocabBuf), bytes: vocabBuf.length, format: "tokenizer.json model.vocab in id order, one per line" },
  },
  quantisation: { worstRowCosine: Number(worst.toFixed(6)) },
  builtBy: "scripts/build-embed-weights.mjs",
};
writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({ out, rows, worstRowCosine: worst, derived: manifest.derived, upstream: manifest.upstream }, null, 2));
