"use client";
// Main-thread client for lib/water/turbidity.worker.ts. One request at a
// time; a newer request supersedes an older one still in flight.

import type { TurbidityRequest, TurbidityResponse } from "./turbidity.worker";

class TurbidityWorkerClient {
  private worker: Worker | null = null;
  private failed = false;
  private seq = 0;
  private waiting = new Map<number, { resolve: (r: TurbidityResponse) => void; reject: (e: Error) => void }>();

  private ensure(): Worker | null {
    if (this.worker) return this.worker;
    if (this.failed || typeof Worker === "undefined") return null;
    try {
      this.worker = new Worker(new URL("./turbidity.worker.ts", import.meta.url), { type: "module" });
    } catch {
      this.failed = true;
      return null;
    }
    this.worker.onmessage = (e: MessageEvent<TurbidityResponse>) => {
      const m = e.data;
      const w = this.waiting.get(m.id);
      if (!w) return;
      this.waiting.delete(m.id);
      w.resolve(m);
    };
    this.worker.onerror = (ev) => {
      const err = new Error(ev.message || "turbidity worker crashed");
      for (const w of this.waiting.values()) w.reject(err);
      this.waiting.clear();
      this.worker?.terminate();
      this.worker = null;
    };
    return this.worker;
  }

  run(req: Omit<TurbidityRequest, "type" | "id">, signal?: AbortSignal): Promise<TurbidityResponse> {
    const worker = this.ensure();
    if (!worker) return Promise.reject(new Error("Web Workers unavailable"));
    const id = ++this.seq;
    return new Promise<TurbidityResponse>((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      signal?.addEventListener("abort", () => {
        if (this.waiting.delete(id)) reject(new DOMException("aborted", "AbortError"));
      });
      worker.postMessage({ type: "run", id, ...req } satisfies TurbidityRequest);
    });
  }
}

export const turbidityWorker = new TurbidityWorkerClient();
