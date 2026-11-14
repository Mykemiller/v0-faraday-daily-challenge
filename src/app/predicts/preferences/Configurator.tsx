"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import {
  COPY, clampInt, filterNamed, formatDate, formatProbability, sameDocument, toDocument, toggle,
  type GetResponse, type Horizon, type KeyPlayer, type Named, type Options, type Prefs, type Preview,
} from "@/lib/predicts-preferences";
import { PWA_COPY } from "@/lib/predicts-pwa";
import { usePredictsToken } from "../hooks/usePredictsToken";
import PushToggle from "./PushToggle";

// The configurator (FDY-119). Sections in the decided order, chips are buttons with
// aria-pressed, sliders pair with labelled number inputs, and the live preview re-fetches
// 400 ms after the last change via ?preview=1 (which never saves). IDF §06: chosen names
// show as chips; there is no count of Theaters, Sectors or Threads anywhere on the page.

type Phase = { kind: "loading" } | { kind: "invalid" } | { kind: "error" } | { kind: "ready"; data: GetResponse };

const FETCH_INIT: RequestInit = { cache: "no-store", referrerPolicy: "no-referrer", credentials: "omit" };

export function ConfiguratorSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading your preferences" className="animate-pulse">
      <div className="h-9 w-2/3 rounded bg-warm-cream" />
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-28 rounded-xl bg-warm-cream" />)}
        </div>
        <div className="h-72 rounded-xl bg-warm-cream" />
      </div>
    </div>
  );
}

function Notice({ text }: { text: string }) {
  return (
    <div className="mx-auto max-w-xl rounded-xl border border-cream-border bg-warm-cream p-6 text-center">
      <p className="font-serif text-[18px] leading-snug text-near-black">{text}</p>
    </div>
  );
}

type PushProps = { pushUrl: string; vapidKey: string | null };

export default function Configurator({ apiUrl, pushUrl, vapidKey }: { apiUrl: string } & PushProps) {
  // FDY-127: ?t= wins; an installed app (no ?t=) uses the token this device kept from its last link visit.
  const { token, forget } = usePredictsToken();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });

  useEffect(() => {
    let live = true;
    const run = async () => {
      if (!token) return { kind: "invalid" } as Phase;
      try {
        const r = await fetch(`${apiUrl}?t=${encodeURIComponent(token)}`, FETCH_INIT);
        if (r.status === 404) { forget(); return { kind: "invalid" } as Phase; }
        if (!r.ok) return { kind: "error" } as Phase;
        const data = (await r.json()) as GetResponse;
        return data?.ok ? ({ kind: "ready", data } as Phase) : ({ kind: "error" } as Phase);
      } catch {
        return { kind: "error" } as Phase;
      }
    };
    run().then((p) => { if (live) setPhase(p); });
    return () => { live = false; };
  }, [apiUrl, token, forget]);

  if (phase.kind === "loading") return <ConfiguratorSkeleton />;
  if (phase.kind === "invalid") return <Notice text={COPY.invalidToken} />;
  if (phase.kind === "error") return <Notice text={COPY.unavailable} />;
  return <Editor apiUrl={apiUrl} token={token} data={phase.data} pushUrl={pushUrl} vapidKey={vapidKey} />;
}

// ── the editor ───────────────────────────────────────────────────────────────

