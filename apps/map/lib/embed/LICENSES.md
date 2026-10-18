# Embedding model: licences and credit

## potion-base-8M (MinishLab)

- Model: [minishlab/potion-base-8M](https://huggingface.co/minishlab/potion-base-8M), pinned at commit `bf8b056651a2c21b8d2565580b8569da283cab23`, downloaded keyless from huggingface.co on 2026-10-16.
- Licence: MIT (model card front matter `license: mit`). MinishLab's MIT text, from [github.com/MinishLab/model2vec](https://github.com/MinishLab/model2vec/blob/main/LICENSE), ships beside the weights in `public/embed/potion-base-8M-bf8b0566/LICENSE`.
- What we ship: `public/embed/potion-base-8M-bf8b0566/`, derived by `scripts/build-embed-weights.mjs`: the embedding table quantised to int8 with one fp32 scale per row, and the vocabulary unchanged. `manifest.json` there lists the sha256 of every upstream and derived file; `lib/embed/pins.ts` repeats them and the loaders check them.
- Runtime: our own TypeScript (`lib/embed/tokenizer.ts`, `lib/embed/potion.ts`), no MinishLab or Hugging Face code. It is checked against MinishLab's `model2vec` 0.10.0 (MIT) output in `lib/embed/potion.test.ts`.
- Distilled from [BAAI/bge-base-en-v1.5](https://huggingface.co/BAAI/bge-base-en-v1.5): model card front matter `license: mit`, and "FlagEmbedding is licensed under the MIT License".

Credit line, shown on /catalog:

> Embeddings: potion-base-8M by MinishLab (Model2Vec, MIT), distilled from BAAI bge-base-en-v1.5. Tokenizer vocabulary: BAAI bge-base-en-v1.5, re-indexed by MinishLab.

## Known cost

On MinishLab's own MTEB table (model card, 2026-10-16), potion-base-8M scores 31.11 on retrieval against all-MiniLM-L6-v2's 42.92 (averages 51.08 and 55.93). These are MinishLab's numbers on their benchmark, not a measurement on eye's text. The hand-written card eval in `lib/embed/__eval__/` is the only measurement on our text, and it is hand-written by the build agent, not user data.

## Upgrade path

Every embedder implements `Embedder` (`lib/embed/types.ts`), and every stored vector set records its embedder id; mixing two is an error. A transformer model (for example all-MiniLM-L6-v2, Apache-2.0, through onnxruntime-web in a Worker) is a second implementation. Its licence must be read from the upstream sentence-transformers repository: the Xenova conversions carry no licence tag.
