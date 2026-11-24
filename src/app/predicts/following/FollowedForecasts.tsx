"use client";

import { useEffect, useState } from "react";
import { COPY, type GetResponse } from "@/lib/predicts-preferences";
import { PWA_COPY, followNamesFrom, followedForecasts } from "@/lib/predicts-pwa";
import type { V3Row } from "@/lib/predicts-v3";
import ForecastCard from "../components/ForecastCard";
import { usePredictsToken } from "../hooks/usePredictsToken";

// Reads the subscriber's effective preferences from predicts-preferences (FDY-119, token-authorised,
// GET only — this page never writes) and filters the Open rows it was handed. The preferences read
// is never cached by the service worker (it carries the token).

type Phase = { kind: "loading" } | { kind: "no_token" } | { kind: "error" } | { kind: "ready"; data: GetResponse };
const FETCH_INIT: RequestInit = { cache: "no-store", referrerPolicy: "no-referrer", credentials: "omit" };

function Notice({ text }: { text: string }) {
  return (
    <div className="mt-6 rounded-xl border border-cream-border bg-warm-cream p-6 text-center">
      <p className="font-serif text-[18px] leading-snug text-near-black">{text}</p>
    </div>
  );
}

export default function FollowedForecasts({ rows, failed, prefsUrl, voteUrl, votesEnabled }: {
  rows: V3Row[]; failed: boolean; prefsUrl: string; voteUrl: string; votesEnabled: boolean;
}) {
  const { token, forget } = usePredictsToken();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });

  useEffect(() => {
    let live = true;
    const run = async (): Promise<Phase> => {
      if (!token) return { kind: "no_token" };
      try {
        const r = await fetch(`${prefsUrl}?t=${encodeURIComponent(token)}`, FETCH_INIT);
        if (r.status === 404) { forget(); return { kind: "no_token" }; }
        if (!r.ok) return { kind: "error" };
        const data = (await r.json()) as GetResponse;
        return data?.ok ? { kind: "ready", data } : { kind: "error" };
      } catch {
        return { kind: "error" };
      }
    };
    run().then((p) => { if (live) setPhase(p); });
    return () => { live = false; };
  }, [prefsUrl, token, forget]);

  if (failed) return <Notice text={COPY.unavailable} />;
  if (phase.kind === "loading") return <div aria-busy="true" className="mt-6 h-40 animate-pulse rounded-xl bg-warm-cream" />;
  if (phase.kind === "no_token") return <Notice text={PWA_COPY.followingNeedsLink} />;
  if (phase.kind === "error") return <Notice text={COPY.unavailable} />;

  const p = phase.data.effective_preferences;
  const shown = followedForecasts(rows, {
    sectors: p.sectors ?? [], theaters: p.theaters ?? [], threads: p.threads ?? [], key_players: p.key_players ?? [],
    horizons: p.horizons ?? [], min_probability: p.min_probability ?? 0, include_bold: p.include_bold ?? true,
  }, followNamesFrom(phase.data.options));

  if (!shown.length) return <Notice text={PWA_COPY.followingEmpty} />;
  return (
    <ul className="mt-6 space-y-3">
      {shown.map((row) => (
        <li key={row.prediction_id}><ForecastCard row={row} voteUrl={voteUrl} votesEnabled={votesEnabled} /></li>
      ))}
    </ul>
  );
}