function Editor({ apiUrl, token, data, pushUrl, vapidKey }: { apiUrl: string; token: string; data: GetResponse } & PushProps) {
  const opts = data.options;
  const [saved, setSaved] = useState<Prefs>(data.effective_preferences);
  const [draft, setDraft] = useState<Prefs>(data.effective_preferences);
  const [errors, setErrors] = useState<string[]>([]);
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [names, setNames] = useState<Map<string, string>>(
    () => new Map([...opts.key_players, ...opts.selected_key_players].map((k) => [k.id, k.name])),
  );
  const dirty = !sameDocument(draft, saved);
  const url = `${apiUrl}?t=${encodeURIComponent(token)}`;

  const set = useCallback(<K extends keyof Prefs>(k: K, v: Prefs[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setStatus("");
  }, []);

  // Unsaved-changes guard.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  // Live preview, 400 ms after the last change. Never saves.
  const doc = useMemo(() => JSON.stringify(toDocument(draft)), [draft]);
  const [preview, setPreview] = useState<{ loading: boolean; data: Preview | null; errors: string[]; failed: boolean }>({ loading: true, data: null, errors: [], failed: false });
  useEffect(() => {
    const ctl = new AbortController();
    const timer = setTimeout(async () => {
      setPreview((p) => ({ ...p, loading: true }));
      try {
        const r = await fetch(`${url}&preview=1`, { ...FETCH_INIT, method: "POST", body: JSON.stringify({ preferences: JSON.parse(doc) }), headers: { "Content-Type": "application/json" }, signal: ctl.signal });
        const b = await r.json();
        if (!r.ok) throw new Error(String(r.status));
        setPreview({ loading: false, data: b.preview ?? null, errors: b.errors ?? [], failed: false });
      } catch (e) {
        if ((e as Error).name !== "AbortError") setPreview({ loading: false, data: null, errors: [], failed: true });
      }
    }, 400);
    return () => { clearTimeout(timer); ctl.abort(); };
  }, [doc, url]);

  async function save(body: Record<string, unknown>) {
    // FDY-127 D2: no offline writes, and none queued.
    if (typeof navigator !== "undefined" && !navigator.onLine) { setErrors([PWA_COPY.offlineWriteRefused]); return; }
    setBusy(true);
    setErrors([]);
    setStatus("");
    try {
      const r = await fetch(url, { ...FETCH_INIT, method: "POST", body: JSON.stringify({ preferences: body }), headers: { "Content-Type": "application/json" } });
      const b = await r.json().catch(() => null);
      if (!r.ok || !b) { setErrors([COPY.unavailable]); return; }
      if (!b.ok) { setErrors((b.errors as string[]) ?? [COPY.unavailable]); return; }
      setSaved(b.effective_preferences);
      setDraft(b.effective_preferences);
      setStatus("Saved.");
    } catch {
      setErrors([COPY.unavailable]);
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    if (window.confirm("Reset to the house view? Your choices on this page will be cleared.")) void save({});
  }

  const addPlayer = (k: KeyPlayer) => {
    setNames((m) => new Map(m).set(k.id, k.name));
    set("key_players", toggle(draft.key_players, k.id));
  };

  return (
    <div>
      <h1 className="font-display text-[clamp(26px,4.5vw,36px)] font-bold leading-tight tracking-tight text-near-black">Your preferences</h1>
      <p className="mt-1 font-serif text-[clamp(16px,2.2vw,19px)] italic text-forest">Choose what your Faraday Predicts email covers.</p>
      <div className="double-rule" aria-hidden />

      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
        <form className="min-w-0 space-y-8" onSubmit={(e) => { e.preventDefault(); void save(toDocument(draft)); }}>
          <ChipSection title="Theaters" items={opts.theaters} chosen={draft.theaters} onToggle={(c) => set("theaters", toggle(draft.theaters, c))} />
          <ChipSection title="Sectors" items={opts.sectors} chosen={draft.sectors} onToggle={(c) => set("sectors", toggle(draft.sectors, c))} searchable />
          <ThreadSection groups={opts.thread_groups} chosen={draft.threads} onToggle={(c) => set("threads", toggle(draft.threads, c))} />
          <KeyPlayerSection
            url={url}
            top={opts.key_players}
            chosen={draft.key_players}
            names={names}
            onToggle={addPlayer}
          />

          <Section title="Horizons">
            <div className="flex flex-wrap gap-2">
              {opts.horizons.map((h) => (
                <Chip key={h.key} label={h.label} pressed={draft.horizons.includes(h.key)} onClick={() => set("horizons", toggle<Horizon>(draft.horizons, h.key))} />
              ))}
            </div>
          </Section>

          <Section title="Minimum probability">
            <RangeWithNumber label="Minimum probability" min={1} max={99} value={draft.min_probability} suffix="%" onChange={(v) => set("min_probability", v)} />
            <p className="mt-2 font-sans text-[14px] text-near-black/75">{COPY.boldHelper}</p>
          </Section>

          <Section title="Bold Calls">
            <Switch label="Include Bold Calls" checked={draft.include_bold} onChange={(v) => set("include_bold", v)} />
          </Section>

          <Section title="Frequency">
            <fieldset>
              <legend className="sr-only">Frequency</legend>
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                {opts.frequencies.map((f) => (
                  <label key={f.key} className="flex min-h-[44px] items-center gap-2 font-sans text-[15px]">
                    <input type="radio" name="frequency" value={f.key} checked={draft.frequency === f.key} onChange={() => set("frequency", f.key)} className="h-4 w-4 accent-forest" />
                    {f.label}
                  </label>
                ))}
              </div>
            </fieldset>
            {draft.frequency === "weekly" && (
              <label className="mt-2 flex flex-wrap items-center gap-2 font-sans text-[15px]">
                <span>Send on</span>
                <select value={draft.weekly_dow} onChange={(e) => set("weekly_dow", Number(e.target.value))} className="min-h-[44px] rounded-lg border border-cream-edge bg-warm-panel px-3">
                  {opts.weekdays.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
                </select>
              </label>
            )}
          </Section>

          <Section title="Channels">
            <ul className="space-y-2">
              {opts.channels.map((c) => (
                <li key={c.key}>
                  {c.available ? (
                    <Switch label={c.label} checked={draft.channels[c.key]} onChange={(v) => set("channels", { ...draft.channels, [c.key]: v })} />
                  ) : (
                    <Switch label={c.label} checked={false} disabled note={COPY.comingSoon} onChange={() => {}} />
                  )}
                </li>
              ))}
            </ul>
            <div className="mt-3">
              <PushToggle token={token} subscribeUrl={pushUrl} vapidKey={vapidKey} />
            </div>
          </Section>

          <Section title="Quiet hours">
            <div className="flex flex-wrap items-end gap-4">
              {(["start", "end"] as const).map((k) => (
                <label key={k} className="flex flex-col gap-1 font-sans text-[14px]">
                  <span>{k === "start" ? "From" : "Until"}</span>
                  <input
                    type="time"
                    value={draft.quiet_hours?.[k] ?? ""}
                    onChange={(e) => set("quiet_hours", { start: draft.quiet_hours?.start ?? "", end: draft.quiet_hours?.end ?? "", [k]: e.target.value })}
                    className="min-h-[44px] rounded-lg border border-cream-edge bg-warm-panel px-3 font-mono text-[15px]"
                  />
                </label>
              ))}
              {draft.quiet_hours && (
                <button type="button" onClick={() => set("quiet_hours", null)} className="min-h-[44px] rounded-full px-4 font-sans text-[14px] font-medium text-forest underline underline-offset-4">
                  Clear
                </button>
              )}
            </div>
            {data.timezone && <p className="mt-2 font-sans text-[14px] text-near-black/75">Times are in {data.timezone.replace(/_/g, " ")}.</p>}
          </Section>

          <Section title="Tone and persona">
            <label className="flex flex-col gap-1 font-sans text-[14px]">
              <span>Persona</span>
              <select
                value={draft.persona_key ?? ""}
                onChange={(e) => set("persona_key", e.target.value || null)}
                className="min-h-[44px] max-w-sm rounded-lg border border-cream-edge bg-warm-panel px-3 text-[15px]"
              >
                {opts.personas.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
              </select>
            </label>
            <div className="mt-4">
              <RangeWithNumber label="Tone" min={1} max={10} value={draft.tone_level ?? 7} onChange={(v) => set("tone_level", v)} />
            </div>
          </Section>

          <div className="sticky bottom-[72px] z-10 -mx-4 border-t border-cream-border bg-warm-white/95 px-4 py-3 backdrop-blur md:bottom-0">
            {errors.length > 0 && (
              <ul role="alert" className="mb-3 space-y-1 rounded-lg border border-brick/40 bg-warm-panel p-3 font-sans text-[14px] text-brick">
                {errors.map((e) => <li key={e}>{e}</li>)}
              </ul>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" disabled={busy || !dirty} className="min-h-[44px] rounded-full bg-forest px-6 font-sans text-[15px] font-semibold text-warm-white disabled:bg-cream-edge disabled:text-near-black/70">
                {COPY.save}
              </button>
              <button type="button" onClick={reset} disabled={busy} className="min-h-[44px] rounded-full border border-forest px-5 font-sans text-[15px] font-medium text-forest">
                {COPY.reset}
              </button>
              <span role="status" className="font-sans text-[14px] text-sage-dark">{status || (dirty ? "Unsaved changes" : "")}</span>
            </div>
          </div>
        </form>

        <PreviewPanel state={preview} />
      </div>
    </div>
  );
}

// ── building blocks ──────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="border-b border-cream-line pb-6">
      <h2 id={id} className="mb-3 font-serif text-[20px] font-bold text-near-black">{title}</h2>
      {children}
    </section>
  );
}

function Chip({ label, pressed, onClick }: { label: string; pressed: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`inline-flex min-h-[40px] max-w-full items-center rounded-full border px-3.5 text-left font-sans text-[14px] leading-tight ${
        pressed ? "border-forest bg-forest text-warm-white" : "border-cream-edge bg-warm-panel text-near-black hover:border-forest"
      }`}
    >
      <span className="break-words">{label}</span>
    </button>
  );
}

function SearchField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="mb-3 block max-w-sm font-sans text-[14px]">
      <span className="sr-only">{label}</span>
      <input
        type="search"
        value={value}
        placeholder={label}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-[44px] w-full rounded-lg border border-cream-edge bg-warm-panel px-3 text-[15px] placeholder:text-near-black/70"
      />
    </label>
  );
}

function ChipSection({ title, items, chosen, onToggle, searchable = false }: { title: string; items: Named[]; chosen: string[]; onToggle: (code: string) => void; searchable?: boolean }) {
  const [q, setQ] = useState("");
  const shown = searchable ? filterNamed(items, q) : items;
  return (
    <Section title={title}>
      {searchable && <SearchField label={`Search ${title}`} value={q} onChange={setQ} />}
      <div className="flex flex-wrap gap-2">
        {shown.map((i) => <Chip key={i.code} label={i.name} pressed={chosen.includes(i.code)} onClick={() => onToggle(i.code)} />)}
      </div>
    </Section>
  );
}

function ThreadSection({ groups, chosen, onToggle }: { groups: Options["thread_groups"]; chosen: string[]; onToggle: (code: string) => void }) {
  const [q, setQ] = useState("");
  const byCode = useMemo(() => new Map(groups.flatMap((g) => g.threads.map((t) => [t.code, t.name] as const))), [groups]);
  const shown = groups.map((g) => ({ ...g, threads: filterNamed(g.threads, q) })).filter((g) => g.threads.length > 0);
  return (
    <Section title="Threads">
      {chosen.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2" aria-label="Your Threads">
          {chosen.map((c) => <Chip key={c} label={byCode.get(c) ?? c} pressed onClick={() => onToggle(c)} />)}
        </div>
      )}
      <SearchField label="Search Threads" value={q} onChange={setQ} />
      <div className="space-y-2">
        {shown.map((g) => (
          <details key={g.sector_code} open={q.trim().length > 0} className="rounded-lg border border-cream-border bg-warm-white">
            <summary className="flex min-h-[44px] cursor-pointer items-center px-3 font-sans text-[15px] font-medium text-near-black">{g.sector_name}</summary>
            <div className="flex flex-wrap gap-2 px-3 pb-3">
              {g.threads.map((t) => <Chip key={t.code} label={t.name} pressed={chosen.includes(t.code)} onClick={() => onToggle(t.code)} />)}
            </div>
          </details>
        ))}
      </div>
    </Section>
  );
}

