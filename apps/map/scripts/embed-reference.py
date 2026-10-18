"""Reference embeddings for the potion port, from MinishLab's own model2vec.

    python scripts/embed-reference.py <potion-base-8M dir> lib/embed/__fixtures__/reference-texts.json lib/embed/__fixtures__/reference-fp32.json

Run in a throwaway venv (pip install model2vec==0.10.0) with HF_HUB_OFFLINE=1
against a local copy of minishlab/potion-base-8M at the pinned commit. Writes,
per text, the token ids model2vec embeds (StaticModel.tokenize, which calls the
tokenizer without special tokens and drops [UNK]) and the encoded vector with
encode's defaults. These are computed reference values, not data.
"""

import datetime
import json
import os
import sys

os.environ.setdefault("HF_HUB_OFFLINE", "1")

import model2vec  # noqa: E402
import numpy as np  # noqa: E402
import tokenizers  # noqa: E402
from model2vec import StaticModel  # noqa: E402

model_dir, texts_path, out_path = sys.argv[1:4]
model = StaticModel.from_pretrained(model_dir)
texts = [t["text"] for t in json.load(open(texts_path, encoding="utf-8"))["texts"]]

vectors = model.encode(texts)
ids = model.tokenize(texts)
rows = []
for text, tok, vec in zip(texts, ids, vectors):
    rows.append({"text": text, "ids": [int(i) for i in tok], "vector": [round(float(x), 7) for x in np.asarray(vec, dtype=np.float32)]})

out = {
    "kind": "computed-from-reference",
    "generator": f"model2vec {model2vec.__version__} (tokenizers {tokenizers.__version__}, numpy {np.__version__}) at minishlab/potion-base-8M@bf8b056651a2c21b8d2565580b8569da283cab23",
    "settings": {"normalize": bool(model.normalize), "max_length": model.max_length, "median_token_length": int(model.median_token_length), "unk_token_id": model.unk_token_id, "dim": int(model.dim)},
    "run": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") + " on the Alienware (scripts/embed-reference.py)",
    "rows": rows,
}
with open(out_path, "w", encoding="utf-8", newline="\n") as f:
    json.dump(out, f, ensure_ascii=False)
    f.write("\n")
print(f"wrote {len(rows)} rows to {out_path}; settings {out['settings']}")
