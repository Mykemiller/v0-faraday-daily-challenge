-- League Office — reset_season_scoring: the Tier 2 audited, atomic season wipe.
--
-- Zeros every league scoring surface for the CURRENTLY ACTIVE season (resolved
-- dynamically, never a hardcoded id) inside ONE transaction, captures a complete
-- before-snapshot, and writes exactly one lo_audit_log row. UPDATE-only — no row
-- is ever DELETED, so the reset is manually recoverable from the `before`
-- snapshot (reversible=true).
--
-- SCOPE (locked with Myke, FAR League Office):
--   score_events.points          = 0   WHERE season_id = <active>
--   dc_season_state.completed_signals = 0, dropped_signals = 0
--                                       WHERE season_id = <active>
--   dc_completions.score         = 0   WHERE puzzle_date BETWEEN starts_on AND ends_on
--   leaderboard_daily.score      = 0, games_played = 0, total_time_secs = 0
--                                       WHERE play_date BETWEEN starts_on AND ends_on
--
-- EXPLICITLY UNTOUCHED (a diff/behavior touching these is a defect):
--   • dc_subscribers.play_streak / full_set_streak / *_last_day  (streaks survive)
--   • leaderboard_daily.streak   (streak column stays; only score/games/time zero)
--   • season_results             (archived champions preserved)
--   • teams / team_memberships / seasons
--   • any season other than the active one
--   • dc_daily_attempts          (the replay-lock is intentionally left intact —
--     zeroing scores must NOT let players replay; decision A, confirmed)
--   season_scores / team_scores are VIEWS over score_events → self-correct to 0.
--   dc_rank_snapshots / dc_period_aggregates are cron-refreshed derived caches →
--     left to self-heal on the next rollover (confirmed).
--
-- IDEMPOTENT: the snapshot + UPDATEs act ONLY on rows whose target columns are
-- currently non-zero. A second run finds nothing dirty, writes NO audit row, and
-- returns { noop: true } — no error, no data change.
--
-- ATOMIC: this is a single plpgsql function → one transaction. Any RAISE (bad
-- reason, no active season, > 50k rows) rolls the whole thing back, audit row
-- included.
--
-- DEPENDS ON: lo_audit_log (migration 20260704000001). Apply that first.
--
-- ROLLBACK (reverse this migration):
--   DROP FUNCTION IF EXISTS public.lo_reset_season_scoring(text, text);