function KeyPlayerSection({ url, top, chosen, names, onToggle }: { url: string; top: KeyPlayer[]; chosen: string[]; names: Map<string, string>; onToggle: (k: KeyPlayer) => void }) {
  const [q, setQ] = useState("");
  const [found, setFound] = useState<KeyPlayer[] | null>(null);
  useEffect(() => {
    const needle = q.trim();
    const ctl = new AbortController();
    const timer = setTimeout(async () => {
      if (needle.length < 2) { setFound(null); return; }
      try {
        const r = await fetch(`${url}&players=${encodeURIComponent(needle)}`, { ...FETCH_INIT, signal: ctl.signal });
        const b = await r.json();
        setFound(r.ok && b.ok ? (b.key_players as KeyPlayer[]) : []);
      } catch { /* aborted or offline: keep the top list */ }
    }, 250);
    return () => { clearTimeout(timer); ctl.abort(); };
  }, [q, url]);
  const list = found ?? top;
  return (
    <Section title="Key Players">
      {chosen.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2" aria-label="Your Key Players">
          {chosen.map((id) => <Chip key={id} label={names.get(id) ?? id} pressed onClick={() => onToggle({ id, name: names.get(id) ?? id })} />)}
        </div>
      )}
      <SearchField label="Search Key Players" value={q} onChange={setQ} />
      <div className="flex flex-wrap gap-2" aria-live="polite">
        {list.filter((k) => !chosen.includes(k.id)).map((k) => <Chip key={k.id} label={k.name} pressed={false} onClick={() => onToggle(k)} />)}
        {found && found.length === 0 && <p className="font-sans text-[14px] text-near-black/75">No Key Player matches that.</p>}
      </div>
    </Section>
  );
}

