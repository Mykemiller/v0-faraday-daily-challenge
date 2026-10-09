"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  BOLD_CALL_TOOLTIP,
  buildApiQuery,
  buildUrl,
  emptyHorizonMessage,
  formatDate,
  HORIZON_LABELS,
  NO_MISSES_LINE,
  parseUrlState,
  trackRecord,
  verdictBadge,
  type PredictsResponse,
  type PredictsRow,
  type PredictsUrlState,
} from "@/lib/predicts";

// Faraday Predicts — the interactive half of /predicts (26-41-v01 P9, FDY-147).
//
// Every colour here is a locked @theme token (globals.css). The two verdict
// tones use the ratified AA variants: `sage-dark` is the palette's green
// (5.45:1 on warm white) and `amber-dark` its amber (5.37:1) — the raw `sage`
// and `gold` tokens fall below 4.5:1 at these label sizes, which is exactly
// what those variants exist for.
//
// ACCESS (§10): open and free at launch. No token metering, and deliberately no
// metering copy anywhere on this surface.

type Props = { apiUrl: string };

// Keyed by the query it was fetched for. "Loading" is DERIVED (the data I hold
// is not for the state I am rendering) rather than set — that keeps setState
// out of the effect body, and makes a stale card flash structurally impossible
// instead of merely unlikely.
type Load =
  | { key: string; phase: "error" }
  | { key: string; phase: "ready"; data: PredictsResponse };

const ERROR_COPY = "Forecasts are unavailable right now — try again shortly.";

type Phase = "loading" | "error" | "ready";

