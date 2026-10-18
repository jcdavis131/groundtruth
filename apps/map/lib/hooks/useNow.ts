"use client";
// Wall-clock ticker. Reads 0 during server render and hydration (so
// time-derived text never mismatches), then the current time rounded to the
// tick interval, re-rendering once per tick.

import { useSyncExternalStore } from "react";

export function useNow(intervalMs = 1000): number {
  return useSyncExternalStore(
    (onTick) => {
      const id = setInterval(onTick, intervalMs);
      return () => clearInterval(id);
    },
    () => Math.floor(Date.now() / intervalMs) * intervalMs,
    () => 0,
  );
}