function RangeWithNumber({ label, min, max, value, suffix, onChange }: { label: string; min: number; max: number; value: number; suffix?: string; onChange: (v: number) => void }) {
  const id = useId();
  const [text, setText] = useState(String(value));
  const [last, setLast] = useState(value);
  if (last !== value) { setLast(value); setText(String(value)); }
  return (
    <div className="flex flex-wrap items-center gap-4">
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        aria-label={`${label} slider`}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full max-w-xs accent-forest"
      />
      <label htmlFor={id} className="flex items-center gap-2 font-sans text-[14px]">
        <span className="sr-only">{label}</span>
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            const v = clampInt(e.target.value, min, max);
            if (v !== null) onChange(v);
          }}
          onBlur={() => setText(String(value))}
          className="min-h-[44px] w-20 rounded-lg border border-cream-edge bg-warm-panel px-3 font-mono text-[15px]"
        />
        {suffix && <span aria-hidden>{suffix}</span>}
      </label>
    </div>
  );
}

function Switch({ label, checked, onChange, disabled = false, note }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; note?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex min-h-[44px] items-center gap-3 font-sans text-[15px] text-near-black disabled:cursor-not-allowed"
    >
      <span aria-hidden className={`relative inline-block h-6 w-11 shrink-0 rounded-full border transition-colors ${checked ? "border-forest bg-forest" : "border-near-black/50 bg-cream-edge"}`}>
        <span className={`absolute top-0.5 h-[18px] w-[18px] rounded-full bg-warm-white shadow transition-[left] ${checked ? "left-[22px]" : "left-0.5"}`} />
      </span>
      <span className={disabled ? "text-near-black/70" : ""}>{label}</span>
      {note && <span className="rounded-full bg-warm-cream px-2 py-0.5 font-mono text-[12px] text-near-black/80">{note}</span>}
    </button>
  );
}

