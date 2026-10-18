"use client";
// Main-thread client for lib/globe/sat.worker.ts.
//
// The satellites style asks this client for positions; the globe's per-frame
// hook feeds it mission time. It asks the worker for a fresh solution at
// most once a second, or immediately after a time jump (timeline scrub),
// and keeps the last answer until the next one lands. Without Worker
// support (or if the worker fails) `active` stays false and the style falls
// back to propagating on the main thread.

import type { OMMJsonObject } from "@/lib/vendor/satellite";
import type { SatWorkerIn, SatWorkerOut } from "./sat.worker";

export type LonLatAlt = [number, number, number];

const CADENCE_MS = 1000;
const JUMP_MS = 2500;

class SatWorkerClient {
  private worker: Worker | null = null;
  private failed = false;
  private loaded = 0;
  private cache = new Map<string, LonLatAlt>();
  private cacheTime = 0;
  private requestedTime = 0;
  private pending = false;
  private queued: number | null = null;
  private enabled = true;

  /** True once the worker has answered at least once for the current catalogue. */
  get active(): boolean {
    return !!this.worker && !this.failed && this.loaded > 0 && this.cacheTime > 0;
  }

  get size(): number {
    return this.loaded;
  }

  private ensure(): boolean {
    if (this.worker) return true;
    if (this.failed || typeof Worker === "undefined") return false;
    try {
      this.worker = new Worker(new URL("./sat.worker.ts", import.meta.url), { type: "module" });
    } catch {
      this.failed = true;
      return false;
    }
    this.worker.onmessage = (e: MessageEvent<SatWorkerOut>) => {
      const m = e.data;
      if (m.type === "loaded") {
        this.loaded = m.count;
        return;
      }
      if (m.type === "pos") {
        const next = new Map<string, LonLatAlt>();
        const d = m.data;
        for (let i = 0; i < m.ids.length; i++) {
          next.set(m.ids[i], [d[i * 3], d[i * 3 + 1], d[i * 3 + 2]]);
        }
        this.cache = next;
        this.cacheTime = m.t;
        this.pending = false;
        if (this.queued != null) {
          const t = this.queued;
          this.queued = null;
          this.request(t);
        }
      }
    };
    this.worker.onerror = () => {
      this.failed = true;
      this.worker?.terminate();
      this.worker = null;
      this.cacheTime = 0;
    };
    return true;
  }

  /** Replace the catalogue. Called by the satellites layer after each fetch. */
  load(sats: Array<{ id: string; omm: OMMJsonObject }>, timeMs: number) {
    if (!this.ensure() || !this.worker) return;
    this.loaded = 0;
    this.cacheTime = 0;
    this.pending = false;
    this.queued = null;
    this.post({ type: "load", sats });
    this.request(timeMs);
  }

  /** Called every frame with mission time; throttles itself. */
  tick(timeMs: number) {
    if (!this.enabled || !this.worker || this.failed || this.loaded === 0) return;
    const jumped = Math.abs(timeMs - this.requestedTime) > JUMP_MS + CADENCE_MS;
    if (!jumped && timeMs - this.requestedTime < CADENCE_MS) return;
    this.request(timeMs);
  }

  setEnabled(on: boolean) {
    this.enabled = on;
  }

  position(id: string): LonLatAlt | undefined {
    return this.cache.get(id);
  }

  private request(timeMs: number) {
    if (!this.worker) return;
    if (this.pending) {
      this.queued = timeMs;
      return;
    }
    this.pending = true;
    this.requestedTime = timeMs;
    this.post({ type: "tick", t: timeMs });
  }

  private post(msg: SatWorkerIn) {
    this.worker?.postMessage(msg);
  }
}

export const satWorker = new SatWorkerClient();
