// Delimited-text reading for the athlete builder. Plain Node, no install.
//
// Every source is read by an explicit column list. The header is checked first: a column the
// builder needs and the file does not have stops the build, so a renamed upstream column fails
// loudly instead of turning into empty fields. Only the listed columns are kept; the rest of
// each row (birth dates, heights, weights, statuses) is never copied into an object.

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

/** One CSV line split into fields. Handles double-quoted fields and "" escapes; no embedded newlines. */
export function splitCsvLine(line, sep = ",") {
  if (sep !== ",") return line.split(sep);
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === sep) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

/** Column positions for `wanted` in a header; throws naming every missing column. */
export function project(header, wanted, label) {
  const names = header.map((h) => h.trim().replace(/^﻿/, ""));
  const missing = wanted.filter((w) => !names.includes(w));
  if (missing.length) throw new Error(`${label}: header lacks ${missing.join(", ")}; refusing to guess`);
  return wanted.map((w) => names.indexOf(w));
}

/**
 * Stream a delimited file, calling onRow with an object holding only the wanted columns.
 * With `header: false` the file has no header and `wanted` lists [name, index] pairs.
 * `input` replaces the file with a readable stream (e.g. unzip's stdout). Resolves to the data row count.
 */
export async function readTable(file, wanted, onRow, { sep = ",", header = true, label = file, input } = {}) {
  const rl = createInterface({ input: input ?? createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
  let idx = null;
  let names = null;
  if (!header) {
    names = wanted.map(([name]) => name);
    idx = wanted.map(([, i]) => i);
  }
  let n = 0;
  for await (const raw of rl) {
    const line = raw.replace(/\r$/, "");
    if (idx === null) {
      idx = project(splitCsvLine(line, sep), wanted, label);
      names = wanted;
      continue;
    }
    if (line === "") continue;
    const f = splitCsvLine(line, sep);
    const row = {};
    for (let k = 0; k < idx.length; k++) row[names[k]] = (f[idx[k]] ?? "").trim();
    n++;
    onRow(row);
  }
  if (idx === null) throw new Error(`${label}: empty file`);
  return n;
}
