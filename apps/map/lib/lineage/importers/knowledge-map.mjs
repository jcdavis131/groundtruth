// Idle importer for knowledge-map entries (SPEC C3.1, secondary source).
// NEVER run in the build: the /research/[slug] knowledge-map store is
// UNLOCATED as of 2026-11-23 (PRD F1, OD-4), so this has no backing file
// and no entry count. When Cameron names the store, this is the loader.
//
// Input: a directory of Markdown/MDX files, or a JSON array file, at the
// path given by LINEAGE_KM_PATH (or the first CLI argument).
//   Markdown: one entry per file. A `---` frontmatter block carries
//     id, name, year, arxivId, aliases (comma-separated), parent, and an
//     `edges:` block is NOT parsed from Markdown — edges come from JSON.
//     The first `# ` heading is the name when frontmatter has none.
//   JSON: an array of entries:
//     { id, name, year, arxivId?, aliases?, parent?,
//       paper?: { title, authors, venue?, tier?, abstract },
//       edges?: [{ to, type, axis, bottleneck, mechanism, tradeoff? }] }
// Output: { nodes, edges, skipped } in the C3.2 schema. No network, no
// arXiv fetch: paper metadata comes from the entry itself, and
// provenance.retrievedAt is the import time (honest: the importer read the
// entry then, it did not fetch the paper).

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const EDGE_TYPES = new Set([
  "extends",
  "improves",
  "replaces",
  "adapts",
  "uses_component",
  "compares",
  "background",
]);
const STRONG_TYPES = new Set(["extends", "improves", "replaces", "adapts"]);

function fail(message) {
  throw new Error(`knowledge-map importer: ${message}`);
}

function parseFrontmatter(text, file) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { fields: {}, body: text };
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (m) fields[m[1]] = m[2].trim();
  }
  return { fields, body: text.slice(match[0].length) };
}

function entryFromMarkdown(file, text) {
  const { fields, body } = parseFrontmatter(text, file);
  const heading = body.match(/^#\s+(.+)$/m);
  const id = fields.id ?? path.basename(file, path.extname(file));
  return {
    id,
    name: fields.name ?? heading?.[1]?.trim() ?? id,
    year: fields.year === undefined ? undefined : Number(fields.year),
    arxivId: fields.arxivId,
    aliases: fields.aliases
      ? fields.aliases.split(",").map((s) => s.trim()).filter(Boolean)
      : [],
    parent: fields.parent,
  };
}

function paperNode(entry, retrievedAt) {
  if (!entry.arxivId || !entry.paper) return null;
  const paper = entry.paper;
  return {
    id: `arxiv:${entry.arxivId}`,
    kind: "paper",
    name: paper.title,
    aliases: [],
    year: entry.year,
    paper: {
      arxivId: entry.arxivId,
      title: paper.title,
      authors: paper.authors ?? [],
      venue: paper.venue,
      tier: paper.tier ?? "tier2",
      url: `https://arxiv.org/abs/${entry.arxivId}`,
      abstract: paper.abstract ?? "",
      provenance: {
        publisher: "arXiv.org e-Print archive",
        retrievedAt,
        releasedAt: paper.releasedAt ?? "",
      },
    },
  };
}

function methodNode(entry, retrievedAt) {
  if (entry.year === undefined || Number.isNaN(entry.year)) {
    fail(`entry ${entry.id} has no numeric year`);
  }
  const node = {
    id: entry.id,
    kind: "method",
    name: entry.name,
    aliases: entry.aliases ?? [],
    year: entry.year,
  };
  if (entry.parent) node.parent = entry.parent;
  const paper = entry.arxivId && entry.paper ? paperNode(entry, retrievedAt) : null;
  if (paper) node.paper = paper.paper;
  return node;
}

function edgeFrom(entry, raw) {
  if (!EDGE_TYPES.has(raw.type)) fail(`entry ${entry.id}: unknown edge type ${raw.type}`);
  if (!raw.to || !raw.axis || !raw.bottleneck || !raw.mechanism) {
    fail(`entry ${entry.id}: edge to ${raw.to ?? "?"} is missing to/axis/bottleneck/mechanism`);
  }
  const quote = (q) =>
    typeof q === "string" ? { text: q, sourceId: `arxiv:${entry.arxivId}`, locator: "abstract" } : q;
  const tradeoff = raw.tradeoff === undefined || raw.tradeoff === null ? null : quote(raw.tradeoff);
  const confidence = tradeoff === null ? 0.8 : 1.0;
  return {
    id: `${entry.id}--${raw.to}`,
    from: entry.id,
    to: raw.to,
    type: raw.type,
    strength: STRONG_TYPES.has(raw.type) ? "strong" : "weak",
    evidence: {
      bottleneck: quote(raw.bottleneck),
      mechanism: quote(raw.mechanism),
      tradeoff,
      confidence,
      confidenceBasis:
        tradeoff === null
          ? "Tradeoff quote is null; confidence 0.8."
          : "All three quotes are verbatim substrings of the to-paper abstract; confidence 1.0.",
    },
    axis: raw.axis,
  };
}

/**
 * Import entries from a directory of Markdown/MDX or a JSON array file.
 * @param {string} [inputPath]
 * @param {Date} [now]
 * @returns {{ nodes: Array<{ id: string, kind: string, name: string, aliases: string[], year: number, paper?: any, parent?: string }>, edges: Array<{ id: string, from: string, to: string, type: string, strength: string, evidence: { bottleneck: any, mechanism: any, tradeoff: any, confidence: number, confidenceBasis: string }, axis: string }>, skipped: Array<{ id: string, reason: string }> }}
 */
export function importKnowledgeMap(inputPath, now = new Date()) {
  const resolved = inputPath ?? process.env.LINEAGE_KM_PATH;
  if (!resolved) fail("no input path: pass one or set LINEAGE_KM_PATH");
  const retrievedAt = now.toISOString();
  const stat = statSync(resolved);
  let entries = [];
  if (stat.isDirectory()) {
    const files = readdirSync(resolved)
      .filter((f) => /\.(md|mdx)$/i.test(f))
      .sort();
    for (const file of files) {
      entries.push(entryFromMarkdown(file, readFileSync(path.join(resolved, file), "utf8")));
    }
  } else {
    const parsed = JSON.parse(readFileSync(resolved, "utf8"));
    if (!Array.isArray(parsed)) fail(`${resolved} is not a JSON array`);
    entries = parsed;
  }

  const nodes = [];
  const edges = [];
  const skipped = [];
  const seen = new Set();
  for (const entry of entries) {
    if (!entry.id || !entry.name) {
      skipped.push({ id: entry.id ?? "?", reason: "missing id or name" });
      continue;
    }
    if (seen.has(entry.id)) {
      skipped.push({ id: entry.id, reason: "duplicate id" });
      continue;
    }
    seen.add(entry.id);
    nodes.push(methodNode(entry, retrievedAt));
    const paper = paperNode(entry, retrievedAt);
    if (paper) {
      if (!nodes.some((n) => n.id === paper.id)) nodes.push(paper);
    } else if (entry.arxivId) {
      skipped.push({ id: entry.id, reason: "arxivId without paper metadata; no paper node emitted" });
    }
    for (const raw of entry.edges ?? []) edges.push(edgeFrom(entry, raw));
  }
  return { nodes, edges, skipped };
}

// CLI: node importers/knowledge-map.mjs <path> — prints the imported graph JSON.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const result = importKnowledgeMap(process.argv[2]);
  console.log(JSON.stringify(result, null, 2));
}

function fileURLToPath(url) {
  return new URL(url).pathname;
}
