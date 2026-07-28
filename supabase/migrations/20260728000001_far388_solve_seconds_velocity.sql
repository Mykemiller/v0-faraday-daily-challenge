-- FAR-388 — Market Reaction Speed (Velocity Play): capture + percentile bands.
--
-- Closes the data-capture gap the ticket re-baselined for: solve time was being
-- computed client-side and DISPLAYED (via src/lib/market-reaction.ts) but never
-- persisted — no column existed anywhere in the schema. This migration is the
-- storage half.
--
-- Additive + reversible. No existing column/constraint is changed, so completion
-- writes (dc_completions insert in complete-puzzle) and all scoring/streak/
-- leaderboard logic are untouched. solve_seconds is nullable: historical rows and
-- any completion that arrives without a timing value simply stay NULL, and the UI
-- hides the Velocity band when it's null (no fallback needed — per the ticket).
--
-- NOTE (guardrail): solve_seconds is an analytics/presentation metric ONLY. It is
-- deliberately NOT read by any scoring, streak, or leaderboard-ranking path.

-- ── 1. Capture column ────────────────────────────────────────────────────────
alter table public.dc_completions
  add column if not exists solve_seconds real;

comment on column public.dc_completions.solve_seconds is
  'FAR-388: elapsed solve time in seconds (client-timed, additive, nullable). '
  'Analytics/presentation only — never an input to score, streak, or ranking. '
  'Drives the Market Reaction Speed band (per-game-type percentile terciles).';

-- ── 2. Per-game-type percentile bands (terciles) ─────────────────────────────
-- One row per puzzle_type holding the tercile cut points (p33 / p67) over recent
-- persisted solve_seconds. The Market Reaction band reads these when a game type
-- has accumulated enough samples; below the sample floor the client falls back to
-- the seed "par" times baked into market-reaction.ts (so day-one still classifies).
--
-- Percentiles are computed PER GAME TYPE, never globally (a Frequency quiz and a
-- Rackl sort take fundamentally different amounts of time — the ticket guardrail).
create table if not exists public.dc_solve_time_bands (
  game_type    text        primary key,
  p33_sec      real        not null,   -- fastest third boundary  (< p33 ⇒ "Ahead of Consensus")
  p67_sec      real        not null,   -- middle third boundary   (≤ p67 ⇒ "On Pace"; else slow)
  sample_size  integer     not null,
  computed_at  timestamptz not null default now()
);

comment on table public.dc_solve_time_bands is
  'FAR-388: per-game-type solve-time terciles (p33/p67 seconds) for the Market '
  'Reaction Speed band. Recomputed periodically by fn_recompute_solve_time_bands(). '
  'Read server-side (service role) and forwarded to the client via /api/challenge/today.';

alter table public.dc_solve_time_bands enable row level security;
-- Deny-all posture: no anon/auth policy. The service role bypasses RLS; the only
-- readers are server routes holding SUPABASE_SERVICE_ROLE_KEY. Matches the
-- answer-adjacent dc_daily_page_content posture (aggregate thresholds are not
-- sensitive, but there's no need to expose the table directly to PostgREST anon).

-- ── 3. Recompute RPC ─────────────────────────────────────────────────────────
-- Rolling per-game-type tercile recompute over the trailing window. Only writes a
-- band row once a game type clears the sample floor, so sparse game types keep
-- NULL bands (→ client seed-par fallback) instead of noisy thresholds from a
-- handful of plays. Idempotent: upserts by game_type, deletes rows that fall back
-- below the floor. "Periodic recompute is fine" (ticket) — wired to a daily cron.
create or replace function public.fn_recompute_solve_time_bands(
  p_min_sample   integer default 20,
  p_lookback_days integer default 30
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_written integer := 0;
begin
  with agg as (
    select
      puzzle_type as game_type,
      count(*)::int                                                       as sample_size,
      percentile_cont(0.3333) within group (order by solve_seconds)::real as p33_sec,
      percentile_cont(0.6667) within group (order by solve_seconds)::real as p67_sec
    from public.dc_completions
    where solve_seconds is not null
      and solve_seconds > 0
      and completed_at >= now() - make_interval(days => p_lookback_days)
    group by puzzle_type
    having count(*) >= p_min_sample
  ),
  up as (
    insert into public.dc_solve_time_bands as b (game_type, p33_sec, p67_sec, sample_size, computed_at)
    select game_type, p33_sec, p67_sec, sample_size, now() from agg
    on conflict (game_type) do update
      set p33_sec     = excluded.p33_sec,
          p67_sec     = excluded.p67_sec,
          sample_size = excluded.sample_size,
          computed_at = excluded.computed_at
    returning 1
  )
  select count(*)::int into v_written from up;

  -- Drop any stale band whose game type no longer clears the sample floor
  -- in-window. Self-contained (re-derives the qualifying set) because a CTE is
  -- not visible to a separate statement.
  delete from public.dc_solve_time_bands b
  where not exists (
    select 1
    from public.dc_completions c
    where c.puzzle_type = b.game_type
      and c.solve_seconds is not null
      and c.solve_seconds > 0
      and c.completed_at >= now() - make_interval(days => p_lookback_days)
    group by c.puzzle_type
    having count(*) >= p_min_sample
  );

  return v_written;
end;
$$;

comment on function public.fn_recompute_solve_time_bands(integer, integer) is
  'FAR-388: recompute per-game-type solve-time terciles into dc_solve_time_bands '
  'over the trailing p_lookback_days, only for game types with >= p_min_sample '
  'timed completions. Returns the number of band rows written.';

revoke all on function public.fn_recompute_solve_time_bands(integer, integer) from public, anon, authenticated;
grant execute on function public.fn_recompute_solve_time_bands(integer, integer) to service_role;
