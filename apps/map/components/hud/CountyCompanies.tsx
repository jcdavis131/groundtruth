"use client";
// Companies headquartered in a county, and the county's jobs mix bridged to
// GICS sectors and their ETFs. A small block for the market report; the
// integrator mounts <CountyCompanies fips={...} /> where the report has a
// county. Clicking a row flies the camera to the HQ and selects it when the
// layer is on.

import { useQuery } from "@tanstack/react-query";
import type { Point } from "geojson";
import type { LayerFeature } from "@/lib/layers/types";
import type { CompanyExtra, SectorExposure } from "@/lib/companies/types";
import { fmtMoney } from "@/lib/companies/facts";
import { SECTOR_COLOR } from "@/lib/companies/sectors";
import { fmtNum } from "@/lib/economy/features";
import { flyTo } from "@/lib/globe/camera";
import { getRenderer } from "@/lib/globe/registry";
import { useGlobe } from "@/lib/store/globe";

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  const j = (await r.json()) as T & { error?: string };
  if (!r.ok) throw new Error(j.error ?? `${r.status} ${url}`);
  return j;
}

export function useCountyCompanies(fips: string | null) {
  return useQuery({
    queryKey: ["companies-county", fips],
    queryFn: () => getJson<{ data: { features: LayerFeature<Point>[] }; pulled: string | null }>(`/api/companies?op=county&fips=${fips}`),
    staleTime: 6 * 3600_000,
    enabled: !!fips,
  });
}

export function useCountySectorExposure(fips: string | null) {
  return useQuery({
    queryKey: ["companies-sectors", fips],
    queryFn: () => getJson<{ data: { period: string; exposure: SectorExposure[] } }>(`/api/companies?op=sectors&fips=${fips}`).then((j) => j.data),
    staleTime: 6 * 3600_000,
    enabled: !!fips,
  });
}

function goTo(f: LayerFeature<Point>) {
  const [lon, lat] = f.geometry.coordinates;
  flyTo(lon, lat, { height: 20_000 });
  const st = useGlobe.getState();
  const r = getRenderer("companies");
  const live = r?.getFeature(f.properties.id);
  if (live) st.select({ layer: "companies", id: f.properties.id }, live);
  else st.pushLog({ level: "info", text: `Turn on the Public companies layer to select ${f.properties.name}.` });
}

export default function CountyCompanies({ fips, limit = 8 }: { fips: string | null; limit?: number }) {
  const companies = useCountyCompanies(fips);
  const exposure = useCountySectorExposure(fips);
  if (!fips) return null;
  const rows = (companies.data?.data.features ?? []).slice(0, limit);
  const total = companies.data?.data.features.length ?? 0;
  const top = (exposure.data?.exposure ?? []).filter((e) => e.gics !== "unclassified").slice(0, 5);
  return (
    <div className="border-t border-border/60 px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="hud-label">Public companies HQ&apos;d here</span>
        <span className="text-[9px] text-muted-foreground">{companies.isLoading ? "loading…" : total ? `${total} in snapshot` : "none in snapshot"}</span>
      </div>
      {companies.error && <div className="text-[9px] text-muted-foreground">companies unavailable: {(companies.error as Error).message.slice(0, 60)}</div>}
      {rows.length > 0 && (
        <table className="mt-1 w-full text-[9px] leading-tight">
          <tbody>
            {rows.map((f) => {
              const x = f.properties.extra as CompanyExtra;
              const rev = x.facts.Revenues;
              return (
                <tr key={f.properties.id} className="cursor-pointer align-baseline hover:text-primary" onClick={() => goTo(f)} title={`${f.properties.name} · ${x.sector.gicsTitle}`}>
                  <td className="w-12 shrink-0 pr-1 font-semibold tabular-nums" style={{ color: SECTOR_COLOR[x.sector.gics] }}>
                    {x.ticker}
                  </td>
                  <td className="max-w-[120px] truncate pr-1 text-foreground/85">{f.properties.name}</td>
                  <td className="whitespace-nowrap pl-1 text-right text-muted-foreground">{x.sector.gicsTitle}</td>
                  <td className="whitespace-nowrap pl-2 text-right tabular-nums">{rev ? `${fmtMoney(rev.value)} ${rev.period}` : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {total > rows.length && <div className="text-[9px] text-muted-foreground">+{total - rows.length} more; see /api/companies?op=county&amp;fips={fips}&amp;format=csv</div>}
      <div className="mt-2 flex items-baseline justify-between gap-2">
        <span className="hud-label">
          Sector exposure <span className="text-warn">ESTIMATE</span>
        </span>
        <span className="text-[9px] text-muted-foreground">{exposure.data?.period ?? ""}</span>
      </div>
      {exposure.isLoading && <div className="text-[9px] text-muted-foreground">loading QCEW sectors…</div>}
      {exposure.error && <div className="text-[9px] text-muted-foreground">sector mix unavailable: {(exposure.error as Error).message.slice(0, 60)}</div>}
      {top.length > 0 && (
        <ul className="mt-0.5 space-y-0.5 text-[9px] leading-snug">
          {top.map((e) => (
            <li key={e.gics} className="flex items-baseline justify-between gap-2">
              <span style={{ color: SECTOR_COLOR[e.gics] }}>
                {e.gicsTitle} <span className="text-muted-foreground">{e.etfs.join(" ")}</span>
              </span>
              <span className="whitespace-nowrap tabular-nums text-muted-foreground">
                {e.lq != null ? `LQ ${e.lq.toFixed(2)}` : "LQ n/a"} · {e.emp != null ? `${fmtNum(e.emp)} jobs` : "withheld"}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-1 text-[9px] leading-snug text-muted-foreground/80">
        BLS QCEW private-sector NAICS mix folded into GICS-style sectors; LQ is the employment-weighted mean location quotient. The sector-to-ETF bridge is a convention (lib/companies/sectors.ts), not advice. Company positions are ZIP or city centroids of the SEC business address.
      </div>
    </div>
  );
}
