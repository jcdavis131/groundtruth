// What the shipped embedder is, pinned. The files under public/embed/<dir>/
// are derived from these upstream bytes by scripts/build-embed-weights.mjs;
// manifest.json there repeats every hash, and a loader checks the derived
// files against the hashes here before using them.

export const POTION = {
  model: "minishlab/potion-base-8M",
  /** Hugging Face commit the weights were read at (2026-10-16). */
  commit: "bf8b056651a2c21b8d2565580b8569da283cab23",
  licence: "MIT",
  dims: 256,
  /** Rows in the embedding table, read from the safetensors header: F32 [29528, 256]. */
  rows: 29528,
  /** model2vec's encode default: at most this many tokens per text. */
  maxTokens: 512,
  /** sha256 of the upstream files the derived files come from. */
  upstream: {
    "model.safetensors": "f65d0f325faadc1e121c319e2faa41170d3fa07d8c89abd48ca5358d9a223de2",
    "tokenizer.json": "e67e803f624fb4d67dea1c730d06e1067e1b14d830e2c2202569e3ef0f70bb50",
    "config.json": "2a6ac0e9aaa356a68a5688070db78fc3a464fefe85d2f06a1905ce3718687553",
  },
  /** Served path (browser) and repo path (server) of the derived files. */
  dir: "embed/potion-base-8M-bf8b0566",
  /** sha256 of each derived file; filled by scripts/build-embed-weights.mjs and checked on load. */
  derived: {
    "table.i8": "02727ea774d77f964eed1ce84bbf0bc216228e49d1627ab44e1f00db1f58c41e",
    "scales.f32": "9a42e12a15278a8fcf9b41745fb7747b929725e01b5f401f5517713b7369666f",
    "vocab.txt": "1394523a67ddd404a825428018c0582a6998bcfa044ecbcbf1f4d71adb94c61c",
  },
  credit: "Embeddings: potion-base-8M by MinishLab (Model2Vec, MIT), distilled from BAAI bge-base-en-v1.5. Tokenizer vocabulary: BAAI bge-base-en-v1.5, re-indexed by MinishLab.",
} as const;

export const POTION_ID = "potion-base-8M@bf8b0566-int8";
