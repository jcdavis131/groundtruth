// The construct field's legend: one 20 px bar, the units, the unit that sets
// the top of the ramp, and the dashed entry for units that are not loaded,
// with how many and the commonest reason. It only draws a Legend
// (lib/fabric/legend.ts); it computes nothing of its own.

import type { Legend, LegendEntry } from "@/lib/fabric/legend";

function topReason(reasons: Record<string, number>): string | null {
  const rows = Object.entries(reasons).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  return rows.length ? rows[0][0] : null;
}

function Row({ entry, text, title }: { entry: LegendEntry; text: string; title?: string }) {
  const dashed = entry.kind === "not-loaded" || entry.kind === "outline";
  return (
    <li className="flex items-start gap-1.5" title={title}>
      <span
        data-legend-swatch
        className={dashed ? "mt-2 inline-block h-0 w-4 shrink-0 border-t-2 border-dashed" : "mt-0.5 inline-block h-3 w-4 shrink-0 rounded-sm"}
        style={dashed ? { borderColor: entry.color } : { background: entry.color }}
        aria-hidden
      />
      <span>{text}</span>
    </li>
  );
}

export default function FieldLegend({ legend }: { legend: Legend }) {
  const ramp = legend.entries.filter((e) => e.kind === "ramp");
  const rows = legend.entries.filter((e) => e.kind !== "ramp");
  const reason = topReason(legend.notLoaded.reasons);
  const first = ramp[0];
  const last = ramp[ramp.length - 1];
  return (
    <div className="space-y-1 text-xs leading-snug" aria-label="Legend">
      {ramp.length > 0 && (
        <div>
          <div className="flex h-5 overflow-hidden rounded-sm" role="img" aria-label={`Heat ramp, ${first.label} to ${last.label} ${legend.units}`}>
            {ramp.map((e, i) => {
              const next = ramp[i + 1];
              // Each swatch is the stretch from this stop to the next; the last stop is a short cap.
              const width = next ? ((next.heat ?? 0) - (e.heat ?? 0)) * 96 : 4;
              return (
                <span
                  key={e.heat}
                  data-legend-swatch
                  style={{ width: `${width}%`, background: next ? `linear-gradient(to right, ${e.color}, ${next.color})` : e.color }}
                />
              );
            })}
          </div>
          <div className="flex justify-between tabular-nums text-muted-foreground">
            <span>{first.label}</span>
            <span>{legend.units}</span>
            <span>{last.label}</span>
          </div>
        </div>
      )}
      {legend.max && <div className="text-muted-foreground">{`scaled to ${legend.max.name}, ${legend.max.display}`}</div>}
      {rows.length > 0 && (
        <ul className="space-y-0.5">
          {rows.map((e) =>
            e.kind === "not-loaded" ? (
              <Row key={`${e.kind}${e.color}`} entry={e} text={`${legend.notLoaded.count} not loaded${reason ? `: ${reason}` : ""}`} title="Not loaded means no value, which is not the same as none." />
            ) : (
              <Row key={`${e.kind}${e.color}${e.label}`} entry={e} text={e.label} />
            ),
          )}
        </ul>
      )}
      {legend.entries.length === 0 && <div className="text-muted-foreground">Nothing in view yet.</div>}
    </div>
  );
}
