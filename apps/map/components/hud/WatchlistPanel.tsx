"use client";
// Watchlists: a few places, ports, gauges or series with rules attached, kept
// in the browser, evaluated by /api/watch and delivered as RSS / Atom / JSON
// or a signed webhook. The list travels in the feed URL as a token, so the
// URL is the secret; the panel says so next to the copy buttons.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bell, Copy, Crosshair, FileDown, Plus, RefreshCw, Trash2, Upload, X } from "lucide-react";
import { useGlobe } from "@/lib/store/globe";
import { flyTo } from "@/lib/globe/camera";
import { downloadText } from "@/lib/explore/export";
import { useWatchlists, watchLog } from "@/lib/watch/store";
import { encodeToken, METRICS_BY_KIND, RULE_OPS, RULE_WINDOWS, itemLabel, type Rule, type RuleOp, type RuleWindow, type WatchKind, type Watchlist } from "@/lib/watch/model";
import { fmtValue, type WatchEvent } from "@/lib/watch/evaluate";
import type { ResolveResult } from "@/lib/watch/resolve";

const REFRESH_MS = 10 * 60_000;

interface WatchResponse {
  id: string;
  stateful: boolean;
  cacheAge: number;
  urls: { rss: string; atom: string; json: string; jsonfeed: string };
  data: { items: ResolveResult[]; events: WatchEvent[]; checked: number; skipped: Array<{ itemRef: number; ruleIndex: number; reason: string }> };
  generatedAt: string;
  caveats?: string[];
  error?: string;
}

function copyText(text: string, done: string) {
  navigator.clipboard.writeText(text).then(
    () => watchLog("info", done),
    () => watchLog("warn", `Clipboard blocked; the text is ${text.slice(0, 80)}…`),
  );
}

const KIND_COLOR: Record<WatchKind, string> = {
  county: "#F472B6",
  state: "#F472B6",
  port: "#FBBF24",
  crossing: "#FBBF24",
  gauge: "#60A5FA",
  series: "var(--primary)",
  indicator: "var(--primary)",
  company: "#A78BFA",
};

/** Metric ids a rule may pick for an item (or for "*": the union across the list) plus whatever the resolver actually published. */
function metricChoices(wl: Watchlist, itemRef: number | "*", resolved: ResolveResult[]): string[] {
  const kinds = itemRef === "*" ? [...new Set(wl.items.map((i) => i.kind))] : [wl.items[itemRef]?.kind].filter((k): k is WatchKind => !!k);
  const out = new Set<string>();
  for (const k of kinds) for (const m of METRICS_BY_KIND[k]) out.add(m.id);
  const targets = itemRef === "*" ? resolved : [resolved[itemRef]];
  for (const r of targets) if (r?.ok) for (const k of Object.keys(r.metrics)) if (!/^p\d{5}$/.test(k)) out.add(k);
  return [...out];
}

const inputCls = "h-6 min-w-0 rounded border border-border bg-background/60 px-1.5 text-[10px] text-foreground outline-none focus:border-primary";
const btnCls = "rounded border border-border px-2 py-0.5 text-[10px] text-foreground/90 hover:bg-accent disabled:opacity-40";
const iconBtn = "rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground";

