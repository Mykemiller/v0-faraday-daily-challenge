// FAR-287 day-content sync — the MECHANISM, extracted from
// /api/cron/sync-day-content so it has more than one caller.
//
// Mirrors the Puzzle Bank's Live set into Supabase dc_daily_page_content (one
// row per CT serve day) so the Hints Today / About Today's Challenge / Answers
// Today pages never read the bank at request time.
//
// CC-DC-SEASON-GOLIVE-1.0 (B6): the nightly cron mirrors the day at 05:10 UTC,
// which for a season that goes live DURING the day means it mirrored an empty
// Live set and nothing ever re-ran it. `goLiveToday` calls this function
// directly after a same-day rotation — in process, never by self-calling the
// route over HTTP, which would need the cron secret and a reachable host.
//
// The cron route is now a thin wrapper: auth, the CT-midnight hour guard and
// the force/date params stay there, and the nightly behaviour — including the
// exact shape of the `[sync-day-content]` log line and of both JSON responses —
// is unchanged, because the body did not change, it only moved.
//
// Idempotent: the upsert keys on puzzle_date (resolution=merge-duplicates), so
// a re-run rewrites the same row.
//
// Requires AIRTABLE_API_KEY or the supabase bank source (DC_PUZZLE_SOURCE) for
// the gather, and SUPABASE_SERVICE_ROLE_KEY for the upsert.

import { buildDayContentRow } from "@/lib/day-content";
import {
  matchSignalsForDay,
  minusDays,
  SIGNAL_WINDOW_DAYS,
  type SignalCandidate,
} from "@/lib/signal-matcher";

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://ycadmmngkdhvpcsrcuaq.supabase.co";

export type SyncDayContentSummary = {
  ok: true;
  puzzle_date: string;
  puzzleCount: number;
  types: string[];
  domain_code: string | null;
  withExplanation: number;
  withAcademy: number;
  signalCandidates: number;
  signalTiers: string[];
};

export type SyncDayContentFailure = { ok: false; dateISO: string; error: string };

export type SyncDayContentResult = SyncDayContentSummary | SyncDayContentFailure;

// FAR-385: the day's Faraday Signal candidate pool — published rows inside the
// 3-day serve window, plus any row pinned to this serve date (a pin is a
// commissioner override, so it stays eligible even outside the window).
// Matching runs HERE, at sync time, never at request time.
async function fetchSignalPool(
  serviceKey: string,
  dateISO: string
): Promise<SignalCandidate[]> {
  const minDate = minusDays(dateISO, SIGNAL_WINDOW_DAYS);
  const params = new URLSearchParams({
    select:
      "id,signal_date,headline,body,source_url,source_label,domain,sub_domain,tags,pinned_for_date,pinned_puzzle_type,published,updated_at",
    published: "eq.true",
    or: `(pinned_for_date.eq.${dateISO},and(signal_date.lte.${dateISO},signal_date.gte.${minDate}))`,
    order: "signal_date.desc,updated_at.desc",
  });
  const res = await fetch(`${SUPABASE_URL}/rest/v1/dc_daily_signal?${params}`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`dc_daily_signal read failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const rows = await res.json().catch(() => null);
  return Array.isArray(rows) ? rows : [];
}

/**
 * Rebuild and upsert dc_daily_page_content for ONE CT serve day.
 *
 * Never throws — the failure is returned (and logged in the same shape the
 * route logged it) so the cron can 500 on it and `goLiveToday` can fold it
 * into its `skipped` list without aborting a go-live.
 */
export async function syncDayContent(dateISO: string): Promise<SyncDayContentResult> {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    const error = "SUPABASE_SERVICE_ROLE_KEY not set";
    console.error("[sync-day-content] failed:", JSON.stringify({ dateISO, error }));
    return { ok: false, dateISO, error };
  }

  try {
    const row = await buildDayContentRow(dateISO);

    // FAR-385: match the day's published signals to every puzzle (all 7 games
    // get matched_signal_id + signal_match_tier; only The Brief renders in the
    // pilot). Fail-soft: a signal read/matcher failure leaves the gather's
    // tier:"none" defaults in place — the day pages must never lose their sync
    // to the signal layer.
    let signalCount = 0;
    try {
      const signals = await fetchSignalPool(serviceKey, dateISO);
      signalCount = signals.length;
      const byId = new Map(signals.map((s) => [s.id, s]));
      const assignments = matchSignalsForDay(row.puzzles, signals, dateISO);
      for (const p of row.puzzles) {
        const a = assignments.get(p.puzzle_type);
        if (!a) continue;
        p.matched_signal_id = a.signal_id;
        p.signal_match_tier = a.tier;
        const s = a.signal_id ? byId.get(a.signal_id) : null;
        // Denormalize the public fields at sync time (the Take pattern): the
        // serve path reads dc_daily_page_content only, never dc_daily_signal.
        p.signal = s
          ? {
              headline: s.headline,
              body: s.body,
              source_url: s.source_url,
              source_label: s.source_label,
              signal_date: s.signal_date,
            }
          : null;
      }
    } catch (err) {
      console.error(
        "[sync-day-content] signal matching failed (day content still syncs):",
        err instanceof Error ? err.message : String(err)
      );
    }

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/dc_daily_page_content?on_conflict=puzzle_date`,
      {
        method: "POST",
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal,resolution=merge-duplicates",
        },
        body: JSON.stringify(row),
      }
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Supabase upsert failed (${res.status}): ${body.slice(0, 300)}`);
    }

    const summary: SyncDayContentSummary = {
      ok: true,
      puzzle_date: row.puzzle_date,
      puzzleCount: row.puzzles.length,
      types: row.puzzles.map((p) => p.puzzle_type),
      domain_code: row.domain_code,
      withExplanation: row.puzzles.filter((p) => p.answer_explanation).length,
      withAcademy: row.puzzles.filter((p) => p.academy).length,
      signalCandidates: signalCount,
      signalTiers: row.puzzles.map((p) => `${p.puzzle_type}:${p.signal_match_tier}`),
    };
    console.log("[sync-day-content]", JSON.stringify(summary));
    return summary;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[sync-day-content] failed:", JSON.stringify({ dateISO, error: message }));
    return { ok: false, dateISO, error: message };
  }
}
