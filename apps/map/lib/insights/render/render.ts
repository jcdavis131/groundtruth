// The renderer's entry point: a parsed ChartSpec, a canvas and a theme in;
// the scene and its SVG out. Same spec, same canvas, same theme: same bytes,
// whatever order the spec's rows, provenance keys and label ids arrive in.
//
// Callers validate untrusted JSON with parseChartSpec (spec.ts) first; this
// module assumes a spec that passed, so its invariants (unique ids, a subject
// that exists, every cited record present) already hold.
//
// Bubble charts are drawn. Slope, bar and line specs validate, but this
// renderer has no layout for them and refuses them by name rather than draw
// an empty frame that looks like a finished chart.

import type { CanvasId } from "./canvas";
import { layoutBubble, type BubbleLayout } from "./charts/bubble";
import { frameScene } from "./frame";
import type { Scene } from "./scene";
import type { ChartSpec } from "./spec";
import { toSvg } from "./svg";
import type { Theme } from "./tokens";

export interface Rendered {
  svg: string;
  scene: Scene;
  layout: BubbleLayout;
}

export function renderChart(spec: ChartSpec, canvas: CanvasId, theme: Theme): Rendered {
  switch (spec.kind) {
    case "bubble": {
      const layout = layoutBubble(spec, canvas, theme);
      const scene = frameScene(layout.frame, layout.nodes);
      return { svg: toSvg(scene, { inline: layout.frame.canvas.inline, canvas: layout.frame.canvas.id }), scene, layout };
    }
    case "slope":
    case "bar":
    case "line":
      throw new Error(`chart "${spec.slug}": the renderer draws bubble charts only; it has no layout for a ${spec.kind} chart`);
  }
}

/** The SVG document for one spec on one canvas in one theme. */
export function renderSvg(spec: ChartSpec, canvas: CanvasId, theme: Theme): string {
  return renderChart(spec, canvas, theme).svg;
}
