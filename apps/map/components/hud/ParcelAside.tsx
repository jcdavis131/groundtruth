"use client";
// Dossier section for an identified parcel: which record of a stacked
// answer is shown, the NAD address points on it, where the record comes from
// and what it is not, and how to ask for a record to be withheld here.

import type { LayerFeature } from "@/lib/layers/types";
import type { ParcelFeatureExtra } from "@/lib/parcels/features";
import { showParcelRecord, useParcelPick } from "@/lib/parcels/pick";

const README_PARCELS = "https://github.com/jcdavis131/gods-eye-view#parcels--ownership";

export default function ParcelAside({ feature }: { feature: LayerFeature }) {
  const pick = useParcelPick((s) => s.pick);
  const x = feature.properties.extra as ParcelFeatureExtra | undefined;
  const loading = feature.properties.kind === "loading";
  const data = x?.identify;
  const index = x?.index ?? 0;
  const stacked = data && data.parcels.length > 1 ? data.parcels.length : 0;
  const addresses = data?.addresses;
  const adapter = data?.adapter;

  return (
    <div className="border-t border-border px-3 py-2 text-[10px] leading-snug">
      {loading && <div className="text-muted-foreground">Asking the county or state parcel service for the parcel at this point…</div>}

      {stacked > 0 && (
        <div className="mb-2">
          <div className="hud-label mb-1">{stacked} records at this point</div>
          <div className="flex flex-wrap gap-1">
            {data!.parcels.map((p, i) => (
              <button
                key={`${p.record.parcelId}-${i}`}
                type="button"
                onClick={() => showParcelRecord(i)}
                aria-pressed={i === index}
                className={`border px-1.5 py-0.5 tabular-nums ${i === index ? "border-primary/70 text-primary" : "border-border text-foreground/80 hover:bg-accent"}`}
                title={p.record.situs ?? p.record.parcelId}
              >
                {i + 1}
              </button>
            ))}
          </div>
        </div>
      )}

      {data && (
        <div className="mb-2">
          <div className="hud-label mb-1">Address points (USDOT NAD)</div>
          {addresses === null ? (
            <div className="text-muted-foreground">{pick?.addressesLoading ? "Still asking NAD (it is slow)…" : "NAD did not answer this time."}</div>
          ) : addresses && addresses.length ? (
            <ul className="space-y-0.5">
              {addresses.map((a) => (
                <li key={`${a.address}-${a.lon}`}>
                  {a.address}
                  <span className="text-muted-foreground">
                    {a.onParcel ? " · on this parcel" : " · near the point"}
                    {a.source ? ` · ${a.source}` : ""}
                    {a.updated ? ` · updated ${a.updated}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-muted-foreground">None in NAD here. NAD covers the states and tribes that contribute to it, so none is not proof of no address.</div>
          )}
        </div>
      )}

      {adapter && (
        <div className="mb-2 text-muted-foreground">
          Relayed as {adapter.publisher} publishes it ({adapter.coverage}), with nothing added from another source. A tax map, not a survey or a
          title record; the source&apos;s own record is the authority.
          {!adapter.ownerPublished && " This source does not publish owner names."}
        </div>
      )}

      <div className="text-muted-foreground">
        No search from a name to what someone owns: parcels are found only by clicking the map. Is this record about you and should not be shown
        here?{" "}
        <a href={README_PARCELS} target="_blank" rel="noreferrer" className="text-primary underline-offset-2 hover:underline">
          How to ask for it to be withheld
        </a>
        .
      </div>
    </div>
  );
}
