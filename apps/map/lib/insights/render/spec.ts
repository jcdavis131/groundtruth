// The chart spec: everything the renderer needs to draw one insight chart,
// and nothing it would have to invent. Validated with zod; the same schema is
// published as JSON Schema at public/insights-chart.schema.json
// (spec.test.ts keeps the two equal).
//
// The renderer composes no prose and filters no rows. Headline, dek, axis
// titles and the universe line arrive as template output from the analysis
// side; every number is formatted at draw time by lib/brief/format.ts
// through one of four pinned formats. A value the publisher did not publish
// is null, never 0, and the renderer counts and lists it instead of
// plotting it.
//
// Invariants that a type cannot express are enforced in superRefine, so a
// broken spec fails validation instead of drawing something misleading:
//   - datum ids are unique;
//   - `subject` and every `labels.ids` entry name an existing datum;
//   - every provenance key a datum cites exists in `provenance`, and every
//     provenance record is cited by at least one datum (the source line is
//     built from exactly these records, so an orphan would be cited for
//     numbers the chart does not show);
//   - every `kind: "estimate"` record carries a non-empty `method`, so the
//     arithmetic behind a computed number can never be left off the image;
//   - an axis domain runs low to high;
//   - the headline fits every canvas that draws one at the smallest size on
//     that canvas's ladder (canvas.ts headlineMisfits). The renderer never
//     truncates, so a headline over the tightest canvas's capacity used to
//     surface as a throw the first time that canvas was drawn; it fails
//     here instead, naming the canvas. The 120-character max is only the
//     coarse bound a JSON Schema can state; capacity is measured in Geist.
//
// Objects are strict: an unknown key is an error in zod and in the JSON
// Schema alike (z.toJSONSchema emits additionalProperties: false). Nothing
// uses .default(), so the published schema describes exactly what an author
// writes; the renderer applies its own defaults (see `defaults` below).

import { z } from "zod";
import type { Provenance, SourceRef } from "@/lib/provenance/types";
import { headlineMisfits } from "./canvas";

/** The only number formats a v1 spec may name; each maps to one function in lib/brief/format.ts. */
export const FORMATS = ["pct", "signedPct", "num", "usd"] as const;
export const Format = z.enum(FORMATS);
export type Format = z.infer<typeof Format>;

const Text = z.string().min(1);
/** A value as published, or null when the publisher did not publish it (withheld, absent, a missing component). */
const Val = z.number().nullable();

const SourceRefSchema = z.strictObject({
  id: Text,
  name: Text,
  publisher: Text,
  url: z.url(),
  license: Text,
});

/** Mirrors Provenance in lib/provenance/types.ts field for field, so citation() takes a parsed record as it is. */
export const ProvenanceSchema = z.strictObject({
  source: SourceRefSchema,
  seriesId: Text.optional(),
  upstreamUrl: z.url().optional(),
  period: Text.optional(),
  releasedAt: Text.optional(),
  retrievedAt: Text,
  kind: z.enum(["published", "estimate", "snapshot"]),
  method: z.string().optional(),
  revision: Text.optional(),
  notes: z.array(Text).optional(),
});

const Axis = z.strictObject({
  /** Axis title, template output ("Goods-producing jobs, change 2019 to 2023"). */
  label: Text,
  format: Format,
  /** Decimal places for tick labels; 0 when absent. */
  digits: z.number().int().min(0).max(3).optional(),
  /** Fixed [low, high]; otherwise the data extent widened to the tick step. */
  domain: z.tuple([z.number(), z.number()]).optional(),
  /** Fixed gridline step in axis units (10 = a line every 10 points); otherwise "nice" ticks. */
  step: z.number().positive().optional(),
  /** Reference lines, e.g. 0 on a growth axis. */
  reference: z.array(z.strictObject({ value: z.number(), label: Text.optional() })).optional(),
});

const DatumBase = {
  /** Stable key (CBSA, FIPS, ticker); the tie-break of every sort. */
  id: Text,
  /** Short label drawn on the chart ("Austin"). */
  label: Text,
  /** Full name for the data table and the accessible description. */
  fullLabel: Text,
  href: Text.optional(),
  /** Keys into the spec's `provenance` record. */
  provenance: z.array(Text).min(1),
};

