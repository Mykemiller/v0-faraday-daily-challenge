-- CC-LO-SEASON-SCOPE-1.0 · Phase 2 — teach the read paths about scope.
--
-- Requires Phase 1 (20260803170000 + 20260803170100).
--
-- With every existing season on a platform scope, fn_season_scope_teams()
-- resolves to every team, so all four functions below are behavioural no-ops
-- today. The verification gate at the foot of this file asserts exactly that.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
--   • does NOT touch global_leaderboard / global_leaderboard_phase. Filtering
--     PLAYER standings by team scope raises an unresolved product question —
--     what happens to a subscriber with no team in a league-scoped season —
--     so it stays out. Follow-up: "Should global leaderboard respect season
--     scope?"
--   • does NOT change the `JOIN team_memberships tm ON tm.season_id = s.id AND
--     tm.pending = false` in team_leaderboard. That is a separate roster
--     carry-forward defect, tracked separately, explicitly out of scope.
--   • does NOT touch score_events, dc_completions, leaderboard_daily, or any
--     scoring arithmetic. Only WHICH teams are considered changes.

begin;

-- ── 1. team_leaderboard ──────────────────────────────────────────────────────
-- Body is byte-identical to the live definition except for the added
-- `WHERE t.id IN (...)`. The team_memberships join is untouched.

create or replace function public.team_leaderboard(
  p_season text default null,
  p_limit  integer default 20
)
returns table(rank integer, team_id uuid, code citext, name text, members integer, score bigint)
language sql
stable
set search_path to 'public'
as $function$
  WITH season AS (
    SELECT id FROM public.seasons
    WHERE CASE WHEN p_season IS NULL THEN status = 'active'
               ELSE name = p_season OR slug::text = p_season END
    ORDER BY starts_on DESC LIMIT 1
  ),
  scoped AS (
    SELECT t.id, t.code, t.name,
           count(DISTINCT tm.subscriber_id)::int AS members,
           public.team_total_score(t.id, s.id) AS score
    FROM season s
    JOIN public.team_memberships tm ON tm.season_id = s.id AND tm.pending = false
    JOIN public.teams t ON t.id = tm.team_id
    -- CC-LO-SEASON-SCOPE-1.0: the season's own scope decides which teams rank.
    WHERE t.id IN (SELECT team_id FROM public.fn_season_scope_teams(s.id))
    GROUP BY t.id, t.code, t.name, s.id
  )
  SELECT row_number() OVER (ORDER BY score DESC, members DESC, name ASC)::int AS rank,
         id AS team_id, code, name, members, score
  FROM scoped
  ORDER BY score DESC, members DESC, name ASC
  LIMIT p_limit;
$function$;

-- ── 2. roster carry-forward ──────────────────────────────────────────────────
--
-- RETURN TYPE CHANGES: integer → jsonb, so this is a DROP + CREATE, and
-- fn_seasons_activate_carry_forward (the only caller — there are no TypeScript
-- call sites) is rewritten below in the same transaction. Leaving the trigger
-- reading an integer would make every season activation raise, get swallowed by
-- its own EXCEPTION handler, and silently carry nothing.

drop function if exists public.fn_season_roster_carry_forward(uuid, uuid, text, text);

