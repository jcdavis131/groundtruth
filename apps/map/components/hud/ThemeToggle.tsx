"use client";

import { Moon, Sun } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "eye-chrome-theme";
const LIGHT_META = "#ffffff";
const DARK_META = "#05070a";

export function currentTheme(): "light" | "dark" {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function applyTheme(theme: "light" | "dark") {
  const el = document.documentElement;
  el.classList.toggle("dark", theme === "dark");
  el.style.colorScheme = theme;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = theme === "dark" ? DARK_META : LIGHT_META;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* private mode: the toggle still works for the session */
  }
}

/** Sun/moon toggle between the paper shell (default) and the night-board cockpit. */
export default function ThemeToggle({ className = "hidden md:inline-flex" }: { className?: string }) {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    setTheme(currentTheme());
  }, []);
  const toggle = useCallback(() => {
    const next = currentTheme() === "dark" ? "light" : "dark";
    applyTheme(next);
    setTheme(next);
  }, []);
  const Icon = theme === "dark" ? Sun : Moon;
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={theme === "dark"}
      className={`hud-btn ${className}`}
      title={theme === "dark" ? "Paper shell: switch to the light chrome" : "Night-board: switch to the dark cockpit"}
    >
      <Icon className="size-3.5" />
      <span className="sr-only">{theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}</span>
    </button>
  );
}
