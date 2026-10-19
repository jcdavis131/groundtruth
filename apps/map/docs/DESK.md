# Desk mode

Desk mode is a light, dense analyst workspace on top of the same globe and the
same layers. The globe stays on the left; a resizable pane on the right holds
four tabs: **Table**, **Chart**, **Report** and **Notes**. The HUD's scanlines,
glow, vignette and cinematic idle drift are off while it is on. Nothing about
the data changes: every number in the pane comes from a feature a layer holds
or a series a route serves, and estimates keep printing their arithmetic.

## Turning it on

- Open the app with `?mode=desk` in the URL, e.g.
  `/?lat=30.27&lon=-97.74&h=120000&layers=realestate,commerce,trade&mode=desk`.
  `?mode=hud` forces the cockpit. The parameter is kept in the address bar
  (with `history.replaceState`, no reload) so a copied link reopens in the
  same mode.
- Press **D** anywhere (not while typing in a field), or click **Desk** in the
  top bar.
- The mode, the light/dark choice, the pane width, the active tab, the chart
  series and the notes are all remembered in this browser under the
  localStorage key `gev:desk`.

Desk defaults to a light theme; the sun/moon button in the pane header keeps
the dense layout but switches back to the cockpit's dark tokens.

## Keyboard

| Key | Where | Does |
| --- | --- | --- |
| `D` | anywhere | toggle desk / HUD |
| `←` `→` `Home` `End` | tab strip (focused) | move between tabs |
| `←` `→` (`Shift` for 80 px) | resize handle (focused) | widen / narrow the pane; `Home` widest, `End` narrowest |
| `Enter` / `Space` | table row | select it on the globe and fly there |
| `Esc`, `⌘K`, `,` | anywhere | unchanged cockpit keys |

Every control is a real button with a name; tabs use `role="tablist"` with a
roving tab index; focus rings are visible in both themes; the pane's resize
transition is disabled under `prefers-reduced-motion`.

## Tabs

**Table.** The loaded features of the enabled economy layers (trade, commerce,
real estate, and the company / bank / spending layers when present), one row
per feature, flattened: base properties, the typed joins (home value, rent,
jobs, wages, port statistics, truck crossings) with units in the headers, then
whatever the info panel would show. Chips restrict the table to one layer or
turn a layer on. Headers sort (click cycles ascending, descending, off; nulls
always sink); the filter box matches any cell; rows are windowed so 20 000
counties scroll smoothly. **CSV** downloads the filtered rows; **TSV** copies
them for Excel or Sheets. Clicking a row selects it on the globe.

**Chart.** Add up to twelve series from three sources: the published series
store (`/api/series?op=list`), the named indicators (`/api/indicators?op=list`)
and a county's history (`/api/economy/history?op=county&fips=`; the picker
offers the county under the camera when the area layers are loaded). Series
with the same unit share an axis; the first two units get the left and right
axes; more than two share the left axis and the chart says so. **Normalise**
rebases every series to 100 at its first value. Hover for a crosshair with the
value of every series at that date. Legend entries toggle a series; the ×
removes it. **PNG** rasterises the SVG through a canvas; **CSV** writes every
series on the union of their dates. A route that is not deployed yet shows an
inline note rather than an error.

**Report.** The market report and the community water report, side by side
(stacked below ~1500 px), laid out as documents instead of floating panels.
"Open" buttons switch the layers each one needs. **Print / Save as PDF** calls
`window.print()`.

**Notes.** A plain textarea, saved as you type. **Copy as markdown** produces a
document with a heading, the permalink of the current view (camera, layers,
clock, selection, open reports, `mode=desk`), your text, the series on the
chart, and a "Sources of the open reports" section listing each loaded
section's basis line and the report's caveats.

## Printing

`@media print` rules (scoped to `[data-mode="desk"]`) hide the globe, the HUD
chrome and the pane's toolbars, let the pane run full width and page height,
and put a page break between report sections. Only the active tab prints. The
table prints every row up to 2 000 (it listens for `beforeprint`); export CSV
for more. Notes print as flowing text. In the HUD (no `data-mode`) the print
stylesheet is untouched.

## How it is built

- `lib/desk/store.ts` — zustand store, persisted. `initDeskFromUrl()` reads
  `?mode=`. Entering desk sets `data-mode="desk"` and `data-theme` on `<html>`,
  turns the `cinematic` setting off (remembering what it was) and restores it
  on exit.
- `lib/desk/table.ts` — flattening, columns, sort, filter, windowing, CSV/TSV.
- `lib/desk/chart.ts` — extents, nice ticks, dual-axis plan, normalise, date
  ticks, nearest point, CSV.
- `lib/desk/api.ts` — picker and series fetches against the shared
  `Enveloped<T>` / `Series` contracts; parsers are pure.
- `lib/desk/notes.ts` — markdown builder.
- `components/hud/DeskLayout.tsx`, `DataTable.tsx`, `MultiSeriesChart.tsx`,
  `DeskToggle.tsx` — the UI. `SeriesChart.tsx` gained `points` and
  `ariaLabel` props so it can draw a `Series` directly.
- `app/globals.css` — the `[data-mode="desk"]` token override and the print
  rules, all additive.

## Adding a tab

1. Add an entry to `DESK_TABS` in `lib/desk/store.ts` (`id`, `label`, `hint`).
   The `DeskTab` union gains the id.
2. Write the panel as a function component inside `DeskLayout.tsx` (or its own
   file) and add a line to the `tabpanel` switch:
   `{tab === "mine" && <MineTab />}`.
3. Put toolbars in a `desk-noprint` container so they do not print; wrap
   printable blocks that should start a new page in `.desk-section`.
4. Keep the logic in `lib/desk/*.ts` with a `.test.ts` next to it.
