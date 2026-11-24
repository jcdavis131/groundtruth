// Deterministic ideas/eval statistics (SPEC C5). Pure functions over the
// seed graph; no LLM, no network. Every score is computed from graph facts
// only, so the same idea against the same graph always scores the same.

import { loadLineage, type LineageIndex } from "./load";
import { tokenize } from "./search";
import {
  STRONG_EDGE_TYPES,
  type BottleneckAxis,
  type LineageEdge,
  type LineageNode,
  type Quote,
} from "./schema";

export const SCORE_WEIGHTS = {
  novelty: 0.2,
  feasibility: 0.25,
  significance: 0.2,
  validity: 0.2,
  clarity: 0.15,
} as const;

export interface IdeaScores {
  novelty: number;
  feasibility: number;
  significance: number;
  validity: number;
  clarity: number;
}

export interface IdeaEval {
  idea: string;
  scores: IdeaScores;
  weights: typeof SCORE_WEIGHTS;
  anti_stacking_penalty: number;
  veto: string | null;
  overall: number;
  grounded_methods: string[];
  evidence: string[];
}

export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

function nodeTokenSet(node: LineageNode): Set<string> {
  return new Set(
    tokenize(
      [node.name, ...node.aliases, node.paper?.title ?? "", node.paper?.abstract ?? ""].join(" "),
    ),
  );
}

/** Words that open a sentence but are not method names. */
const TITLE_STOP = new Set([
  "the", "a", "an", "this", "that", "these", "those", "we", "our", "it", "its",
  "in", "on", "for", "with", "by", "to", "and", "but", "if", "when", "new",
  "combine", "improve", "extend", "replace", "transfer", "revisit", "supersede",
  "build", "using", "via", "from", "into", "over", "under", "between",
]);

/**
 * The token spellings a method can be named by: its name, its aliases, and
 * its id. A single-token all-lowercase alias ("attention", "transformer")
 * is too generic to name a method — every idea about attention would
 * ground to it — so those spellings are dropped. Multi-token aliases and
 * acronyms / CamelCase aliases ("GQA", "FlashAttention") are kept.
 */
function methodSpellings(method: LineageNode): string[][] {
  const spellings = [
    tokenize(method.name),
    ...method.aliases
      .filter((a) => tokenize(a).length >= 2 || /[A-Z]/.test(a))
      .map((a) => tokenize(a)),
    tokenize(method.id.replace(/-/g, " ")),
  ];
  return spellings.filter((ts) => ts.length > 0);
}

export interface Mentions {
  /** Method ids named in the idea that exist in the graph. */
  grounded: string[];
  /** Title-Case phrases that look like method names but match no node. */
  unknown: string[];
}

/**
 * Find the methods an idea names. A method counts as named when every
 * token of its name, one of its aliases, or its id is a token of the idea.
 * Unknown mentions are multi-word Title-Case phrases (or bare acronyms)
 * that match no graph method — the "unknown methods lower feasibility"
 * half of the SPEC definition.
 */
export function extractMentions(
  idea: string,
  index: LineageIndex = loadLineage(),
): Mentions {
  const ideaTokens = new Set(tokenize(idea));
  const grounded: string[] = [];
  for (const method of index.methodsById.values()) {
    if (
      methodSpellings(method).some((ts) => ts.every((t) => ideaTokens.has(t)))
    ) {
      grounded.push(method.id);
    }
  }
  grounded.sort();

  const groundedTokenSets = grounded.map((id) => {
    const m = index.methodsById.get(id)!;
    return new Set([
      ...tokenize(m.name),
      ...m.aliases.flatMap((a) => tokenize(a)),
    ]);
  });
  const unknown: string[] = [];
  const phraseRe = /(?:[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})+|[A-Z]{2,})/g;
  for (const match of idea.matchAll(phraseRe)) {
    // A sentence-opening verb ("Combine Quantum Flux Attention") is one
    // regex match: strip leading stop words and judge the remainder, so
    // the method name inside is still seen.
    let words = match[0].split(/\s+/);
    while (words.length > 0 && TITLE_STOP.has(words[0].toLowerCase())) {
      words.shift();
    }
    if (words.length < 2 && !(words.length === 1 && /^[A-Z]{2,}$/.test(words[0] ?? ""))) {
      continue;
    }
    const phrase = words.join(" ");
    const phraseTokens = new Set(tokenize(phrase));
    const covered = groundedTokenSets.some(
      (ts) => [...phraseTokens].every((t) => ts.has(t)),
    );
    if (covered) continue;
    if (!unknown.includes(phrase)) unknown.push(phrase);
  }
  return { grounded, unknown };
}

