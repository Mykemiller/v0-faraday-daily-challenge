"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_OPEN_STATE,
  parseOpenState,
  serializeOpenState,
  type CompanyIndexEntry,
  type OpenState,
  type V3Row,
} from "@/lib/predicts-v3";
import CompactCard from "./components/CompactCard";
import FilterSheet from "./components/FilterSheet";
import ForecastCard from "./components/ForecastCard";
import SearchBox from "./components/SearchBox";
import TheaterChips from "./components/TheaterChips";
import ThreadCard from "./components/ThreadCard";
import { usePredictsData } from "./hooks/usePredictsData";
import { useWatchlist } from "./hooks/useWatchlist";

// The Open board (FDY-273): search, Theater chips, filters, rails and the
// Thread-card board. URL is state (pushState + popstate); the server already
// rendered the same rows, so there is no blank first paint.

type Props = {
  initialState: OpenState;
  rows: V3Row[];
  theaters: string[];
  sectors: string[];
  horizonCounts: Record<string, number>;
  companies: CompanyIndexEntry[];
  gradedThisWeek: V3Row[];
  votesEnabled: boolean;
  voteUrl: string;
  failed: boolean;
};

const ERROR_COPY = "Forecasts are unavailable right now — try again shortly.";

export default function OpenBoard(p: Props) {
  const [state, setState] = useState<OpenState>(p.initialState);
  const { list } = useWatchlist();
  const { groups, filtered, soon } = usePredictsData(p.rows, state, list);

  const go = useCallback((next: OpenState) => {
    setState(next);
    window.history.pushState(null, "", serializeOpenState(next));
  }, []);

  useEffect(() => {
    const onPop = () => setState(parseOpenState(new URLSearchParams(window.location.search)));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const companyName = state.company ? p.companies.find((c) => c.slug === state.company)?.name ?? state.company : null;
  const searching = !!state.q;
  const showRails = !searching && state.h === "all" && !state.theater && !state.thread && !state.company && !state.sector &&
    !state.bold && !state.watching;

  if (p.failed) {
    return <p className="mt-8 rounded-xl border border-cream-border bg-warm-cream p-4 font-sans text-[15px]">{ERROR_COPY}</p>;
  }

  return (
    <section className="mt-6" aria-label="Open forecasts">
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="flex-1">
          <SearchBox rows={p.rows} companies={p.companies} initial={state.q} onSubmit={(q) => go({ ...state, q })} />
        </div>
        <FilterSheet state={state} sectors={p.sectors} companies={p.companies} horizonCounts={p.horizonCounts} onChange={go} />
      </div>

      <div className="mt-3">
        <TheaterChips theaters={p.theaters} value={state.theater} onChange={(t) => go({ ...state, theater: t })} />
      </div>

      {(state.thread || companyName || state.sector || state.q) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 font-sans text-[14px]">
          <span className="text-near-black/70">Showing</span>
          {[
            state.thread && { k: "thread", label: state.thread },
            companyName && { k: "company", label: companyName },
            state.sector && { k: "sector", label: state.sector },
            state.q && { k: "q", label: `“${state.q}”` },
          ]
            .filter(Boolean)
            .map((x) => {
              const f = x as { k: keyof OpenState; label: string };
              return (
                <button
                  key={f.k}
                  type="button"
                  onClick={() => go({ ...state, [f.k]: null })}
                  className="inline-flex min-h-[36px] items-center gap-1 rounded-full bg-warm-cream px-3 text-near-black hover:bg-cream-border"
                  aria-label={`Remove filter ${f.label}`}
                >
                  {f.label} <span aria-hidden>×</span>
                </button>
              );
            })}
        </div>
      )}

      {showRails && p.gradedThisWeek.length > 0 && (
        <Rail title="Graded this week">
          {p.gradedThisWeek.map((r) => <CompactCard key={r.prediction_id} row={r} />)}
        </Rail>
      )}
      {showRails && soon.length > 0 && (
        <Rail title="Resolving in the next 14 days">
          {soon.map((r) => <CompactCard key={r.prediction_id} row={r} />)}
        </Rail>
      )}

      {filtered.length === 0 ? (
        <div className="mt-8 rounded-xl border border-cream-border bg-warm-cream p-6 text-center">
          <p className="font-serif text-[18px] text-near-black">No open forecasts match that.</p>
          <button
            type="button"
            onClick={() => go(DEFAULT_OPEN_STATE)}
            className="mt-3 min-h-[44px] rounded-full bg-forest px-5 font-sans text-[14px] font-semibold text-warm-white"
          >
            Reset
          </button>
        </div>
      ) : searching ? (
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {filtered.map((r) => <ForecastCard key={r.prediction_id} row={r} voteUrl={p.voteUrl} votesEnabled={p.votesEnabled} />)}
        </div>
      ) : (
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {groups.map((g) => <ThreadCard key={g.key} group={g} voteUrl={p.voteUrl} votesEnabled={p.votesEnabled} />)}
        </div>
      )}
    </section>
  );
}

function Rail({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6" aria-label={title}>
      <h2 className="font-serif text-[20px] font-bold text-near-black">{title}</h2>
      <div className="double-rule" aria-hidden />
      <div className="mt-3 flex snap-x gap-3 overflow-x-auto pb-2">{children}</div>
    </section>
  );
}