/** The active list as a URL token; null until encoded (the token is derived asynchronously, keyed by id + version). */
function useToken(wl: Watchlist | null): string | null {
  const [state, setState] = useState<{ key: string; token: string | null }>({ key: "", token: null });
  const key = wl ? `${wl.id}:${wl.version}` : "";
  useEffect(() => {
    if (!wl) return;
    let live = true;
    encodeToken(wl).then(
      (t) => live && setState({ key, token: t }),
      (err) => {
        if (!live) return;
        setState({ key, token: null });
        watchLog("warn", err instanceof Error ? err.message : "Could not encode the watchlist.");
      },
    );
    return () => {
      live = false;
    };
    // wl is fully described by key (id + version); re-encoding on every object identity change would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state.key === key ? state.token : null;
}

function useEvaluation(open: boolean, token: string | null) {
  const [data, setData] = useState<WatchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!open || !token) return;
    let live = true;
    const ctrl = new AbortController();
    const run = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/watch?t=${encodeURIComponent(token)}&format=json`, { signal: ctrl.signal });
        const body = (await res.json()) as WatchResponse;
        if (!live) return;
        if (!res.ok) {
          setError(body.error ?? `HTTP ${res.status}`);
          setData(null);
        } else {
          setError(null);
          setData(body);
          if (body.data.events.length) watchLog("alert", `Watchlist: ${body.data.events.length} rule${body.data.events.length === 1 ? "" : "s"} fired. ${body.data.events[0].message}`);
        }
      } catch (err) {
        if (live && !(err instanceof DOMException && err.name === "AbortError")) setError(err instanceof Error ? err.message : "network error");
      } finally {
        if (live) setLoading(false);
      }
    };
    void run();
    const timer = setInterval(run, REFRESH_MS);
    return () => {
      live = false;
      ctrl.abort();
      clearInterval(timer);
    };
  }, [open, token, nonce]);
  return { data, loading, error, refresh: () => setNonce((n) => n + 1) };
}

function ItemRow({ item, resolved, onRemove }: { item: Watchlist["items"][number]; resolved?: ResolveResult; onRemove: () => void }) {
  const geo = (resolved?.geo ?? item.geo) as [number, number] | undefined;
  const preferred = METRICS_BY_KIND[item.kind].map((m) => m.id);
  const shown = resolved?.ok
    ? [...preferred.filter((k) => k in resolved.metrics), ...Object.keys(resolved.metrics).filter((k) => !preferred.includes(k) && !/^p\d{5}$/.test(k))].slice(0, 4)
    : [];
  return (
    <li className="grid grid-cols-[1fr_auto] items-start gap-1 py-1">
      <button
        type="button"
        onClick={() => {
          if (!geo) return watchLog("warn", `${itemLabel(item)} has no coordinates to fly to.`);
          flyTo(geo[0], geo[1], { height: item.kind === "state" ? 1_500_000 : item.kind === "county" ? 150_000 : 40_000 });
        }}
        className="min-w-0 text-left hover:bg-accent"
        title={geo ? "Fly to" : "No coordinates"}
      >
        <div className="flex items-baseline gap-1 text-[10px] leading-tight">
          <span className="shrink-0 uppercase tracking-wider" style={{ color: KIND_COLOR[item.kind], fontSize: 8 }}>
            {item.kind}
          </span>
          <span className="truncate text-foreground/90">{resolved?.ok ? resolved.name : itemLabel(item)}</span>
        </div>
        {resolved ? (
          resolved.ok ? (
            <div className="text-[9px] leading-snug text-muted-foreground">
              {shown.map((k) => `${k} ${resolved.metrics[k] == null ? "n/a" : fmtValue(resolved.metrics[k] as number)}`).join(" · ") || "no metrics published"}
              {resolved.asOf ? ` · ${resolved.asOf.slice(0, 10)}` : ""}
            </div>
          ) : (
            <div className="text-[9px] leading-snug" style={{ color: "var(--warn)" }}>
              {resolved.error}
            </div>
          )
        ) : (
          <div className="text-[9px] text-muted-foreground">not evaluated yet</div>
        )}
      </button>
      <button type="button" onClick={onRemove} className={iconBtn} aria-label="Remove item" title="Remove">
        <X className="size-3" />
      </button>
    </li>
  );
}

function RuleRow({ wl, rule, index, resolved }: { wl: Watchlist; rule: Rule; index: number; resolved: ResolveResult[] }) {
  const updateRule = useWatchlists((s) => s.updateRule);
  const removeRule = useWatchlists((s) => s.removeRule);
  const ref = rule.itemRef ?? "*";
  const metrics = metricChoices(wl, ref, resolved);
  const needsWindow = rule.op === "crosses_above" || rule.op === "crosses_below" || rule.op === "changes_by_pct";
  return (
    <li className="grid grid-cols-[auto_1fr_auto_auto_auto_auto] items-center gap-1">
      <select className={inputCls} value={ref === "*" ? "*" : String(ref)} onChange={(e) => updateRule(index, { itemRef: e.target.value === "*" ? "*" : Number(e.target.value) })} aria-label="Item">
        <option value="*">any</option>
        {wl.items.map((it, i) => (
          <option key={i} value={i}>
            {itemLabel(it).slice(0, 22)}
          </option>
        ))}
      </select>
      <select className={inputCls} value={rule.metric} onChange={(e) => updateRule(index, { metric: e.target.value })} aria-label="Metric">
        {!metrics.includes(rule.metric) && <option value={rule.metric}>{rule.metric}</option>}
        {metrics.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      <select className={inputCls} value={rule.op} onChange={(e) => updateRule(index, { op: e.target.value as RuleOp })} aria-label="Operator">
        {RULE_OPS.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      <input
        className={`${inputCls} w-14 tabular-nums`}
        type="number"
        step="any"
        value={rule.value}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) updateRule(index, { value: v });
        }}
        aria-label="Value"
      />
      <select className={inputCls} value={rule.window ?? ""} disabled={!needsWindow} onChange={(e) => updateRule(index, { window: (e.target.value || undefined) as RuleWindow | undefined })} aria-label="Window">
        <option value="">win</option>
        {RULE_WINDOWS.map((w) => (
          <option key={w} value={w}>
            {w}
          </option>
        ))}
      </select>
      <button type="button" onClick={() => removeRule(index)} className={iconBtn} aria-label="Remove rule" title="Remove">
        <X className="size-3" />
      </button>
    </li>
  );
}

export default function WatchlistPanel() {
  const open = useWatchlists((s) => s.open);
  const setOpen = useWatchlists((s) => s.setOpen);
  const watchlists = useWatchlists((s) => s.watchlists);
  const activeId = useWatchlists((s) => s.activeId);
  const setActive = useWatchlists((s) => s.setActive);
  const create = useWatchlists((s) => s.create);
  const remove = useWatchlists((s) => s.remove);
  const rename = useWatchlists((s) => s.rename);
  const removeItem = useWatchlists((s) => s.removeItem);
  const addRule = useWatchlists((s) => s.addRule);
  const addSelection = useWatchlists((s) => s.addSelection);
  const importJson = useWatchlists((s) => s.importJson);
  const webhooks = useWatchlists((s) => s.webhooks);
  const setWebhook = useWatchlists((s) => s.setWebhook);
  const selected = useGlobe((s) => s.selected);

  const wl = useMemo(() => watchlists.find((w) => w.id === activeId) ?? null, [watchlists, activeId]);
  const token = useToken(wl);
  const { data, loading, error, refresh } = useEvaluation(open, token);
  const resolved = useMemo(() => (data && data.id === wl?.id ? data.data.items : []), [data, wl?.id]);

  const [signingSecret, setSigningSecret] = useState("");
  const [cronSecret, setCronSecret] = useState("");
  const [sending, setSending] = useState(false);
  const [published, setPublished] = useState<{ id: string; stored: boolean; shortUrls: Record<string, string> | null } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const urls = useMemo(() => {
    if (!token) return null;
    const base = `${origin}/api/watch?t=${encodeURIComponent(token)}`;
    return { rss: `${base}&format=rss`, atom: `${base}&format=atom`, json: `${base}&format=json` };
  }, [token, origin]);

  const onAddSelection = useCallback(() => {
    const r = addSelection();
    watchLog(r.ok ? "info" : "warn", r.ok ? "Added the selected object to the watchlist." : (r.reason ?? "Could not add the selection."));
  }, [addSelection]);

  const onPublish = useCallback(async () => {
    if (!wl) return;
    try {
      const res = await fetch("/api/watch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ watchlist: wl }) });
      const body = (await res.json()) as { data?: { id: string; stored: boolean; shortUrls: Record<string, string> | null }; error?: string; details?: string[]; caveats?: string[] };
      if (!res.ok || !body.data) {
        watchLog("warn", `Publish failed: ${body.error ?? res.status}${body.details ? " · " + body.details.join("; ") : ""}`);
        return;
      }
      setPublished(body.data);
      watchLog("info", body.data.stored ? `Published as id ${body.data.id}; short feed URLs are ready.` : `Token minted; this server keeps no store, so use the token URLs. ${(body.caveats ?? []).join(" ")}`);
    } catch (err) {
      watchLog("warn", `Publish failed: ${err instanceof Error ? err.message : "network error"}`);
    }
  }, [wl]);

  const onSendTest = useCallback(async () => {
    if (!wl) return;
    const url = webhooks[wl.id] ?? "";
    if (!url) return watchLog("warn", "Enter a webhook URL first.");
    if (signingSecret.length < 8) return watchLog("warn", "The signing secret needs at least 8 characters.");
    if (!cronSecret) return watchLog("warn", "Sending needs the server's GEV_CRON_SECRET (paste it in the field; it is kept in memory only).");
    setSending(true);
    try {
      const res = await fetch("/api/watch?op=test-webhook", { method: "POST", headers: { "content-type": "application/json", "x-gev-cron-secret": cronSecret }, body: JSON.stringify({ url, secret: signingSecret }) });
      const body = (await res.json()) as { data?: { ok: boolean; status: number; attempts: number; error?: string }; error?: string };
      if (!res.ok || !body.data) watchLog("warn", `Test webhook: ${body.error ?? body.data?.error ?? `HTTP ${res.status}`}`);
      else watchLog(body.data.ok ? "info" : "warn", body.data.ok ? `Test webhook delivered (HTTP ${body.data.status}, ${body.data.attempts} attempt${body.data.attempts === 1 ? "" : "s"}).` : `Test webhook failed: ${body.data.error ?? body.data.status}`);
    } catch (err) {
      watchLog("warn", `Test webhook failed: ${err instanceof Error ? err.message : "network error"}`);
    } finally {
      setSending(false);
    }
  }, [wl, webhooks, signingSecret, cronSecret]);

  const onImportFile = useCallback(
    (file: File | undefined) => {
      if (!file) return;
      file.text().then((text) => {
        const r = importJson(text);
        watchLog(r.ok ? "info" : "warn", r.ok ? `Imported watchlist ${r.id}.` : `Import failed: ${r.reason}`);
      });
    },
    [importJson],
  );

  if (!open) return null;

  const events = data && data.id === wl?.id ? data.data.events : [];
  const [draftRef, draftMetric] = wl?.items.length ? ["*", metricChoices(wl, "*", resolved)[0] ?? "value"] : ["*", "value"];

  return (
    <div className="hud-panel pointer-events-auto flex max-h-[min(62vh,720px)] flex-col">
      <div className="flex items-start justify-between gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <div className="hud-label" style={{ color: "#FBBF24" }}>
            <Bell className="mr-1 inline size-3" />
            Watchlist
          </div>
          {wl ? (
            <input
              className="hud-display w-full truncate bg-transparent text-[15px] font-semibold leading-tight text-foreground outline-none"
              value={wl.title}
              onChange={(e) => rename(wl.id, e.target.value)}
              aria-label="Watchlist title"
            />
          ) : (
            <div className="hud-display text-[15px] font-semibold leading-tight text-foreground">no list yet</div>
          )}
          <div className="text-[9px] text-muted-foreground">
            {wl ? `${wl.items.length} item${wl.items.length === 1 ? "" : "s"} · ${wl.rules.length} rule${wl.rules.length === 1 ? "" : "s"}` : "kept in this browser"}
            {data && data.id === wl?.id ? ` · evaluated ${new Date(data.generatedAt).toISOString().slice(11, 16)}Z${data.stateful ? " · stateful" : " · stateless"}` : ""}
            {loading ? " · loading…" : ""}
          </div>
        </div>
        <div className="flex shrink-0 gap-0.5">
          <button type="button" onClick={refresh} className={iconBtn} aria-label="Re-evaluate" title="Re-evaluate now">
            <RefreshCw className="size-3.5" />
          </button>
          <button type="button" onClick={() => wl && downloadText(`watchlist-${wl.id}.json`, JSON.stringify(wl, null, 2), "application/json")} className={iconBtn} aria-label="Export JSON" title="Export JSON" disabled={!wl}>
            <FileDown className="size-3.5" />
          </button>
          <button type="button" onClick={() => fileRef.current?.click()} className={iconBtn} aria-label="Import JSON" title="Import JSON">
            <Upload className="size-3.5" />
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => onImportFile(e.target.files?.[0])} />
          <button type="button" onClick={() => setOpen(false)} className={iconBtn} aria-label="Close">
            <X className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="min-h-0 overflow-y-auto">
        <section className="flex items-center gap-1 border-t border-border/60 px-3 py-2">
          <select className={`${inputCls} flex-1`} value={activeId ?? ""} onChange={(e) => setActive(e.target.value || null)} aria-label="Watchlist">
            {!watchlists.length && <option value="">(none)</option>}
            {watchlists.map((w) => (
              <option key={w.id} value={w.id}>
                {w.title}
              </option>
            ))}
          </select>
          <button type="button" className={btnCls} onClick={() => create()} title="New watchlist">
            <Plus className="inline size-3" /> new
          </button>
          <button type="button" className={btnCls} onClick={() => wl && remove(wl.id)} disabled={!wl} title="Delete this watchlist">
            <Trash2 className="inline size-3" />
          </button>
        </section>

        <section className="border-t border-border/60 px-3 py-2">
          <div className="flex items-baseline justify-between">
            <span className="hud-label">Items</span>
            <button type="button" className={btnCls} onClick={onAddSelection} disabled={!selected} title={selected ? `Add ${selected.layer} ${selected.id}` : "Select something on the globe first"}>
              <Crosshair className="inline size-3" /> add selected
            </button>
          </div>
          {wl?.items.length ? (
            <ul className="mt-1 divide-y divide-border/40">
              {wl.items.map((it, i) => (
                <ItemRow key={`${it.kind}:${it.id}`} item={it} resolved={resolved[i]} onRemove={() => removeItem(i)} />
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-[10px] text-muted-foreground">Select a county, state, port, crossing or gauge on the globe and press “add selected”. Series and indicators can be added by importing JSON.</p>
          )}
          {error && (
            <p className="mt-1 text-[9px]" style={{ color: "var(--warn)" }}>
              {error}
            </p>
          )}
        </section>

        <section className="border-t border-border/60 px-3 py-2">
          <div className="flex items-baseline justify-between">
            <span className="hud-label">Rules</span>
            <button type="button" className={btnCls} onClick={() => addRule({ itemRef: draftRef as "*", metric: draftMetric, op: ">=", value: 0 })} disabled={!wl || !wl.items.length} title="Add a rule">
              <Plus className="inline size-3" /> rule
            </button>
          </div>
          {wl?.rules.length ? (
            <ul className="mt-1 space-y-1">
              {wl.rules.map((r, i) => (
                <RuleRow key={i} wl={wl} rule={r} index={i} resolved={resolved} />
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-[10px] text-muted-foreground">No rules: the feed carries a digest of current values only.</p>
          )}
          {events.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {events.map((e, i) => (
                <li key={i} className="text-[10px] leading-snug" style={{ color: "var(--alert)" }}>
                  {e.message}
                </li>
              ))}
            </ul>
          )}
          {data && data.id === wl?.id && data.caveats?.length ? <p className="mt-1 text-[9px] leading-snug text-muted-foreground/80">{data.caveats.join(" ")}</p> : null}
        </section>

        <section className="border-t border-border/60 px-3 py-2">
          <span className="hud-label">Feeds</span>
          <p className="mt-0.5 text-[9px] leading-snug text-muted-foreground">The URL carries the whole list; treat it like a password.</p>
          {urls ? (
            <ul className="mt-1 space-y-0.5">
              {(["rss", "atom", "json"] as const).map((k) => (
                <li key={k} className="flex items-center gap-1 text-[10px]">
                  <span className="w-8 uppercase text-muted-foreground">{k}</span>
                  <a href={urls[k]} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-foreground/80 hover:text-primary">
                    {urls[k].replace(origin, "")}
                  </a>
                  <button type="button" className={iconBtn} onClick={() => copyText(urls[k], `${k.toUpperCase()} feed URL copied.`)} aria-label={`Copy ${k} URL`} title="Copy URL">
                    <Copy className="size-3" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-[10px] text-muted-foreground">Create a list to get feed URLs.</p>
          )}
          <div className="mt-1 flex items-center gap-2">
            <button type="button" className={btnCls} onClick={() => void onPublish()} disabled={!wl}>
              publish
            </button>
            <span className="text-[9px] text-muted-foreground">{published && published.id === wl?.id ? (published.stored ? `short id ${published.id}` : "token only (server keeps no store)") : "mint a short id where the server keeps a store"}</span>
          </div>
          {published?.shortUrls && published.id === wl?.id && (
            <ul className="mt-1 space-y-0.5">
              {Object.entries(published.shortUrls).map(([k, u]) => (
                <li key={k} className="flex items-center gap-1 text-[10px]">
                  <span className="w-8 uppercase text-muted-foreground">{k}</span>
                  <span className="min-w-0 flex-1 truncate text-foreground/80">{u.replace(origin, "")}</span>
                  <button type="button" className={iconBtn} onClick={() => copyText(u, `${k.toUpperCase()} short URL copied.`)} aria-label={`Copy short ${k} URL`} title="Copy URL">
                    <Copy className="size-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="border-t border-border/60 px-3 py-2">
          <span className="hud-label">Webhook</span>
          <p className="mt-0.5 text-[9px] leading-snug text-muted-foreground">
            The server POSTs events as JSON with <code>X-GEV-Signature: sha256=&lt;HMAC of the body with your signing secret&gt;</code>. Public https only. Sending needs the operator&apos;s <code>GEV_CRON_SECRET</code>; both secrets stay in memory here.
          </p>
          <input className={`${inputCls} mt-1 w-full`} placeholder="https://receiver.example/hook" value={wl ? (webhooks[wl.id] ?? "") : ""} onChange={(e) => wl && setWebhook(wl.id, e.target.value)} disabled={!wl} aria-label="Webhook URL" />
          <div className="mt-1 grid grid-cols-2 gap-1">
            <input className={inputCls} type="password" placeholder="signing secret (8+)" value={signingSecret} onChange={(e) => setSigningSecret(e.target.value)} aria-label="Signing secret" autoComplete="off" />
            <input className={inputCls} type="password" placeholder="GEV_CRON_SECRET" value={cronSecret} onChange={(e) => setCronSecret(e.target.value)} aria-label="Server cron secret" autoComplete="off" />
          </div>
          <button type="button" className={`${btnCls} mt-1`} onClick={() => void onSendTest()} disabled={!wl || sending}>
            {sending ? "sending…" : "send test"}
          </button>
        </section>
      </div>
    </div>
  );
}