function hasEdgeBetween(a: string, b: string, index: LineageIndex): boolean {
  return (
    (index.edgesFrom.get(a) ?? []).some((e) => e.to === b) ||
    (index.edgesFrom.get(b) ?? []).some((e) => e.to === a)
  );
}

function hasStrongInEdge(id: string, index: LineageIndex): boolean {
  return (index.edgesTo.get(id) ?? []).some((e) =>
    (STRONG_EDGE_TYPES as readonly string[]).includes(e.type),
  );
}

/** 1 − max Jaccard(idea, any node name+aliases+abstract), +0.1 for an unexplored method pair, capped at 1. */
export function noveltyScore(
  idea: string,
  index: LineageIndex = loadLineage(),
): { score: number; maxJaccard: number; duplicateOf: string | null; unexploredBonus: number } {
  const ideaTokens = new Set(tokenize(idea));
  let maxJaccard = 0;
  let duplicateOf: string | null = null;
  for (const node of index.graph.nodes) {
    const j = jaccard(ideaTokens, nodeTokenSet(node));
    if (j > maxJaccard) {
      maxJaccard = j;
      duplicateOf = j >= 0.8 ? node.id : null;
    }
  }
  const { grounded } = extractMentions(idea, index);
  let unexploredBonus = 0;
  for (let i = 0; i < grounded.length && unexploredBonus === 0; i++) {
    for (let j = i + 1; j < grounded.length; j++) {
      if (!hasEdgeBetween(grounded[i], grounded[j], index)) {
        unexploredBonus = 0.1;
        break;
      }
    }
  }
  const score = Math.min(1, Math.max(0, 1 - maxJaccard + unexploredBonus));
  return { score, maxJaccard, duplicateOf, unexploredBonus };
}

/** Fraction of named methods that exist in the graph and have ≥1 strong in-edge. Unknown mentions lower it. */
export function feasibilityScore(
  idea: string,
  index: LineageIndex = loadLineage(),
): number {
  const { grounded, unknown } = extractMentions(idea, index);
  const total = grounded.length + unknown.length;
  if (total === 0) return 0;
  const established = grounded.filter((id) => hasStrongInEdge(id, index)).length;
  return established / total;
}

