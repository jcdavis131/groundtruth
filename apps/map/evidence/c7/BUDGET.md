# Atlas Living Field — Phase 1 budget table (C7)

Source: SPEC §3 C7. Enforced in CI by `.github/workflows/atlas-budget.yml`
(size-limit + Lighthouse CI + the Playwright render check). A PR that reddens
any row cannot carry the owner's merge-word.

| Item | Budget | Phase 1 measured (2026-10-30) |
|---|---|---|
| Page JS+CSS+HTML, `public/atlas/field.html` (gz) | ≤ 105 KB (90 JS + 15 CSS) | 6.3 KB gz |
| First raster + seed (transfer bytes) | ≤ 150 KB | 64.4 KB (19.4 + 45.0) |
| Total before first paint | ≤ 300 KB | ~84 KB (page + manifest + raster + seed) |
| Drawn interactable points | 5,000 max | 5,000 |
| Tile LRU | 64 tiles, ~1 MB | 64, ~1 MB |
| Memory (mobile) | ≤ 150 MB heap | not yet measured (CI: Lighthouse) |
| FCP, 4G simulated, mobile | p75 < 1.5 s (bar); CI warn at 3 s | CI only (reference device: Pixel 7a) |

Notes:
- The 426 KB `names.min.json` identity index is NEVER in the first-paint
  path: it fetches lazily on the first tap, after first paint.
- Tiles fetch on zoom only (≥2×), LRU-capped at 64.
- Reference device per OD-9 is Pixel 7a; CI's simulated 4G is a smoke gate,
  not the bar. The real p75 < 1.5 s bar needs the reference device.
