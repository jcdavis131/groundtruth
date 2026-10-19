// The port against MinishLab's own model2vec (lib/embed/__fixtures__/
// reference-fp32.json, computed by scripts/embed-reference.py from the pinned
// weights). Token ids must match exactly; the shipped int8 table must stay
// within cosine 0.99 of the fp32 reference for every text (the gate in the
// design; the real minimum is printed). With POTION_FP32_DIR set to a local
// copy of the upstream files, the fp32 path is checked at 0.9999 too.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { POTION, POTION_ID } from "./pins";
import { potionNode } from "./loadNode";
import { Potion, medianTokenLength } from "./potion";
import { normalize, preTokenize } from "./tokenizer";
import { dot, type EmbedInput } from "./types";

interface Ref {
  kind: string;
  generator: string;
  settings: { normalize: boolean; max_length: number; median_token_length: number; unk_token_id: number; dim: number };
  rows: Array<{ text: string; ids: number[]; vector: number[] }>;
}
const ref = JSON.parse(readFileSync(path.resolve(__dirname, "__fixtures__/reference-fp32.json"), "utf8")) as Ref;
const model = potionNode();
const isZero = (v: number[]) => v.every((x) => x === 0);

describe("the potion-base-8M port", () => {
  it("loads the pinned, hash-checked files", () => {
    expect(model.id).toBe(POTION_ID);
    expect(model.dims).toBe(256);
    expect(ref.kind).toBe("computed-from-reference");
    expect(ref.generator).toContain(POTION.commit);
    expect(ref.settings).toMatchObject({ normalize: true, max_length: POTION.maxTokens, dim: 256, unk_token_id: 1 });
  });

  it("computes the median token length model2vec cuts texts with", () => {
    const vocab = readFileSync(path.resolve(process.cwd(), "public", POTION.dir, "vocab.txt"), "utf8").split("\n").slice(0, -1);
    expect(medianTokenLength(vocab)).toBe(ref.settings.median_token_length);
  });

  it("tokenises every reference text to model2vec's ids exactly", () => {
    expect(ref.rows.length).toBeGreaterThan(50);
    for (const r of ref.rows) expect(model.ids(r.text), JSON.stringify(r.text)).toEqual(r.ids);
  });

  it("keeps the int8 vectors within cosine 0.99 of the fp32 reference (reports the minimum)", () => {
    const cos: number[] = [];
    for (const r of ref.rows) {
      const v = model.embed(r.text as EmbedInput);
      if (isZero(r.vector)) {
        // model2vec returns zeros for a text with no known token; the port returns null, never NaN.
        expect(v, JSON.stringify(r.text)).toBeNull();
        continue;
      }
      expect(v, JSON.stringify(r.text)).not.toBeNull();
      cos.push(dot(v!, r.vector));
    }
    cos.sort((a, b) => a - b);
    console.log(`int8 vs model2vec fp32: n=${cos.length} min=${cos[0].toFixed(6)} median=${cos[cos.length >> 1].toFixed(6)} below 0.995: ${cos.filter((c) => c < 0.995).length}`);
    expect(cos[0]).toBeGreaterThanOrEqual(0.99);
  });

  const fp32Dir = process.env.POTION_FP32_DIR;
  it.skipIf(!fp32Dir || !existsSync(path.join(fp32Dir ?? "", "model.safetensors")))("matches the fp32 reference at cosine 0.9999 from the upstream safetensors", () => {
    const st = readFileSync(path.join(fp32Dir!, "model.safetensors"));
    const n = Number(st.readBigUInt64LE(0));
    const header = JSON.parse(st.subarray(8, 8 + n).toString("utf8")) as { embeddings: { shape: [number, number]; data_offsets: [number, number] } };
    const [b0, b1] = header.embeddings.data_offsets;
    const table = new Float32Array(st.buffer.slice(st.byteOffset + 8 + n + b0, st.byteOffset + 8 + n + b1));
    const vocab = readFileSync(path.resolve(process.cwd(), "public", POTION.dir, "vocab.txt"), "utf8").split("\n").slice(0, -1);
    const fp32 = new Potion({ id: "potion-fp32", vocab, dims: 256, table });
    let min = 1;
    for (const r of ref.rows) {
      if (isZero(r.vector)) continue;
      min = Math.min(min, dot(fp32.embed(r.text as EmbedInput)!, r.vector));
    }
    console.log(`fp32 vs model2vec fp32: min cosine ${min.toFixed(7)}`);
    expect(min).toBeGreaterThanOrEqual(0.9999);
  });

  it("normalises and splits as BERT does", () => {
    expect(normalize("Café\u0000 Ｆ\tx")).toBe("cafe ｆ x");
    expect(preTokenize("303(d) list")).toEqual(["303", "(", "d", ")", "list"]);
    expect(preTokenize("a$b")).toEqual(["a", "$", "b"]);
  });

  it("refuses a raw string at compile time", () => {
    // @ts-expect-error a raw string is not an EmbedInput: only recordText, cardText and queryText make one
    const v = model.embed("raw string");
    expect(v).not.toBeNull();
  });
});