create function public.fn_season_roster_carry_forward(
  p_to_season   uuid,
  p_from_season uuid  default null,
  p_staff_email text  default 'system',
  p_reason      text  default 'Automatic roster carry-forward at season rollover'
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_from     uuid := p_from_season;
  v_to       public.seasons;
  v_before   integer;
  v_n        integer := 0;
  v_skipped  integer := 0;
BEGIN
  SELECT * INTO v_to FROM public.seasons WHERE id = p_to_season;
  IF v_to.id IS NULL THEN
    RAISE EXCEPTION 'target season % not found', p_to_season USING ERRCODE = 'P0002';
  END IF;

  IF public.fn_season_roster_frozen(v_to.id) THEN
    RAISE EXCEPTION 'roster_frozen: rosters are frozen for season %', v_to.id
      USING ERRCODE = 'FRZ01';
  END IF;

  -- Default source = the most recent season in the same league ending before the
  -- target starts. This is one of the three live readers of seasons.league_id;
  -- see the column comment. It is NOT a scoping decision — it only picks which
  -- season to copy FROM — so D12 is not violated.
  IF v_from IS NULL THEN
    SELECT id INTO v_from
    FROM public.seasons
    WHERE league_id = v_to.league_id AND ends_on < v_to.starts_on
    ORDER BY ends_on DESC
    LIMIT 1;
  END IF;

  IF v_from IS NULL THEN
    RETURN jsonb_build_object(
      'carried', 0, 'skipped_out_of_scope', 0, 'from_season', null,
      'note', 'no source season — first season of this league');
  END IF;

  SELECT count(*) INTO v_before
  FROM public.team_memberships WHERE season_id = v_to.id;

  -- CC-LO-SEASON-SCOPE-1.0: only carry rosters for teams the TARGET season
  -- actually covers. Counted separately so a shrunken roster is explainable
  -- rather than mysterious.
  SELECT count(*) INTO v_skipped
  FROM public.team_memberships tm
  JOIN public.teams t ON t.id = tm.team_id
  JOIN public.dc_subscribers s ON s.id = tm.subscriber_id
  WHERE tm.season_id = v_from
    AND tm.pending = false
    AND tm.left_at IS NULL
    AND t.is_active = true
    AND t.archived_at IS NULL
    AND s.active = true
    AND tm.team_id NOT IN (SELECT team_id FROM public.fn_season_scope_teams(v_to.id));

  WITH ins AS (
    INSERT INTO public.team_memberships
      (subscriber_id, team_id, season_id, pending, role, joined_at)
    SELECT tm.subscriber_id, tm.team_id, v_to.id, false, tm.role, now()
    FROM public.team_memberships tm
    JOIN public.teams t ON t.id = tm.team_id
    JOIN public.dc_subscribers s ON s.id = tm.subscriber_id
    WHERE tm.season_id = v_from
      AND tm.pending = false
      AND tm.left_at IS NULL
      AND t.is_active = true
      AND t.archived_at IS NULL
      AND s.active = true
      AND tm.team_id IN (SELECT team_id FROM public.fn_season_scope_teams(v_to.id))
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::int INTO v_n FROM ins;

  IF v_n > 0 OR v_skipped > 0 THEN
    INSERT INTO public.lo_audit_log
      (staff_email, domain, action, reason, target_type, target_id, before, after, reversible)
    VALUES (
      COALESCE(p_staff_email, 'system'), 'teams', 'season_roster_carry_forward', p_reason,
      'season', v_to.id::text,
      jsonb_build_object('memberships_before', v_before),
      jsonb_build_object('from_season', v_from, 'inserted', v_n,
                         'skipped_out_of_scope', v_skipped,
                         'memberships_after', v_before + v_n),
      true
    );
  END IF;

  RETURN jsonb_build_object(
    'carried', v_n,
    'skipped_out_of_scope', v_skipped,
    'from_season', v_from);
END $function$;

comment on function public.fn_season_roster_carry_forward(uuid, uuid, text, text) is
  'CC-LO-SEASON-SCOPE-1.0: carries the previous season''s rosters forward, restricted to teams in the TARGET season''s scope. Returns {carried, skipped_out_of_scope, from_season}. Return type changed from integer in Phase 2 — update any new caller accordingly.';

-- The trigger that calls it. Rewritten for the jsonb return.
create or replace function public.fn_seasons_activate_carry_forward()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE v_res jsonb; v_n integer; v_skipped integer;
BEGIN
  BEGIN
    v_res := public.fn_season_roster_carry_forward(
               NEW.id, NULL, 'system',
               'Automatic roster carry-forward on season activation');
    v_n       := coalesce((v_res->>'carried')::int, 0);
    v_skipped := coalesce((v_res->>'skipped_out_of_scope')::int, 0);

    IF v_n > 0 OR v_skipped > 0 THEN
      RAISE NOTICE 'season %: carried % roster row(s) forward, skipped % out-of-scope',
        NEW.id, v_n, v_skipped;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Never block activation. Surface loudly instead.
    RAISE WARNING 'season %: roster carry-forward failed (% / %) — rosters may be empty',
      NEW.id, SQLSTATE, SQLERRM;
  END;
  RETURN NULL;
END $function$;

-- ── 3. company / conference standings ────────────────────────────────────────
--
-- p_season IS NULL keeps the pre-scope behaviour, so callers that omit it are
-- unaffected.

create or replace function public.fn_company_team_standings(
  p_company uuid, p_period text, p_day date, p_season uuid
)
returns table(team_id uuid, code citext, name text, signals bigint, rank bigint)
language sql
stable
set search_path to 'public'
as $function$
  WITH sib AS (
    SELECT t.id, t.code, t.name,
           public.fn_group_period_signals(t.id, p_period, p_day, p_season) AS signals
    FROM public.teams t
    WHERE t.id IN (SELECT tcm.team_id FROM public.team_conference_memberships tcm
                   WHERE tcm.conference_id = p_company)
      -- CC-LO-SEASON-SCOPE-1.0
      AND (p_season IS NULL
           OR t.id IN (SELECT team_id FROM public.fn_season_scope_teams(p_season)))
  )
  SELECT id, code, name, signals, RANK() OVER (ORDER BY signals DESC, name ASC)
  FROM sib ORDER BY signals DESC, name ASC;
$function$;

-- fn_company_standings ranks CONFERENCES, not teams, so "apply the same scope
-- filter" has no team column to filter on. The rule adopted instead: an org
-- conference is listed only when at least one in-scope team resolves to it,
-- using the same per-season resolution as D6 (membership row for the season,
-- falling back to teams.conference_id).

create or replace function public.fn_company_standings(
  p_period text, p_day date, p_season uuid
)
returns table(company_id uuid, code citext, name text, signals bigint, rank bigint)
language sql
stable
set search_path to 'public'
as $function$
  WITH co AS (
    SELECT c.id, c.code::citext AS code, c.name,
           public.fn_group_period_signals(c.id, p_period, p_day, p_season) AS signals
    FROM public.conferences c
    WHERE c.type = 'org' AND c.archived_at IS NULL
      -- CC-LO-SEASON-SCOPE-1.0
      AND (p_season IS NULL OR EXISTS (
            SELECT 1
            FROM public.fn_season_scope_teams(p_season) f
            JOIN public.teams t ON t.id = f.team_id
            LEFT JOIN public.team_conference_memberships tcm
                   ON tcm.team_id = t.id AND tcm.season_id = p_season
            WHERE coalesce(tcm.conference_id, t.conference_id) = c.id))
  )
  SELECT id, code, name, signals, RANK() OVER (ORDER BY signals DESC, name ASC)
  FROM co ORDER BY signals DESC, name ASC;
$function$;

-- ── verification gate ────────────────────────────────────────────────────────
-- Every season is platform-scoped today, so nothing above may change a result.
do $$
declare
  r      record;
  v_n    int;
  v_want int;
begin
  for r in select id, name from public.seasons loop
    select count(*) into v_n from public.team_leaderboard(r.name, 1000);
    select count(distinct tm.team_id) into v_want
      from public.team_memberships tm
     where tm.season_id = r.id and tm.pending = false;
    if v_n <> v_want then
      raise exception
        'gate: season "%" — team_leaderboard returns % but % team(s) have rosters; scope filter changed a platform-scoped season',
        r.name, v_n, v_want;
    end if;
  end loop;

  if (select count(*) from public.fn_company_standings('season', current_date, null)) = 0 then
    raise exception 'gate: fn_company_standings returned no rows with p_season NULL';
  end if;
end $$;

commit;
