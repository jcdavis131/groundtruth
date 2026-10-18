// records-corpus.json for B0 run 5: every record rebuilt (new-records.json), grouped by
// (card, embedText, source, retrievedAt) with a count, in the order of the run-4 corpus's sources.
// Also writes prev-map.json: each new (card, text) doc -> the run-4 text it was rebuilt from.
const fs = require("fs");
const [, , oldPath, newPath, outPath, prevPath] = process.argv;
const old = JSON.parse(fs.readFileSync(oldPath, "utf8"));
const recs = JSON.parse(fs.readFileSync(newPath, "utf8"));
const order = [];
for (const r of old) {
  const k = `${r.card}\n${r.source}`;
  if (!order.includes(k)) order.push(k);
}
const groups = new Map();
const prev = {};
for (const r of recs) {
  if (!r.embedText) throw new Error("record without text");
  if (r.prevText == null) throw new Error("record without prevText");
  const k = JSON.stringify([r.card, r.embedText, r.source, r.retrievedAt]);
  if (!groups.has(k)) groups.set(k, { card: r.card, embedText: r.embedText, source: r.source, retrievedAt: r.retrievedAt, n: 0 });
  groups.get(k).n++;
  const id = `${r.card}\t${r.embedText}`;
  if (prev[id] != null && prev[id] !== r.prevText) throw new Error(`two prev texts for ${id}`);
  prev[id] = r.prevText;
}
const rows = [...groups.values()].sort((a, b) => order.indexOf(`${a.card}\n${a.source}`) - order.indexOf(`${b.card}\n${b.source}`));
if (rows.some((r) => order.indexOf(`${r.card}\n${r.source}`) < 0)) throw new Error("a source not in the old corpus");
fs.writeFileSync(outPath, "[\n" + rows.map((r) => JSON.stringify(r)).join(",\n") + "\n]\n");
fs.writeFileSync(prevPath, JSON.stringify(prev));
const n = rows.reduce((s, r) => s + r.n, 0);
const pairs = new Set(rows.map((r) => JSON.stringify([r.card, r.embedText]))).size;
console.log("rows", rows.length, "distinct card+text pairs", pairs, "records", n, "cards", new Set(rows.map((r) => r.card)).size);