CREATE OR REPLACE FUNCTION public.lo_reset_season_scoring(
  p_staff_email text,
  p_reason      text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_season     public.seasons%ROWTYPE;
  v_reason     text := btrim(coalesce(p_reason, ''));
  v_se_before  jsonb;
  v_dc_before  jsonb;
  v_lb_before  jsonb;
  v_ss_before  jsonb;
  v_se_n       integer := 0;
  v_dc_n       integer := 0;
  v_lb_n       integer := 0;
  v_ss_n       integer := 0;
  v_total      integer;
  v_audit_id   uuid;
BEGIN
  -- ── Guards ─────────────────────────────────────────────────────────────────
  IF p_staff_email IS NULL OR btrim(p_staff_email) = '' THEN
    RAISE EXCEPTION 'staff_email_required';
  END IF;
  IF length(v_reason) < 3 THEN
    RAISE EXCEPTION 'reason_too_short';
  END IF;

  -- Resolve the ACTIVE season dynamically. Never a hardcoded id.
  SELECT * INTO v_season
    FROM public.seasons
   WHERE status = 'active'
   ORDER BY starts_on DESC
   LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no_active_season';
  END IF;

  -- ── Snapshot ONLY the rows that will actually change (target col non-zero) ──
  -- score_events (season-scoped)
  SELECT jsonb_agg(jsonb_build_object('id', id, 'points', points)), count(*)
    INTO v_se_before, v_se_n
    FROM public.score_events
   WHERE season_id = v_season.id AND points <> 0;

  -- dc_completions (date-window scoped; no season_id column)
  SELECT jsonb_agg(jsonb_build_object('id', id, 'score', score)), count(*)
    INTO v_dc_before, v_dc_n
    FROM public.dc_completions
   WHERE puzzle_date BETWEEN v_season.starts_on AND v_season.ends_on
     AND score <> 0;

  -- leaderboard_daily (date-window scoped). streak column deliberately excluded.
  SELECT jsonb_agg(jsonb_build_object(
           'subscriber_id', subscriber_id,
           'play_date',     play_date,
           'score',         score,
           'games_played',  games_played,
           'total_time_secs', total_time_secs)), count(*)
    INTO v_lb_before, v_lb_n
    FROM public.leaderboard_daily
   WHERE play_date BETWEEN v_season.starts_on AND v_season.ends_on
     AND (score <> 0 OR games_played <> 0 OR coalesce(total_time_secs, 0) <> 0);

  -- dc_season_state (season-scoped)
  SELECT jsonb_agg(jsonb_build_object(
           'season_id',        season_id,
           'subscriber_id',    subscriber_id,
           'completed_signals', completed_signals,
           'dropped_signals',   dropped_signals)), count(*)
    INTO v_ss_before, v_ss_n
    FROM public.dc_season_state
   WHERE season_id = v_season.id
     AND (completed_signals <> 0 OR dropped_signals <> 0);

  v_total := v_se_n + v_dc_n + v_lb_n + v_ss_n;

  -- Abort guard (spec): refuse an implausibly large reset rather than run it.
  IF v_total > 50000 THEN
    RAISE EXCEPTION 'too_many_rows: %', v_total;
  END IF;

  -- Idempotent no-op: nothing dirty → do not write an audit row.
  IF v_total = 0 THEN
    RETURN jsonb_build_object(
      'ok', true,
      'noop', true,
      'rows_affected', 0,
      'season_id', v_season.id,
      'season_name', v_season.name,
      'counts', jsonb_build_object(
        'score_events', 0, 'dc_completions', 0,
        'leaderboard_daily', 0, 'dc_season_state', 0)
    );
  END IF;

  -- ── Zero the scoreboard (UPDATE only; never DELETE) ────────────────────────
  UPDATE public.score_events
     SET points = 0
   WHERE season_id = v_season.id AND points <> 0;

  UPDATE public.dc_completions
     SET score = 0
   WHERE puzzle_date BETWEEN v_season.starts_on AND v_season.ends_on
     AND score <> 0;

  UPDATE public.leaderboard_daily
     SET score = 0, games_played = 0, total_time_secs = 0
   WHERE play_date BETWEEN v_season.starts_on AND v_season.ends_on
     AND (score <> 0 OR games_played <> 0 OR coalesce(total_time_secs, 0) <> 0);

  UPDATE public.dc_season_state
     SET completed_signals = 0, dropped_signals = 0
   WHERE season_id = v_season.id
     AND (completed_signals <> 0 OR dropped_signals <> 0);

  -- ── Exactly one audit row (before = full prior values; after = counts) ─────
  INSERT INTO public.lo_audit_log
    (staff_email, domain, action, reason, target_type, target_id, before, after, reversible)
  VALUES (
    lower(btrim(p_staff_email)),
    'scoring',
    'reset_season_scoring',
    v_reason,
    'season',
    v_season.id::text,
    jsonb_build_object(
      'score_events',      coalesce(v_se_before, '[]'::jsonb),
      'dc_completions',    coalesce(v_dc_before, '[]'::jsonb),
      'leaderboard_daily', coalesce(v_lb_before, '[]'::jsonb),
      'dc_season_state',   coalesce(v_ss_before, '[]'::jsonb)
    ),
    jsonb_build_object(
      'score_events',      v_se_n,
      'dc_completions',    v_dc_n,
      'leaderboard_daily', v_lb_n,
      'dc_season_state',   v_ss_n
    ),
    true
  )
  RETURNING id INTO v_audit_id;

  RETURN jsonb_build_object(
    'ok', true,
    'noop', false,
    'audit_id', v_audit_id,
    'rows_affected', v_total,
    'season_id', v_season.id,
    'season_name', v_season.name,
    'counts', jsonb_build_object(
      'score_events',      v_se_n,
      'dc_completions',    v_dc_n,
      'leaderboard_daily', v_lb_n,
      'dc_season_state',   v_ss_n)
  );
END;
$$;

COMMENT ON FUNCTION public.lo_reset_season_scoring(text, text) IS
  'League Office Tier 2: atomically zero the active season''s scoring (score_events, dc_completions, leaderboard_daily, dc_season_state), snapshot prior values, and write one lo_audit_log row. UPDATE-only, idempotent, reversible.';

-- Service-role only. The Next server action calls this via the service key after
-- requireStaff() has verified the caller. anon/authenticated get nothing.
REVOKE ALL ON FUNCTION public.lo_reset_season_scoring(text, text) FROM public;
REVOKE ALL ON FUNCTION public.lo_reset_season_scoring(text, text) FROM anon;
REVOKE ALL ON FUNCTION public.lo_reset_season_scoring(text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.lo_reset_season_scoring(text, text) TO service_role;
