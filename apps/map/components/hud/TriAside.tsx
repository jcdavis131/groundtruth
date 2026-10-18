"use client";
// Dossier aside for a Toxics Release Inventory listing on the Contaminated
// sites layer: a "Reported releases" button that asks /api/permits?op=tri for
// what the facility reported releasing on site, by medium, in its reported
// units, with Form A certifications listed as such. Mounted by InfoPanel for
// contaminants features whose program is TRI; the TRIFID is EMEF's program id.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { LayerFeature } from "@/lib/layers/types";
import type { ContaminantExtra } from "@/lib/permits/contaminants";
import { TRIFID_RE, type TriFormA, type TriRelease, type TriTotal } from "@/lib/permits/tri";

interface TriEnvelope {
  data: { facility: string; year: number; rows: TriRelease[]; totals: TriTotal[]; formA: TriFormA[] | null };
  caveats?: string[];
  error?: string;
}

async function getTri(trifid: string): Promise<TriEnvelope> {
  const r = await fetch(`/api/permits?op=tri&trifid=${trifid}`);
  const j = (await r.json().catch(() => ({}))) as TriEnvelope;
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j;
}

function amountText(n: number, unit: string): string {
  return `${n.toLocaleString("en-US", { maximumFractionDigits: 6 })} ${unit.toLowerCase()}`;
}

export default function TriAside({ feature }: { feature: LayerFeature }) {
  const x = feature.properties.extra as ContaminantExtra | undefined;
  const trifid = x?.program === "tri" && x.programId && TRIFID_RE.test(x.programId) ? x.programId : null;
  const [asked, setAsked] = useState(false);
  const q = useQuery({ queryKey: ["tri", trifid], queryFn: () => getTri(trifid!), enabled: asked && !!trifid, staleTime: 24 * 3600_000 });
  if (!trifid) return null;
  return (
    <section className="border-t border-border/60 px-3 py-2 text-[10px] leading-snug">
      <div className="hud-label mb-1">Reported releases (TRI)</div>
      {!asked ? (
        <button type="button" onClick={() => setAsked(true)} className="border border-border px-2 py-0.5 text-foreground hover:bg-accent">
          Show what this facility reported releasing
        </button>
      ) : q.isPending ? (
        <div className="text-muted-foreground">Asking EPA Envirofacts (this can take 10 s)…</div>
      ) : q.isError ? (
        <div className="text-muted-foreground">EPA Envirofacts did not answer: {q.error instanceof Error ? q.error.message.slice(0, 80) : "error"}.</div>
      ) : (
        <TriTable env={q.data} />
      )}
    </section>
  );
}

function TriTable({ env }: { env: TriEnvelope }) {
  const { year, rows, totals, formA } = env.data;
  const chemicals = new Set(rows.map((r) => r.chemical)).size;
  const na = rows.filter((r) => r.notApplicable).length;
  const ranged = rows.filter((r) => r.range);
  return (
    <div className="space-y-1">
      <div>
        Reporting year {year}: {chemicals} chemicals on Form R{formA?.length ? `, ${formA.length} on Form A` : ""}.
      </div>
      {totals.length > 0 ? (
        <table className="w-full tabular-nums">
          <caption className="sr-only">Reported on-site releases by medium and unit, {year}</caption>
          <thead>
            <tr className="text-muted-foreground">
              <th className="text-left font-normal">Medium</th>
              <th className="text-right font-normal">Reported</th>
            </tr>
          </thead>
          <tbody>
            {totals.map((t) => (
              <tr key={`${t.medium}|${t.unit}`}>
                <td>{t.mediumLabel}</td>
                <td className="text-right">{amountText(t.amount, t.unit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="text-muted-foreground">No quantity reported for {year}.</div>
      )}
      {na > 0 && <div className="text-muted-foreground">{na} rows say &ldquo;not applicable&rdquo; for that medium; they are not zeros and are not in the totals.</div>}
      {ranged.length > 0 && <div className="text-muted-foreground">{ranged.length} rows are range reports ({[...new Set(ranged.map((r) => r.range))].join("; ")}), not counted in the totals.</div>}
      {formA == null && <div className="text-muted-foreground">Form A certifications: unknown this time (EPA did not answer).</div>}
      {formA && formA.length > 0 && <div>Form A (no quantities reported): {formA.map((f) => f.chemical ?? f.cas ?? "chemical not named").join(", ")}.</div>}
      <div className="text-muted-foreground">Totals are per medium and unit; pounds and grams are never added. Reported releases are not exposure or concentration.</div>
    </div>
  );
}
