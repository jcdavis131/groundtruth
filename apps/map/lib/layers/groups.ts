// Which layers a phone shows first.
//
// Sixteen feeds is a wall on a 390 px screen, so the Layers panel on a phone
// opens with the ones this visitor is actually using: the layers their lens
// switched on, plus anything they have turned on since. The rest stay one tap
// away behind "More layers" — nothing is hidden, only deferred.

import type { LayerDefinition, LayerId } from "./types";

export interface LayerGroups {
  /** Shown immediately: the lens's feeds and anything already on. */
  primary: LayerDefinition[];
  /** Behind the "More layers" disclosure. */
  more: LayerDefinition[];
}

export interface GroupOptions {
  /** Layer ids the active lens owns. Empty or absent when no lens is chosen. */
  lens?: readonly LayerId[];
  /** Current on/off state, as the globe store holds it. */
  on?: Partial<Record<LayerId, boolean>>;
}

/**
 * Split the registry into what to show now and what to defer. Registry order
 * is preserved inside both groups so the list never reshuffles as layers are
 * toggled: a layer switched off stays where it was until the panel is reopened
 * by the caller's own state, not mid-interaction.
 */
export function groupLayers(all: readonly LayerDefinition[], opts: GroupOptions = {}): LayerGroups {
  const lens = new Set(opts.lens ?? []);
  const on = opts.on ?? {};
  const wanted = (l: LayerDefinition) => lens.has(l.id) || on[l.id] === true;
  let primary = all.filter(wanted);
  // Nothing to lead with (no lens, everything off): fall back to the layers the
  // app boots with, then to the whole registry rather than an empty panel.
  if (primary.length === 0) primary = all.filter((l) => l.defaultEnabled);
  if (primary.length === 0) return { primary: [...all], more: [] };
  const shown = new Set(primary.map((l) => l.id));
  return { primary, more: all.filter((l) => !shown.has(l.id)) };
}

/** Enabled layers whose last fetch failed, for the panel's one-line problem list. */
export function erroringLayers(
  all: readonly LayerDefinition[],
  on: Partial<Record<LayerId, boolean>>,
  status: Partial<Record<LayerId, { error?: string }>>,
): { layer: LayerDefinition; error: string }[] {
  const out: { layer: LayerDefinition; error: string }[] = [];
  for (const l of all) {
    const err = on[l.id] ? status[l.id]?.error : undefined;
    if (err) out.push({ layer: l, error: err });
  }
  return out;
}