/** Mean normalised out-degree of the named methods' lineages (central lineages score higher). */
export function significanceScore(
  idea: string,
  index: LineageIndex = loadLineage(),
): number {
  const { grounded } = extractMentions(idea, index);
  if (grounded.length === 0) return 0;
  let maxOut = 0;
  for (const m of index.methodsById.values()) {
    maxOut = Math.max(maxOut, index.edgesFrom.get(m.id)?.length ?? 0);
  }
  if (maxOut === 0) return 0;
  const vals = grounded.map(
    (id) => (index.edgesFrom.get(id)?.length ?? 0) / maxOut,
  );
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

const REPLACE_RE =
  /\breplac(?:e|es|ing)\s+(?:the\s+)?([a-z0-9][a-z0-9\s-]*?)\s+with\s+(?:the\s+)?([a-z0-9][a-z0-9\s-]*?)(?:[.,;]|$)/gi;
const REPLACED_BY_RE =
  /\b([a-z0-9][a-z0-9\s-]*?)\s+(?:is\s+)?replaced\s+by\s+(?:the\s+)?([a-z0-9][a-z0-9\s-]*?)(?:[.,;]|$)/gi;
const EXTENDS_RE =
  /\b([a-z0-9][a-z0-9\s-]*?)\s+(?:extends|builds\s+on)\s+(?:the\s+)?([a-z0-9][a-z0-9\s-]*?)(?:[.,;]|$)/gi;

/** Resolve a free-text span to a grounded method id, if it names one. */
function resolveSpan(
  span: string,
  grounded: string[],
  index: LineageIndex,
): string | null {
  const spanTokens = new Set(tokenize(span));
  if (spanTokens.size === 0) return null;
  for (const id of grounded) {
    const m = index.methodsById.get(id)!;
    if (
      methodSpellings(m).some((ts) => ts.every((t) => spanTokens.has(t)))
    ) {
      return id;
    }
  }
  return null;
}

/**
 * 1 if every named method pair is year-consistent with the proposed
 * direction and no `replaces` edge already supersedes the proposal's
 * target; 0.5 if a `replaces` edge already supersedes the target; 0 if
 * the idea contradicts an existing edge's direction (e.g. replacing a
 * newer method with an older one, or extending a newer method from an
 * older one in reverse year order).
 */
export function validityScore(
  idea: string,
  index: LineageIndex = loadLineage(),
): number {
  const { grounded } = extractMentions(idea, index);
  if (grounded.length === 0) return 0;

  // Contradiction: "replace A with B" / "A replaced by B" where B is older than A.
  const pairs: [string, string][] = [];
  for (const re of [REPLACE_RE, REPLACED_BY_RE]) {
    re.lastIndex = 0;
    for (const m of idea.matchAll(re)) {
      const target = resolveSpan(m[1], grounded, index);
      const replacement = resolveSpan(m[2], grounded, index);
      if (target && replacement) pairs.push([target, replacement]);
    }
  }
  for (const [target, replacement] of pairs) {
    const tYear = index.methodsById.get(target)!.year;
    const rYear = index.methodsById.get(replacement)!.year;
    if (rYear < tYear) return 0;
  }
  // Contradiction: "A extends / builds on B" where A is older than B.
  EXTENDS_RE.lastIndex = 0;
  for (const m of idea.matchAll(EXTENDS_RE)) {
    const a = resolveSpan(m[1], grounded, index);
    const b = resolveSpan(m[2], grounded, index);
    if (a && b) {
      const aYear = index.methodsById.get(a)!.year;
      const bYear = index.methodsById.get(b)!.year;
      if (aYear < bYear) return 0;
    }
  }
  // 0.5: a `replaces` edge already supersedes one of the named targets.
  for (const [target] of pairs) {
    const superseded = (index.edgesTo.get(target) ?? []).some(
      (e) => e.type === "replaces",
    );
    if (superseded) return 0.5;
  }
  return 1;
}

/** 1 − (unresolved mentions / total mentions); 0 if the idea names no method. */
export function clarityScore(
  idea: string,
  index: LineageIndex = loadLineage(),
): number {
  const { grounded, unknown } = extractMentions(idea, index);
  const total = grounded.length + unknown.length;
  if (total === 0) return 0;
  return 1 - unknown.length / total;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** Full deterministic eval of one idea (SPEC C5). One-sided vetoes only lower the score, never raise it. */
export function scoreIdea(
  idea: string,
  index: LineageIndex = loadLineage(),
): IdeaEval {
  const { grounded, unknown } = extractMentions(idea, index);
  const novelty = noveltyScore(idea, index);
  const scores: IdeaScores = {
    novelty: round4(novelty.score),
    feasibility: round4(feasibilityScore(idea, index)),
    significance: round4(significanceScore(idea, index)),
    validity: round4(validityScore(idea, index)),
    clarity: round4(clarityScore(idea, index)),
  };
  const weighted =
    scores.novelty * SCORE_WEIGHTS.novelty +
    scores.feasibility * SCORE_WEIGHTS.feasibility +
    scores.significance * SCORE_WEIGHTS.significance +
    scores.validity * SCORE_WEIGHTS.validity +
    scores.clarity * SCORE_WEIGHTS.clarity;
  const k = grounded.length + unknown.length;
  const penalty = round4(0.05 * Math.max(0, k - 3));
  let overall = Math.min(1, Math.max(0, weighted - penalty));
  let veto: string | null = null;
  if (novelty.duplicateOf) {
    veto = `duplicate_of:${novelty.duplicateOf}`;
    overall = Math.min(overall, 0.3);
  } else if (grounded.length === 0) {
    veto = "ungrounded";
    overall = Math.min(overall, 0.2);
  }
  const evidence: string[] = [];
  for (const id of grounded) {
    for (const e of [...(index.edgesFrom.get(id) ?? []), ...(index.edgesTo.get(id) ?? [])]) {
      if (!evidence.includes(e.id)) evidence.push(e.id);
    }
  }
  evidence.sort();
  return {
    idea,
    scores,
    weights: SCORE_WEIGHTS,
    anti_stacking_penalty: penalty,
    veto,
    overall: round4(overall),
    grounded_methods: grounded,
    evidence: evidence.slice(0, 20),
  };
}

// ---------------------------------------------------------------------------
// Idea generation (SPEC C5): four deterministic strategies. A strategy with
// no candidate returns no ideas for that strategy, never filler.
// ---------------------------------------------------------------------------

export type IdeaStrategy = "gap-fill" | "transfer" | "supersede" | "revisit";

export interface GeneratedIdea {
  strategy: IdeaStrategy;
  title: string;
  proposal: string;
  evidence_certificate: { edges: string[]; quotes: Quote[] };
  eval: IdeaEval;
}

function quotesFor(edges: LineageEdge[]): Quote[] {
  const out: Quote[] = [];
  const seen = new Set<string>();
  for (const e of edges) {
    for (const q of [
      e.evidence.bottleneck,
      e.evidence.mechanism,
      ...(e.evidence.tradeoff ? [e.evidence.tradeoff] : []),
    ]) {
      if (!seen.has(q.text)) {
        seen.add(q.text);
        out.push(q);
      }
    }
  }
  return out;
}

function sortedEdges(edges: LineageEdge[]): LineageEdge[] {
  return [...edges].sort((a, b) => (a.id < b.id ? -1 : 1));
}

function gapFillIdeas(index: LineageIndex, focusAxis?: string): GeneratedIdea[] {
  const byAxis = new Map<BottleneckAxis, Set<string>>();
  for (const e of index.graph.edges) {
    const set = byAxis.get(e.axis) ?? new Set<string>();
    set.add(e.from);
    set.add(e.to);
    byAxis.set(e.axis, set);
  }
  const out: GeneratedIdea[] = [];
  const axes = [...byAxis.keys()].sort();
  for (const axis of axes) {
    if (focusAxis && axis !== focusAxis) continue;
    const methods = [...byAxis.get(axis)!]
      .filter((id) => index.methodsById.has(id))
      .sort();
    for (let i = 0; i < methods.length && out.length < 5; i++) {
      for (let j = i + 1; j < methods.length && out.length < 5; j++) {
        const a = methods[i];
        const b = methods[j];
        if (hasEdgeBetween(a, b, index)) continue;
        const ma = index.methodsById.get(a)!;
        const mb = index.methodsById.get(b)!;
        const ea = sortedEdges(
          [...(index.edgesFrom.get(a) ?? []), ...(index.edgesTo.get(a) ?? [])].filter(
            (e) => e.axis === axis,
          ),
        )[0];
        const eb = sortedEdges(
          [...(index.edgesFrom.get(b) ?? []), ...(index.edgesTo.get(b) ?? [])].filter(
            (e) => e.axis === axis,
          ),
        )[0];
        const cited = [ea, eb].filter(Boolean) as LineageEdge[];
        if (cited.length === 0) continue;
        const proposal =
          `Combine ${ma.name} and ${mb.name} to address the ${axis} bottleneck: ` +
          `use ${ma.name}'s mechanism alongside ${mb.name}, where no direct edge exists between them yet.`;
        out.push({
          strategy: "gap-fill",
          title: `Combine ${ma.name} with ${mb.name} (${axis})`,
          proposal,
          evidence_certificate: {
            edges: cited.map((e) => e.id),
            quotes: quotesFor(cited),
          },
          eval: scoreIdea(proposal, index),
        });
      }
    }
  }
  return out;
}

function transferIdeas(index: LineageIndex, focusAxis?: string): GeneratedIdea[] {
  const out: GeneratedIdea[] = [];
  const adapts = sortedEdges(
    index.graph.edges.filter((e) => e.type === "adapts"),
  );
  for (const e of adapts) {
    if (out.length >= 5) break;
    if (focusAxis && e.axis !== focusAxis) continue;
    const a = index.methodsById.get(e.from);
    const b = index.methodsById.get(e.to);
    if (!a || !b) continue;
    // A method in another lineage that shares this axis but has no edge to A.
    const candidates = [...index.methodsById.values()]
      .filter((m) => m.id !== e.from && m.id !== e.to)
      .filter((m) =>
        [...(index.edgesFrom.get(m.id) ?? []), ...(index.edgesTo.get(m.id) ?? [])].some(
          (x) => x.axis === e.axis,
        ),
      )
      .filter((m) => !hasEdgeBetween(e.from, m.id, index))
      .sort((x, y) => (x.id < y.id ? -1 : 1));
    const c = candidates[0];
    if (!c) continue;
    const ce = sortedEdges(
      [...(index.edgesFrom.get(c.id) ?? []), ...(index.edgesTo.get(c.id) ?? [])].filter(
        (x) => x.axis === e.axis,
      ),
    )[0];
    const cited = ce ? [e, ce] : [e];
    const proposal =
      `Transfer ${a.name}'s adaptation, as used in ${b.name}, to ${c.name} ` +
      `to address its ${e.axis} bottleneck.`;
    out.push({
      strategy: "transfer",
      title: `Transfer ${a.name} to ${c.name} (${e.axis})`,
      proposal,
      evidence_certificate: {
        edges: cited.map((x) => x.id),
        quotes: quotesFor(cited),
      },
      eval: scoreIdea(proposal, index),
    });
  }
  return out;
}

function supersedeIdeas(index: LineageIndex): GeneratedIdea[] {
  const out: GeneratedIdea[] = [];
  const ranked = [...index.methodsById.values()]
    .map((m) => ({
      method: m,
      improvesIn: sortedEdges(
        (index.edgesTo.get(m.id) ?? []).filter((e) => e.type === "improves"),
      ),
    }))
    .filter(
      ({ method, improvesIn }) =>
        improvesIn.length >= 2 &&
        !(index.edgesFrom.get(method.id) ?? []).some((e) => e.type === "replaces"),
    )
    .sort(
      (x, y) =>
        y.improvesIn.length - x.improvesIn.length ||
        (x.method.id < y.method.id ? -1 : 1),
    )
    .slice(0, 5);
  for (const { method, improvesIn } of ranked) {
    const cited = improvesIn.slice(0, 3);
    const proposal =
      `Supersede ${method.name}: it already attracts ${improvesIn.length} improvements ` +
      `and no method has replaced it yet; build a successor that keeps its mechanism while removing its bottleneck.`;
    out.push({
      strategy: "supersede",
      title: `Supersede ${method.name}`,
      proposal,
      evidence_certificate: {
        edges: cited.map((e) => e.id),
        quotes: quotesFor(cited),
      },
      eval: scoreIdea(proposal, index),
    });
  }
  return out;
}

function revisitIdeas(index: LineageIndex): GeneratedIdea[] {
  const out: GeneratedIdea[] = [];
  // Lineage = all methods sharing one root ancestor (parent chain).
  const rootOf = (id: string): string => {
    let cur = index.methodsById.get(id)!;
    while (cur.parent && index.methodsById.has(cur.parent)) {
      cur = index.methodsById.get(cur.parent)!;
    }
    return cur.id;
  };
  const byRoot = new Map<string, LineageNode[]>();
  for (const m of index.methodsById.values()) {
    const root = rootOf(m.id);
    const list = byRoot.get(root) ?? [];
    list.push(m);
    byRoot.set(root, list);
  }
  const compares = sortedEdges(
    index.graph.edges.filter(
      (e) =>
        e.type === "compares" &&
        (index.nodesById.get(e.to)?.year ?? 0) >= 2023,
    ),
  );
  for (const e of compares) {
    if (out.length >= 5) break;
    const older = index.nodesById.get(e.from)!;
    const newer = index.nodesById.get(e.to)!;
    if (older.kind !== "method" || newer.kind !== "method") continue;
    const lineage = byRoot.get(rootOf(older.id)) ?? [];
    const oldestYear = Math.min(...lineage.map((m) => m.year));
    if (older.year !== oldestYear) continue;
    const proposal =
      `Revisit ${older.name}: ${newer.name} (${newer.year}) was compared against it recently; ` +
      `re-examine ${older.name}'s original tradeoff with modern ${e.axis} methods.`;
    out.push({
      strategy: "revisit",
      title: `Revisit ${older.name} after ${newer.name}`,
      proposal,
      evidence_certificate: { edges: [e.id], quotes: quotesFor([e]) },
      eval: scoreIdea(proposal, index),
    });
  }
  return out;
}

export interface IdeaGeneration {
  strategies: { strategy: IdeaStrategy; ideas: GeneratedIdea[] }[];
  ideas: GeneratedIdea[];
}

export function generateIdeas(
  opts: { excludeDirections?: string[]; focusDimension?: string } = {},
  index: LineageIndex = loadLineage(),
): IdeaGeneration {
  const excluded = new Set(opts.excludeDirections ?? []);
  const all: { strategy: IdeaStrategy; ideas: GeneratedIdea[] }[] = [
    { strategy: "gap-fill", ideas: gapFillIdeas(index, opts.focusDimension) },
    { strategy: "transfer", ideas: transferIdeas(index, opts.focusDimension) },
    { strategy: "supersede", ideas: supersedeIdeas(index) },
    { strategy: "revisit", ideas: revisitIdeas(index) },
  ];
  const filtered = all.map((s) =>
    excluded.has(s.strategy) ? { strategy: s.strategy, ideas: [] } : s,
  );
  return { strategies: filtered, ideas: filtered.flatMap((s) => s.ideas) };
}
