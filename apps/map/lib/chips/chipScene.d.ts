// Typed surface for the framework-free chip scene (./chipScene.js).
import type { ChipId, DepthLevel } from "./chipData";

export interface ChipSceneOpts {
  chip?: ChipId;
  level?: DepthLevel;
  reducedMotion?: boolean;
  /** Fired when the user taps a part (or empty space -> null). */
  onPin?: (partId: string | null) => void;
  /** Fired when the data-flow caption step advances. */
  onFlowStep?: (step: number) => void;
}

export interface TourCam {
  phi: number;
  rScale?: number;
  cy?: number;
  explode?: number;
}

export interface ChipScene {
  readonly chip: ChipId;
  setChip(ch: ChipId): void;
  setExplode(t: number): void;
  setLevel(l: DepthLevel): void;
  getLevel(): DepthLevel;
  setFlow(on: boolean): void;
  setXray(on: boolean): void;
  setLabels(on: boolean): void;
  pick(clientX: number, clientY: number): string | null;
  /** Pin a part: spotlights it and pulses; null clears. */
  pin(partId: string | null): void;
  /** Dim everything except these parts; null/empty clears. */
  spotlight(partIds: string[] | null): void;
  /** Ease the camera to a tour waypoint; instant snaps (also used for reduced motion). */
  tourTo(cam: TourCam, instant?: boolean): void;
  stopTour(): void;
  setPaused(paused: boolean): void;
  resize(): void;
  dispose(): void;
}

/**
 * Creates the scene. THREE is injected (loaded client-side from the vendored
 * script) so this module never touches window at import time. Returns null if
 * WebGL is unavailable.
 */
export function createChipScene(
  canvas: HTMLCanvasElement,
  labelLayer: HTMLElement,
  THREE: unknown,
  opts?: ChipSceneOpts,
): ChipScene | null;
