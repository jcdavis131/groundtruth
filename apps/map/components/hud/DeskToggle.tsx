"use client";
// Toggle between the HUD and desk mode. The integrator places it in the
// TopBar action group. Also binds the `D` key (not while typing).

import { useEffect } from "react";
import { LayoutPanelLeft } from "lucide-react";
import { useDesk } from "@/lib/desk/store";

export default function DeskToggle() {
  const mode = useDesk((s) => s.mode);
  const toggleMode = useDesk((s) => s.toggleMode);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== "d" && e.key !== "D") return;
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if (typing) return;
      e.preventDefault();
      useDesk.getState().toggleMode();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const on = mode === "desk";
  return (
    <button
      type="button"
      onClick={toggleMode}
      aria-pressed={on}
      className="hud-btn"
      title={on ? "Back to the HUD (D)" : "Desk mode: light, dense table + chart + report workspace (D)"}
    >
      <LayoutPanelLeft className="size-3.5" />
      <span className="sr-only">Desk</span>
    </button>
  );
}
