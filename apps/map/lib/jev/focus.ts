// The Ask Jev panel's keyboard and focus rules, kept pure so they are tested
// without a DOM (vitest runs in node here). AskJevPanel applies them.
//
//   - Escape inside the panel closes it (and stops there: the cockpit's own
//     Escape, which deselects, does not also fire).
//   - On open, focus moves into the panel; on close it goes back to whatever
//     had focus when Jev was asked (the What's here button), if that is still
//     on the page.
//   - Opened from What's here, the panel is scrolled into view, instantly
//     under prefers-reduced-motion (never a smooth scroll then).

/** Where the question came from: What's here (a right-click) or the ⌘K palette. */
export type JevOrigin = "here" | "search";

export function isCloseKey(key: string): boolean {
  return key === "Escape";
}

/** The panel's keydown handler: Escape closes it and stops the event there, so the cockpit's own Escape does not also fire. */
export function closeOnEscape(onClose: () => void): (e: { key: string; stopPropagation: () => void }) => void {
  return (e) => {
    if (!isCloseKey(e.key)) return;
    e.stopPropagation();
    onClose();
  };
}

export function scrollOptions(reducedMotion: boolean): ScrollIntoViewOptions {
  return { block: "nearest", behavior: reducedMotion ? "auto" : "smooth" };
}

/** Whether the panel scrolls itself into view when it opens. */
export function scrollsOnOpen(origin: JevOrigin | null): boolean {
  return origin === "here";
}

interface Focusable {
  isConnected?: boolean;
  focus?: (opts?: FocusOptions) => void;
}

/** Give focus back to the opener if it is still on the page; true when it did. */
export function restoreFocus(opener: Focusable | null | undefined): boolean {
  if (!opener || !opener.isConnected || typeof opener.focus !== "function") return false;
  opener.focus({ preventScroll: true });
  return true;
}