function PreviewPanel({ state }: { state: { loading: boolean; data: Preview | null; errors: string[]; failed: boolean } }) {
  return (
    <aside aria-labelledby="fp-preview-title" className="min-w-0 lg:sticky lg:top-28 lg:self-start">
      <div className="rounded-xl border border-cream-border bg-warm-panel p-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="fp-preview-title" className="font-serif text-[20px] font-bold text-near-black">Live preview</h2>
          {state.loading && <span className="font-mono text-[12px] text-sage-dark">Updating…</span>}
        </div>
        <p className="font-sans text-[14px] text-near-black/75">What tomorrow&apos;s email would look like</p>
        <div aria-live="polite" className="mt-3">
          {state.failed && <p className="font-sans text-[15px] text-near-black">{COPY.unavailable}</p>}
          {state.errors.length > 0 && (
            <ul className="space-y-1 font-sans text-[14px] text-brick">{state.errors.map((e) => <li key={e}>{e}</li>)}</ul>
          )}
          {state.data && (
            <>
              <p className="font-sans text-[15px] font-medium text-forest">{state.data.frequency_sentence}</p>
              {state.data.empty_message && <p className="mt-3 font-sans text-[15px] text-near-black">{state.data.empty_message}</p>}
              {state.data.sections.map((s) => (
                <section key={s.horizon} className="mt-4">
                  <h3 className="border-b border-cream-border pb-1 font-mono text-[12px] uppercase tracking-wider text-sage-dark">{s.label}</h3>
                  <ul className="mt-2 space-y-3">
                    {s.items.map((it, i) => (
                      <li key={`${s.horizon}-${i}`} className="font-sans text-[15px] leading-snug text-near-black">
                        <p className="break-words">{it.text}</p>
                        <p className="mt-1 flex flex-wrap items-center gap-x-2 font-sans text-[13px] text-near-black/75">
                          <span className="font-mono font-semibold text-near-black">{formatProbability(it.probability)}</span>
                          {it.bold && <span className="rounded bg-gold-light px-1.5 font-semibold text-near-black">Bold Call</span>}
                          {formatDate(it.resolves_by) && <span>Resolves by {formatDate(it.resolves_by)}</span>}
                          {it.sector && <span>{it.sector}</span>}
                        </p>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