const BubbleDatum = z.strictObject({ ...DatumBase, x: Val, y: Val, size: Val });
const SlopeDatum = z.strictObject({ ...DatumBase, from: Val, to: Val });
const BarDatum = z.strictObject({ ...DatumBase, value: Val });
const LineDatum = z.strictObject({ ...DatumBase, series: z.array(z.strictObject({ t: Text, v: Val })).min(2) });

const Base = {
  version: z.literal(1),
  slug: z
    .string()
    .max(64)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  /** Template output; the renderer only wraps and steps the size down, never truncates. Must fit every canvas's smallest headline size (checkInvariants). */
  headline: Text.max(120),
  dek: Text.max(240).optional(),
  /** The date the numbers are as of; the renderer never reads a clock. */
  asOf: z.iso.date(),
  /** Who is compared, as template text ("150 largest US metros by 2019 covered employment"). */
  universe: Text,
  /** Datum id drawn in the signal colour. */
  subject: Text.optional(),
  /** Up to three short lines under the subject's label, already formatted by lib/brief/format.ts. */
  subjectNotes: z.array(Text).max(3).optional(),
  provenance: z.record(Text, ProvenanceSchema),
};

const Bubble = z.strictObject({
  ...Base,
  kind: z.literal("bubble"),
  x: Axis,
  y: Axis,
  /** Bubble area is proportional to |size|; a negative size is drawn as an outline, never a filled circle. */
  size: z.strictObject({ label: Text, format: Format, digits: z.number().int().min(0).max(3).optional(), negative: z.literal("outline") }),
  labels: z
    .strictObject({
      ids: z.array(Text).optional(),
      topBySize: z.number().int().min(0).max(40).optional(),
      extremes: z.boolean().optional(),
    })
    .optional(),
  data: z.array(BubbleDatum).min(3),
});

const Slope = z.strictObject({
  ...Base,
  kind: z.literal("slope"),
  /** Column headings, e.g. "2019" and "2025". */
  from: Text,
  to: Text,
  y: Axis,
  data: z.array(SlopeDatum).min(2),
});

const Bar = z.strictObject({
  ...Base,
  kind: z.literal("bar"),
  value: Axis,
  sort: z.enum(["desc", "asc"]).optional(),
  data: z.array(BarDatum).min(1),
});

const Line = z.strictObject({
  ...Base,
  kind: z.literal("line"),
  y: Axis,
  marks: z.array(z.enum(["max", "min", "last"])).optional(),
  data: z.array(LineDatum).min(1).max(4),
});

type AnySpec = z.infer<typeof Bubble> | z.infer<typeof Slope> | z.infer<typeof Bar> | z.infer<typeof Line>;

function axesOf(s: AnySpec): Array<[string, z.infer<typeof Axis>]> {
  switch (s.kind) {
    case "bubble":
      return [
        ["x", s.x],
        ["y", s.y],
      ];
    case "slope":
    case "line":
      return [["y", s.y]];
    case "bar":
      return [["value", s.value]];
  }
}

function checkInvariants(s: AnySpec, ctx: z.RefinementCtx): void {
  const ids = new Set<string>();
  const cited = new Set<string>();
  s.data.forEach((d, i) => {
    if (ids.has(d.id)) ctx.addIssue({ code: "custom", path: ["data", i, "id"], message: `duplicate datum id "${d.id}"` });
    ids.add(d.id);
    d.provenance.forEach((key, j) => {
      cited.add(key);
      if (!Object.hasOwn(s.provenance, key)) ctx.addIssue({ code: "custom", path: ["data", i, "provenance", j], message: `datum "${d.id}" cites unknown provenance "${key}"` });
    });
  });
  for (const m of headlineMisfits(s.headline)) {
    ctx.addIssue({
      code: "custom",
      path: ["headline"],
      message: `headline does not fit the ${m.canvas} canvas: even at ${m.size} px, the smallest size on its ${m.ladder.join("/")} px ladder, it needs more than ${m.maxLines} lines of ${m.width} px or has a word wider than ${m.width} px; shorten it`,
    });
  }
  if (s.subject !== undefined && !ids.has(s.subject)) ctx.addIssue({ code: "custom", path: ["subject"], message: `subject "${s.subject}" is not a datum id` });
  if (s.subjectNotes !== undefined && s.subject === undefined) ctx.addIssue({ code: "custom", path: ["subjectNotes"], message: "subjectNotes without a subject" });
  if (s.kind === "bubble") {
    (s.labels?.ids ?? []).forEach((id, i) => {
      if (!ids.has(id)) ctx.addIssue({ code: "custom", path: ["labels", "ids", i], message: `label id "${id}" is not a datum id` });
    });
  }
  for (const [key, p] of Object.entries(s.provenance)) {
    if (p.kind === "estimate" && !(p.method ?? "").trim()) ctx.addIssue({ code: "custom", path: ["provenance", key, "method"], message: `estimate "${key}" has no method` });
    if (!cited.has(key)) ctx.addIssue({ code: "custom", path: ["provenance", key], message: `provenance "${key}" is not cited by any datum` });
  }
  for (const [name, axis] of axesOf(s)) {
    if (axis.domain && !(axis.domain[0] < axis.domain[1])) ctx.addIssue({ code: "custom", path: [name, "domain"], message: "axis domain must run low to high" });
  }
}

