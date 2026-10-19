// ?jev=1: the "Ask Jev" panel (writeups jev-2026-10-18 ASK-PANEL-SPEC.md),
// flagged like ?perf=1 and ?semantic=1 until it has had its hallway test.
// Off unless the URL the page loaded with carries jev=1. Read once per page
// load and cached: the share-link code rewrites the address bar about once a
// second (lib/globe/share.ts), so a live read could lose the flag mid-session.

export function parseJev(search: string): boolean {
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return q.get("jev") === "1";
}

let cached: boolean | null = null;

/** Is the Ask Jev panel on for this page load? Off on the server. */
export function jevOn(): boolean {
  if (cached != null) return cached;
  if (typeof window === "undefined") return false;
  try {
    cached = parseJev(window.location.search);
  } catch {
    cached = false;
  }
  return cached;
}
