// The User-Agent every server-side fetch and data script sends.
//
// No next/* import, so plain-Node runners (scripts/*.mjs, vite-node panel
// builders) can import it; lib/server/upstream.ts re-exports it for route code.
//
// BLS sits behind Akamai, which answers 403 to a User-Agent carrying a
// GitHub host or a "curl" token, or no contact at all. This one, pointing at
// the live site, returned 200 from download.bls.gov and www.bls.gov when
// probed on 2026-09-30. It carries no personal email: only SEC hosts ask for
// one, and the EDGAR client builds its own header for them.
export const USER_AGENT = "embedding-atlas/0.1 (+https://eye.jcamd.com; open-source globe)";
