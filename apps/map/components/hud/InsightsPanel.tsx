"use client";
// Insights: the brief engine's findings for wherever the map is looking.
// Watches the camera target, resolves it to a county through the fabric
// stack, and pulls /api/brief — the same deterministic, severity-ranked
// findings the place pages carry. Alerts first, then watches, then notes;
// every finding shows the arithmetic behind it. Refetches only when the
// camera settles on a new county.

import { useEffect, useRef, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { useGlobe } from "@/lib/store/globe";

interface BriefFinding {
  id: string;
  severity: "alert" | "watch" | "note";
  sentence: string;
  arithmetic?: string[];
  citation?: string;
  period?: string;
}

interface BriefData {
  scopeName: string;
  generatedAt: string;
  findings: BriefFinding[];
}

const SEVERITY_ORDER: Record<BriefFinding["severity"], number> = { alert: 0, watch: 1, note: 2 };
const SEVERITY_COLOR: Record<BriefFinding["severity"], string> = {
  alert: "var(--alert, #ff4d4d)",
  watch: "var(--warn)",
  note: "var(--muted-foreground)",
};
const SEVERITY_LABEL: Record<BriefFinding["severity"], string> = { alert: "Alert", watch: "Watch", note: "Note" };

/** Minutes since the brief was generated, in the reader's words. */
function freshness(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h} hr ago` : `${Math.floor(h / 24)} d ago`;
}

async function countyFor(lon: number, lat: number): Promise<{ fips: string; name: string } | null> {
  const r = await fetch(`/api/fabric?op=stack&lon=${lon.toFixed(4)}&lat=${lat.toFixed(4)}`);
  if (!r.ok) throw new Error(`fabric ${r.status}`);
  const j = await r.json();
  const nodes: Array<{ kind?: string; name?: string; code?: string }> = j?.data?.nodes ?? j?.nodes ?? [];
  const county = nodes.find((n) => n.kind === "county" && n.code);
  return county?.code ? { fips: county.code, name: county.name ?? `County ${county.code}` } : null;
}

async function briefFor(fips: string): Promise<BriefData> {
  const r = await fetch(`/api/brief?scope=county:${fips}`);
  if (!r.ok) throw new Error(`brief ${r.status}`);
  const j = await r.json();
  const d = j?.data ?? j;
  return {
    scopeName: d.scopeName ?? `County ${fips}`,
    generatedAt: d.generatedAt ?? new Date().toISOString(),
    findings: Array.isArray(d.findings) ? d.findings : [],
  };
}

export default function InsightsPanel() {
  const open = useGlobe((s) => s.insightsOpen);
  const setOpen = useGlobe((s) => s.setInsightsOpen);
  const view = useGlobe((s) => s.view);
  const [county, setCounty] = useState<{ fips: string; name: string } | null>(null);
  const [brief, setBrief] = useState<BriefData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  // Follow the camera: when it settles on a rounded point for 1.2s, resolve
  // the county and pull its brief. Rounding to 2 decimals (~1 km) keeps a
  // slow pan from refetching every frame.
  useEffect(() => {
    if (!open) return;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      void (async () => {
        setLoading(true);
        setError(null);
        try {
          const c = await countyFor(view.lon, view.lat);
          setCounty(c);
          if (!c) {
            setBrief(null);
          } else {
            const b = await briefFor(c.fips);
            setBrief(b);
          }
        } catch (e) {
          setError(e instanceof Error ? e.message : "could not load insights");
        } finally {
          setLoading(false);
        }
      })();
    }, 1200);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, `${view.lat.toFixed(2)},${view.lon.toFixed(2)}`]);

  if (!open) return null;
  const findings = [...(brief?.findings ?? [])].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  return (
    <div className="hud-panel pointer-events-auto">
      <div className="flex items-start justify-between gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <div className="hud-label" style={{ color: "var(--primary)" }}>
            <Sparkles className="mr-1 inline size-3" />
            Insights
          </div>
          <div className="hud-display truncate text-[15px] font-semibold leading-tight text-foreground">
            {county?.name ?? (loading ? "Reading the map…" : "Where you're looking")}
          </div>
          <div className="text-[9px] text-muted-foreground">
            {brief ? `Brief generated ${freshness(brief.generatedAt)} · follows the camera` : "Follows the camera target"}
          </div>
        </div>
        <button type="button" onClick={() => setOpen(false)} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Close insights">
          <X className="size-3.5" />
        </button>
      </div>

      <div className="max-h-[46vh] overflow-y-auto [scrollbar-width:thin]">
        {loading && !brief ? (
          <div className="px-3 py-3 text-[10px] text-muted-foreground">Asking the brief engine…</div>
        ) : error ? (
          <div className="px-3 py-3 text-[10px] text-muted-foreground">Insights did not answer: {error.slice(0, 80)}</div>
        ) : !county ? (
          <div className="px-3 py-3 text-[10px] text-muted-foreground">No US county under the camera target — fly over the United States to see findings.</div>
        ) : findings.length === 0 ? (
          <div className="px-3 py-3 text-[10px] text-muted-foreground">No findings for {county.name} in the latest brief.</div>
        ) : (
          <ul>
            {findings.map((f) => (
              <li key={f.id} className="border-t border-border/60 px-3 py-2 first:border-t-0">
                <div className="flex items-center gap-1.5">
                  <span className="inline-block size-1.5 shrink-0 rounded-full" style={{ background: SEVERITY_COLOR[f.severity] }} aria-hidden />
                  <span className="hud-label" style={{ color: SEVERITY_COLOR[f.severity] }}>
                    {SEVERITY_LABEL[f.severity]}
                  </span>
                  {f.period && <span className="ml-auto shrink-0 text-[8.5px] text-muted-foreground/70">{f.period}</span>}
                </div>
                <div className="mt-0.5 text-[10.5px] leading-snug text-foreground/90">{f.sentence}</div>
                {f.arithmetic && f.arithmetic.length > 0 && (
                  <div className="mt-0.5 text-[9px] tabular-nums leading-snug text-muted-foreground">{f.arithmetic.join(" · ")}</div>
                )}
                {f.citation && <div className="mt-0.5 text-[8.5px] text-muted-foreground/70">Basis: {f.citation}</div>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
