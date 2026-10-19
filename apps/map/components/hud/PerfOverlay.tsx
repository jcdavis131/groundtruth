"use client";
// The ?perf=1 gate. Off (no flag) it renders nothing and the panel's code is
// never loaded: no frame loop, no observers, nothing sent anywhere.

import dynamic from "next/dynamic";
import { useSyncExternalStore } from "react";
import { perfMode } from "@/lib/perf/flag";

const PerfPanel = dynamic(() => import("./PerfPanel"), { ssr: false });

const subscribe = () => () => {};
const fromUrl = () => perfMode().on;
const onServer = () => false;

/** `enabled` overrides the URL flag (tests). */
export default function PerfOverlay({ enabled }: { enabled?: boolean } = {}) {
  const flag = useSyncExternalStore(subscribe, fromUrl, onServer);
  if (!(enabled ?? flag)) return null;
  return <PerfPanel />;
}