export const ChartSpec = z
  .discriminatedUnion("kind", [Bubble, Slope, Bar, Line])
  .superRefine(checkInvariants)
  .meta({
    title: "Embedding Atlas insight chart spec",
    description:
      "One chart for lib/insights/render: kind, axes, data rows with null for anything not published, and the provenance every row cites. Invariants beyond this schema (unique ids, subject and labels referencing data, every cited provenance key present and every record cited, an estimate always carrying its method, a headline that every canvas can set at the smallest size on its headline ladder) are enforced by lib/insights/render/spec.ts.",
  });

export type ChartSpec = z.infer<typeof ChartSpec>;
export type BubbleSpec = z.infer<typeof Bubble>;
export type SlopeSpec = z.infer<typeof Slope>;
export type BarSpec = z.infer<typeof Bar>;
export type LineSpec = z.infer<typeof Line>;
export type AxisSpec = z.infer<typeof Axis>;
export type SpecProvenance = z.infer<typeof ProvenanceSchema>;

/**
 * A parsed record as the lib/provenance interface it mirrors, for citation()
 * and the CSV footer. No cast: this stops compiling the day the schema and
 * the interface drift apart.
 */
export function toProvenance(p: SpecProvenance): Provenance {
  const source: SourceRef = p.source;
  return { ...p, source };
}

/** Renderer defaults for the optional fields, in one place. */
export const defaults = {
  digits: 0,
  topBySize: 16,
  extremes: true,
  sort: "desc" as const,
  marks: ["max", "last"] as Array<"max" | "min" | "last">,
};

/** Validate unknown input; throws a ZodError listing every violated rule. */
export function parseChartSpec(input: unknown): ChartSpec {
  return ChartSpec.parse(input);
}

/** Byte-wise string order: the same on every machine, unlike localeCompare. */
export function byteCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** JSON with object keys sorted at every level and undefined dropped: the input to every hash of a spec. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
}

/**
 * The spec in canonical order: data by id, each datum's provenance keys
 * sorted, labels.ids sorted, references by value. Order in the input carries
 * no meaning (draw order and label priority are derived, never taken from
 * array position), so every renderer entry point starts here and a reordered
 * spec renders the same bytes.
 */
export function canonicalSpec<S extends ChartSpec>(spec: S): S {
  const refs = (a: AxisSpec): AxisSpec => (a.reference ? { ...a, reference: [...a.reference].sort((p, q) => p.value - q.value || byteCompare(p.label ?? "", q.label ?? "")) } : a);
  const data = [...spec.data].map((d) => ({ ...d, provenance: [...d.provenance].sort(byteCompare) })).sort((a, b) => byteCompare(a.id, b.id));
  const provenance = Object.fromEntries(Object.keys(spec.provenance).sort(byteCompare).map((k) => [k, spec.provenance[k]]));
  switch (spec.kind) {
    case "bubble":
      return { ...spec, provenance, x: refs(spec.x), y: refs(spec.y), labels: spec.labels?.ids ? { ...spec.labels, ids: [...spec.labels.ids].sort(byteCompare) } : spec.labels, data } as S;
    case "slope":
    case "line":
      return { ...spec, provenance, y: refs(spec.y), data } as S;
    case "bar":
      return { ...spec, provenance, value: refs(spec.value), data } as S;
  }
}
