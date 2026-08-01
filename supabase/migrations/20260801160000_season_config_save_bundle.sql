-- CC-LO-SLATE-FILTER-1.0 · FIX 3 — make the season-config save ATOMIC.
--
-- The bug this closes: saveConfigDraft() wrote season_config, season_games,
-- season_theme_mix, season_difficulty_mix and season_scopes as FIVE separate
-- PostgREST calls. PostgREST cannot span statements, so each was its own
-- transaction. When the slate INSERT was refused by trg_season_games_assignable
-- the DELETE that preceded it had already committed — config 667c488f-1c9f-4199
-- -a7ee-40aff7c094a7 lost all 7 of its slate rows while its mixes (7 / 3) stayed
-- put, leaving a config that looks saved and has an empty slate.
--
-- One function, one transaction. Either the whole bundle lands or none of it does.
--
-- What this migration does NOT do, deliberately:
--   • does NOT modify trg_season_games_assignable or fn_season_games_assignable.
--     That trigger is CORRECT — a new_idea game has no puzzle bank, so scheduling
--     one would promise a game that cannot be served. The UI was wrong, not it.
--   • does NOT change any game_catalog.lifecycle_state value.
--   • does NOT add or alter a column on season_config or season_games.
--   • does NOT touch the locked-season guards (fn_season_config_locked_guard /
--     fn_season_config_child_locked_guard). They still fire inside this function
--     and their 55P03 rolls the whole bundle back, which is exactly right.

begin;

-- ── the atomic bundle write ──────────────────────────────────────────────────
--
-- Each p_* argument is NULL = "leave this set alone", matching the PATCH
-- semantics the editor already uses. A non-null child array REPLACES the set —
-- never a partial write (spec §3).
--
-- Rows arrive already normalized/clamped by the TypeScript layer
-- (normalizeGameRow / normalizeThemeRow / normalizeDifficultyRow); this function
-- re-whitelists the CONFIG columns because the API is the fence, and filters the
-- slate because the DB is the only place that knows lifecycle_state.

