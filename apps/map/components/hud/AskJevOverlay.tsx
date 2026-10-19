"use client";
// The ?jev=1 gate, as PerfOverlay gates ?perf=1. Off (no flag) it renders
// nothing and the panel's code is never loaded; nothing is asked or sent.

import dynamic from "next/dynamic";
import { useSyncExternalStore } from "react";
import { jevOn } from "@/lib/jev/flag";

const AskJevPanel = dynamic(() => import("./AskJevPanel"), { ssr: false });

const subscribe = () => () => {};
const onServer = () => false;

/** The flag for this page load, safe to read during render (false on the server). */
export function useJevOn(): boolean {
  return useSyncExternalStore(subscribe, jevOn, onServer);
}

/** `enabled` overrides the URL flag (tests). */
export default function AskJevOverlay({ enabled }: { enabled?: boolean } = {}) {
  const flag = useJevOn();
  if (!(enabled ?? flag)) return null;
  return <AskJevPanel />;
}