export default function PredictsView({ apiUrl }: Props) {
  const searchParams = useSearchParams();

  // The URL is the initial source of truth; React state is the render source
  // after that. Both are kept in step by pushState + a popstate listener rather
  // than by router.push, so the back button is driven by the browser's own
  // history and does not depend on a soft-navigation round trip.
  const [state, setState] = useState<PredictsUrlState>(() => parseUrlState(searchParams));
  const [load, setLoad] = useState<Load | null>(null);

  // The release tag and the record come from whichever response landed last and
  // are identical across views, so they are held outside `load`: switching view
  // must not blank the footer or the track-record strip while the next fetch is
  // in flight.
  const [meta, setMeta] = useState<{ releaseTag: string | null; record: PredictsResponse["record"] | null; horizonCounts: PredictsResponse["horizon_counts"] }>(
    { releaseTag: null, record: null, horizonCounts: {} },
  );

  // ── URL state (§6) ──────────────────────────────────────────────────────
  const go = useCallback((next: PredictsUrlState) => {
    setState(next);
    window.history.pushState(null, "", buildUrl(next));
  }, []);

  useEffect(() => {
    const onPop = () => setState(parseUrlState(new URLSearchParams(window.location.search)));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // ── fetch ───────────────────────────────────────────────────────────────
  const query = buildApiQuery(state);
  const seq = useRef(0);
  useEffect(() => {
    const mine = ++seq.current;
    const ac = new AbortController();

    // TODO(FDY-147): token gating decision
    fetch(`${apiUrl}?${query}`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: PredictsResponse) => {
        if (mine !== seq.current) return; // a newer request has started
        if (!data?.ok || !Array.isArray(data.predictions)) throw new Error("bad payload");
        setLoad({ key: query, phase: "ready", data });
        setMeta({ releaseTag: data.release_tag, record: data.record, horizonCounts: data.horizon_counts ?? {} });
      })
      .catch((err) => {
        if (ac.signal.aborted || mine !== seq.current) return;
        console.error("predicts fetch failed", err);
        setLoad({ key: query, phase: "error" });
      });

    return () => ac.abort();
  }, [apiUrl, query]);

  // Anything not keyed to the query now on screen is still loading.
  const phase: Phase = load?.key === query ? load.phase : "loading";
  const tr = trackRecord(meta.record);

  return (
    <>
      {/* ── Track-record strip (§2) ───────────────────────────────────── */}
      <section aria-label="Track record" className="mt-8 rounded-xl border border-warm-gray/60 bg-warm-cream px-5 py-4">
        {tr ? (
          <>
            <p className="font-mono text-[12px] leading-relaxed tracking-[0.02em] text-near-black">{tr.line}</p>
            {/* Verbatim from the engine's own calibration snapshot — the reason
                the headline is not to be read as a win rate. */}
            {tr.caveat && <p className="mt-2 font-sans text-[12px] leading-relaxed text-near-black/60">{tr.caveat}</p>}
            {tr.noMisses && <p className="mt-2 font-sans text-[12px] leading-relaxed text-near-black/60">{NO_MISSES_LINE}</p>}
          </>
        ) : (
          <p className="h-4 w-80 max-w-full animate-pulse rounded bg-warm-gray/40" aria-hidden />
        )}
      </section>

      {/* ── View switch (§3) ─────────────────────────────────────────── */}
      <div role="group" aria-label="Which forecasts to show" className="mt-8 inline-flex rounded-lg border border-warm-gray bg-warm-white p-1">
        {([
          { view: "open" as const, label: "Open forecasts" },
          { view: "right" as const, label: "Faraday got it right" },
        ]).map((opt) => {
          const active = state.view === opt.view;
          return (
            <button
              key={opt.view}
              type="button"
              aria-pressed={active}
              onClick={() => go({ ...state, view: opt.view })}
              className={`rounded-md px-3.5 py-2 font-mono text-[12px] transition-colors ${
                active ? "bg-forest text-warm-white" : "text-near-black/70 hover:text-forest"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {state.view === "open" ? (
        <>
          {/* ── Horizon selector (§4) ─────────────────────────────────── */}
          <div role="group" aria-label="Forecast horizon" className="mt-5 flex flex-wrap gap-2">
            {HORIZON_LABELS.map((h) => {
              const active = state.horizon === h.bucket;
              const n = meta.horizonCounts?.[h.bucket];
              return (
                <button
                  key={h.bucket}
                  type="button"
                  aria-pressed={active}
                  onClick={() => go({ ...state, horizon: h.bucket })}
                  className={`rounded-full border px-3.5 py-1.5 font-mono text-[12px] transition-colors ${
                    active
                      ? "border-gold bg-warm-cream text-near-black"
                      : "border-warm-gray text-near-black/70 hover:border-gold hover:text-forest"
                  }`}
                >
                  {h.label}
                  {typeof n === "number" && (
                    <span className="ml-1.5 text-near-black/70">{n}</span>
                  )}
                </button>
              );
            })}
          </div>
          <Body phase={phase} data={load?.key === query && load.phase === "ready" ? load.data : null} state={state} />
        </>
      ) : (
        <>
          {/* ── Include-partly-right toggle (§5) ──────────────────────── */}
          <div className="mt-5">
            <button
              type="button"
              aria-pressed={state.includePartial}
              onClick={() => go({ ...state, includePartial: !state.includePartial })}
              className={`rounded-full border px-3.5 py-1.5 font-mono text-[12px] transition-colors ${
                state.includePartial
                  ? "border-amber-dark/50 bg-amber-dark/10 text-amber-dark"
                  : "border-warm-gray text-near-black/70 hover:border-gold hover:text-forest"
              }`}
            >
              Include partly right
            </button>
          </div>
          <Body phase={phase} data={load?.key === query && load.phase === "ready" ? load.data : null} state={state} />
        </>
      )}

      {/* ── Release footer (§7) — from the API, never hardcoded ───────── */}
      <p className="mt-12 border-t border-warm-gray/50 pt-5 font-mono text-[11px] text-near-black/65">
        Faraday Predicts{meta.releaseTag ? ` · Release ${meta.releaseTag}` : ""}
      </p>
    </>
  );
}

// ── body: skeleton / error / cards ─────────────────────────────────────────

function Body({ phase, data, state }: { phase: Phase; data: PredictsResponse | null; state: PredictsUrlState }) {
  // Error FIRST: on a failed fetch there is no `data`, so an order that tested
  // for missing data first would show the skeleton forever and never surface
  // the error at all.
  if (phase === "error") {
    return (
      <p role="alert" className="mt-6 rounded-xl border border-warm-gray/60 bg-warm-white px-5 py-6 font-sans text-[14px] text-near-black/75">
        {ERROR_COPY}
      </p>
    );
  }

  if (phase === "loading" || !data) return <CardSkeleton />;

  const rows = data.predictions;
  if (!rows.length) {
    return (
      <p className="mt-6 rounded-xl border border-warm-gray/60 bg-warm-white px-5 py-6 font-sans text-[14px] text-near-black/70">
        {state.view === "open"
          ? emptyHorizonMessage(state.horizon)
          : "No graded forecasts to show yet."}
      </p>
    );
  }

  return (
    <ul className="mt-6 grid grid-cols-1 gap-3 lg:grid-cols-2">
      {rows.map((p) => (
        <li key={p.prediction_id}>{state.view === "open" ? <OpenCard p={p} /> : <GradedCard p={p} />}</li>
      ))}
    </ul>
  );
}

const CARD = "flex h-full flex-col rounded-xl border border-warm-gray bg-warm-white p-5";

function SectorChip({ name }: { name: string | null }) {
  if (!name) return null;
  return (
    <span className="rounded-full border border-warm-gray/60 bg-warm-cream px-2.5 py-0.5 font-mono text-[11px] text-forest">
      {name}
    </span>
  );
}

function OpenCard({ p }: { p: PredictsRow }) {
  const resolves = formatDate(p.target_resolution_date);
  return (
    <article className={CARD}>
      <div className="flex items-start justify-between gap-4">
        <p className="font-sans text-[14px] leading-relaxed text-near-black/85">{p.prediction_text}</p>
        <div className="shrink-0 text-right">
          <div className="font-display text-[30px] font-bold leading-none text-forest">{p.probability_score}%</div>
          {p.probability_band && (
            <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-near-black/60">{p.probability_band}</div>
          )}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {resolves && <span className="font-mono text-[11px] text-near-black/70">Resolves by {resolves}</span>}
        <SectorChip name={p.sector_name} />
        {p.is_bold && (
          <span
            title={BOLD_CALL_TOOLTIP}
            className="rounded-full border border-forest/30 bg-forest/5 px-2.5 py-0.5 font-mono text-[11px] text-forest"
          >
            Bold Call
          </span>
        )}
        {p.is_new && (
          <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-amber-dark">New</span>
        )}
      </div>
    </article>
  );
}

function GradedCard({ p }: { p: PredictsRow }) {
  const badge = verdictBadge(p.status);
  const called = formatDate(p.date_created);
  const resolved = formatDate(p.resolution_date);
  return (
    <article className={CARD}>
      <div className="flex items-start justify-between gap-4">
        <p className="font-sans text-[14px] leading-relaxed text-near-black/85">{p.prediction_text}</p>
        {badge && (
          <span
            className={`shrink-0 rounded-full border px-2.5 py-0.5 font-mono text-[11px] ${
              badge.tone === "right"
                ? "border-sage-dark/40 bg-sage-dark/10 text-sage-dark"
                : "border-amber-dark/40 bg-amber-dark/10 text-amber-dark"
            }`}
          >
            {badge.label}
          </span>
        )}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        {called && (
          <span className="font-mono text-[11px] text-near-black/70">
            Called {called} at {p.probability_score}%
          </span>
        )}
        {resolved && <span className="font-mono text-[11px] text-near-black/70">Resolved {resolved}</span>}
        <SectorChip name={p.sector_name} />
      </div>
      {p.resolution_note && (
        <p className="mt-3 font-sans text-[12px] leading-relaxed text-near-black/60">{p.resolution_note}</p>
      )}
    </article>
  );
}

// ── skeletons (§9) ─────────────────────────────────────────────────────────

function CardSkeleton() {
  return (
    <ul className="mt-6 grid grid-cols-1 gap-3 lg:grid-cols-2" aria-busy="true" aria-label="Loading forecasts">
      {[0, 1, 2, 3].map((i) => (
        <li key={i} className={CARD} aria-hidden>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 space-y-2">
              <div className="h-3 w-full animate-pulse rounded bg-warm-gray/40" />
              <div className="h-3 w-11/12 animate-pulse rounded bg-warm-gray/40" />
              <div className="h-3 w-3/5 animate-pulse rounded bg-warm-gray/40" />
            </div>
            <div className="h-8 w-14 shrink-0 animate-pulse rounded bg-warm-gray/40" />
          </div>
          <div className="mt-4 flex gap-2">
            <div className="h-4 w-32 animate-pulse rounded bg-warm-gray/40" />
            <div className="h-4 w-24 animate-pulse rounded-full bg-warm-gray/40" />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** First paint, before the Suspense boundary resolves. */
export function PredictsSkeleton() {
  return (
    <>
      <div className="mt-8 h-[76px] animate-pulse rounded-xl border border-warm-gray/60 bg-warm-cream" aria-hidden />
      <div className="mt-8 h-[46px] w-[340px] max-w-full animate-pulse rounded-lg bg-warm-gray/30" aria-hidden />
      <CardSkeleton />
    </>
  );
}