create or replace function public.season_config_save_bundle(
  p_config_id  uuid,
  p_config     jsonb default null,
  p_games      jsonb default null,
  p_theme      jsonb default null,
  p_difficulty jsonb default null,
  p_scopes     jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Exactly CONFIG_FIELDS in season-config-logic.ts. Anything outside it is
  -- owned by the DB/RPCs — a client can never promote itself by sending `state`.
  c_writable constant text[] := array[
    'effective_from','effective_to','label','notes',
    'max_teams_per_subscriber','min_team_size','max_team_size',
    'allow_free_agency','allow_late_join','allow_mid_season_team_switch',
    'registration_opens_on','registration_closes_on','roster_lock_on',
    'games_per_day','play_days_of_week',
    'hints_enabled','max_hints_per_game','hint_penalty_pct','late_submission_grace_hours',
    'scoring_profile','signals_per_correct','streak_bonus_enabled','drop_lowest_n_days',
    'team_score_method','team_score_top_n',
    'difficulty_curve','target_solve_rate_pct',
    'publish_leaderboard','leaderboard_visibility','publish_standings_at',
    'extras'
  ];

  v_cur          season_config;
  v_new          season_config;
  v_safe         jsonb;
  v_prev_counts  jsonb := '{}'::jsonb;
  v_dropped      text[] := '{}';
  v_games        int := 0;
  v_theme        int := 0;
  v_difficulty   int := 0;
  v_scopes       int := 0;
begin
  -- FOR UPDATE serializes two commissioners saving the same config. The
  -- fingerprint check in saveConfigDraft() is still the user-facing concurrency
  -- guard; this only stops two writes interleaving mid-bundle.
  select * into v_cur from season_config where id = p_config_id for update;
  if not found then
    raise exception 'Season config % not found.', p_config_id
      using errcode = 'P0002';
  end if;

  -- draft/scheduled are writable; active is clone-only. Mirrored from the API so
  -- a hand-rolled RPC call is stopped exactly like a UI click.
  if v_cur.state not in ('draft', 'scheduled') then
    raise exception
      'This version is %, which is read-only. Clone it to a new draft first.', v_cur.state
      using errcode = '42501';
  end if;

  -- ── 1. the config row ──────────────────────────────────────────────────────
  if p_config is not null then
    v_safe := coalesce(
      (select jsonb_object_agg(e.key, e.value)
         from jsonb_each(p_config) e
        where e.key = any (c_writable)),
      '{}'::jsonb
    );

    if v_safe <> '{}'::jsonb then
      -- Absent keys keep their current value; present keys override.
      v_new := jsonb_populate_record(v_cur, v_safe);

      update season_config set
        effective_from              = v_new.effective_from,
        effective_to                = v_new.effective_to,
        label                       = v_new.label,
        notes                       = v_new.notes,
        max_teams_per_subscriber    = v_new.max_teams_per_subscriber,
        min_team_size               = v_new.min_team_size,
        max_team_size               = v_new.max_team_size,
        allow_free_agency           = v_new.allow_free_agency,
        allow_late_join             = v_new.allow_late_join,
        allow_mid_season_team_switch= v_new.allow_mid_season_team_switch,
        registration_opens_on       = v_new.registration_opens_on,
        registration_closes_on      = v_new.registration_closes_on,
        roster_lock_on              = v_new.roster_lock_on,
        games_per_day               = v_new.games_per_day,
        play_days_of_week           = v_new.play_days_of_week,
        hints_enabled               = v_new.hints_enabled,
        max_hints_per_game          = v_new.max_hints_per_game,
        hint_penalty_pct            = v_new.hint_penalty_pct,
        late_submission_grace_hours = v_new.late_submission_grace_hours,
        scoring_profile             = v_new.scoring_profile,
        signals_per_correct         = v_new.signals_per_correct,
        streak_bonus_enabled        = v_new.streak_bonus_enabled,
        drop_lowest_n_days          = v_new.drop_lowest_n_days,
        team_score_method           = v_new.team_score_method,
        team_score_top_n            = v_new.team_score_top_n,
        difficulty_curve            = v_new.difficulty_curve,
        target_solve_rate_pct       = v_new.target_solve_rate_pct,
        publish_leaderboard         = v_new.publish_leaderboard,
        leaderboard_visibility      = v_new.leaderboard_visibility,
        publish_standings_at        = v_new.publish_standings_at,
        extras                      = v_new.extras
      where id = p_config_id;
    end if;
  end if;

  -- ── 2. the game slate ──────────────────────────────────────────────────────
  if p_games is not null then
    -- FIX 1(b): the write path must never emit a season_games row for a
    -- non-assignable game — not even an UNCHECKED one, because
    -- trg_season_games_assignable fires on INSERT regardless of is_enabled.
    --
    -- Filter on lifecycle_state ONLY. Matching is_active or is_beta instead
    -- would reintroduce this exact class of bug: all 18 catalog rows are
    -- is_active, which is why the old createDefaultsConfig filter also failed.
    --
    -- A DISABLED non-assignable row is dropped silently — it is noise from a
    -- stale client that still renders the full catalog. An ENABLED one is passed
    -- through on purpose so the trigger raises and the commissioner is told
    -- which game they tried to schedule, rather than having it vanish.
    select coalesce(array_agg(g.display_name order by g.sort_order), '{}')
      into v_dropped
      from jsonb_to_recordset(p_games) as x(game_id uuid, is_enabled boolean)
      join game_catalog g on g.id = x.game_id
     where g.lifecycle_state not in ('live', 'in_test')
       and not coalesce(x.is_enabled, false);

    -- puzzle_count is set by the generation planner, not the config editor, so
    -- the editor's payload does not carry it. Carry it across the replace or a
    -- routine slate save would silently null it.
    select coalesce(jsonb_object_agg(game_id::text, puzzle_count), '{}'::jsonb)
      into v_prev_counts
      from season_games
     where season_config_id = p_config_id and puzzle_count is not null;

    delete from season_games where season_config_id = p_config_id;

    with incoming as (
      select * from jsonb_to_recordset(p_games) as x(
        game_id            uuid,
        is_enabled         boolean,
        weight             numeric,
        points_override    integer,
        difficulty_floor   text,
        difficulty_ceiling text,
        appears_on_days    integer[],
        starts_on          date,
        ends_on            date,
        sort_order         integer,
        notes              text,
        puzzle_count       integer
      )
    )
    insert into season_games (
      season_config_id, game_id, is_enabled, weight, points_override,
      difficulty_floor, difficulty_ceiling, appears_on_days,
      starts_on, ends_on, sort_order, notes, puzzle_count
    )
    select
      p_config_id,
      i.game_id,
      coalesce(i.is_enabled, false),
      coalesce(i.weight, 1),
      i.points_override,
      i.difficulty_floor,
      i.difficulty_ceiling,
      i.appears_on_days,
      i.starts_on,
      i.ends_on,
      coalesce(i.sort_order, 100),
      i.notes,
      coalesce(i.puzzle_count, (v_prev_counts ->> i.game_id::text)::integer)
    from incoming i
    left join game_catalog g on g.id = i.game_id
    -- assignable → write it · enabled → let the trigger speak · unknown id →
    -- let the FK speak. Only "non-assignable AND disabled" is dropped.
    where g.lifecycle_state in ('live', 'in_test')
       or coalesce(i.is_enabled, false)
       or g.id is null;

    get diagnostics v_games = row_count;
  end if;

  -- ── 3. theme mix ───────────────────────────────────────────────────────────
  if p_theme is not null then
    delete from season_theme_mix where season_config_id = p_config_id;

    insert into season_theme_mix (
      season_config_id, theater_id, sector_code, thread_code,
      target_pct, min_pct, max_pct, is_excluded, notes
    )
    select
      p_config_id, t.theater_id, t.sector_code, t.thread_code,
      coalesce(t.target_pct, 0), t.min_pct, t.max_pct,
      coalesce(t.is_excluded, false), t.notes
    from jsonb_to_recordset(p_theme) as t(
      theater_id  text,
      sector_code text,
      thread_code text,
      target_pct  numeric,
      min_pct     numeric,
      max_pct     numeric,
      is_excluded boolean,
      notes       text
    )
    where t.theater_id is not null;

    get diagnostics v_theme = row_count;
  end if;

  -- ── 4. difficulty mix ──────────────────────────────────────────────────────
  if p_difficulty is not null then
    delete from season_difficulty_mix where season_config_id = p_config_id;

    insert into season_difficulty_mix (
      season_config_id, difficulty_band, target_pct, min_pct, max_pct, applies_to_game_id
    )
    select
      p_config_id, d.difficulty_band, coalesce(d.target_pct, 0),
      d.min_pct, d.max_pct, d.applies_to_game_id
    from jsonb_to_recordset(p_difficulty) as d(
      difficulty_band    text,
      target_pct         numeric,
      min_pct            numeric,
      max_pct            numeric,
      applies_to_game_id uuid
    )
    where d.difficulty_band is not null and d.difficulty_band <> '';

    get diagnostics v_difficulty = row_count;
  end if;

  -- ── 5. scopes (keyed to the SEASON, edited from Section B) ─────────────────
  if p_scopes is not null then
    delete from season_scopes where season_id = v_cur.season_id;

    insert into season_scopes (season_id, scope_type, scope_ref_id, is_excluded)
    select
      v_cur.season_id, sc.scope_type::season_scope_type, sc.scope_ref_id,
      coalesce(sc.is_excluded, false)
    from jsonb_to_recordset(p_scopes) as sc(
      scope_type   text,
      scope_ref_id uuid,
      is_excluded  boolean
    )
    where sc.scope_type is not null;

    get diagnostics v_scopes = row_count;
  end if;

  return jsonb_build_object(
    'config_id',        p_config_id,
    'games',            v_games,
    'theme',            v_theme,
    'difficulty',       v_difficulty,
    'scopes',           v_scopes,
    'dropped_games',    to_jsonb(v_dropped)
  );
end $$;

comment on function public.season_config_save_bundle(uuid, jsonb, jsonb, jsonb, jsonb, jsonb) is
  'CC-LO-SLATE-FILTER-1.0: atomic season-config save. Writes season_config + season_games + season_theme_mix + season_difficulty_mix + season_scopes in ONE transaction — the five separate PostgREST calls it replaces could half-commit. Filters the slate to lifecycle_state in (live,in_test); an ENABLED non-assignable game is passed through so trg_season_games_assignable raises and names it.';

-- Service-role only, exactly like the other season_config_* RPCs.
revoke all on function public.season_config_save_bundle(uuid, jsonb, jsonb, jsonb, jsonb, jsonb) from public;
revoke all on function public.season_config_save_bundle(uuid, jsonb, jsonb, jsonb, jsonb, jsonb) from anon, authenticated;
grant execute on function public.season_config_save_bundle(uuid, jsonb, jsonb, jsonb, jsonb, jsonb) to service_role;

-- ── verification gate ────────────────────────────────────────────────────────
-- The catalog and every existing assignment must be untouched by this migration.
do $$
declare c int; sg int; live int;
begin
  select count(*) into c    from game_catalog;
  select count(*) into live from game_catalog where lifecycle_state = 'live';
  select count(*) into sg   from season_games;

  if c <> 18 or live <> 7 then
    raise exception 'gate: expected 18 catalog rows / 7 live, got % / %', c, live;
  end if;
  if sg <> 28 then
    raise exception 'gate: expected 28 season_games rows, got %', sg;
  end if;
end $$;

commit;
