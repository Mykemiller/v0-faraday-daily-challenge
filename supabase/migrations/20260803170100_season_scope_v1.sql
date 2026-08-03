-- CC-LO-SEASON-SCOPE-1.0 · Phase 1, part 2 of 2 — the scope model.
--
-- A season is scoped by a SET of include/exclude rules across leagues,
-- conferences and teams, evaluated at READ time (D1). `seasons.league_id` is
-- legacy for this purpose and is neither read nor written here (D12).
--
-- Apply 20260803170000_season_scope_v1_enum.sql FIRST — this file uses the
-- 'team' enum value it adds, and Postgres will not accept both in one txn.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
--   • does NOT remove the `-- 5. scopes` block from season_config_save_bundle.
--     That lands in 20260803170200_season_scope_v1_retire_bundle_scopes.sql,
--     which must be applied ONLY once the Phase 3 UI is deployed — the League
--     Office config editor in production today sends `scope` on EVERY save, so
--     making the RPC raise before then breaks every config save in prod.
--   • does NOT add or alter RLS on season_scopes / leagues / conferences.
--     RLS is disabled on all three. Known, tracked separately, out of scope.
--   • does NOT touch seasons.league_id VALUES, and does not drop the column.
--   • does NOT touch score_events, dc_completions, leaderboard_daily, or any
--     scoring logic.
--
-- CORRECTION TO THE TICKET, verified live 2026-08-03: the scope submitted for
-- `Hot summer Final Beta` was NOT dropped between the form and the RPC. The
-- wizard wrote all four rows on 2026-07-31; migration
-- league_model_part_b_durable_teams deleted them on 2026-08-01 by design
-- (its decision Q4b), and a later config save re-inserted the platform row.
-- The real defect is that season_config_save_bundle rewrites a season's whole
-- scope as a side effect of an unrelated slate save, and its audit snapshot()
-- does not record scopes — so the rewrite leaves no trace. That is what the
-- single-writer RPC below and the part-3 migration close.

begin;

-- ── 1. constraints ───────────────────────────────────────────────────────────

-- scope_ref_id is NULL for platform rows, so a plain UNIQUE would let a season
-- collect unlimited duplicate platform rows (NULLs never conflict). COALESCE to
-- the nil uuid makes the platform row dedupe like every other row.
create unique index if not exists season_scopes_unique_rule
  on public.season_scopes (
    season_id,
    scope_type,
    coalesce(scope_ref_id, '00000000-0000-0000-0000-000000000000'::uuid),
    is_excluded
  );

-- Every read path resolves a whole season's rules at once.
create index if not exists season_scopes_season_idx
  on public.season_scopes (season_id)
  include (scope_type, scope_ref_id, is_excluded);

-- season_scopes_platform_chk (platform ⇔ ref IS NULL) is retained as-is.

-- ── 2. referential validation (D8) ───────────────────────────────────────────
--
-- scope_ref_id is polymorphic, so an FK is not available. A trigger is.
-- This is the check that would have caught 6346a188-64e4-483f-a9c7-979627ccbd39
-- at the source: it was a top-level `teams` row that the pre-Part-B scope picker
-- listed as a "league", and Part B deleted the row out from under it.
--
-- ARCHIVED REFS (locked by Myke 2026-08-03, narrowing D8): existence is checked
-- always; archived is rejected on INCLUDE rows only. Archived teams ARE in scope
-- (D7 overridden — see fn_season_scope_teams), so an archived-team EXCLUSION is
-- the only way to remove one from a season. Blocking it would make the feature
-- unable to express its own backfill.

create or replace function public.fn_season_scopes_validate_ref()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_table    text;
  v_exists   boolean := false;
  v_archived boolean := false;
begin
  -- season_scopes_platform_chk already guarantees scope_ref_id IS NULL here.
  if new.scope_type = 'platform' then
    return new;
  end if;

  if new.scope_type = 'league' then
    v_table := 'leagues';
    select true, (l.archived_at is not null or l.is_active = false)
      into v_exists, v_archived
      from public.leagues l where l.id = new.scope_ref_id;

  elsif new.scope_type = 'conference' then
    v_table := 'conferences';
    select true, (c.archived_at is not null or c.is_active = false)
      into v_exists, v_archived
      from public.conferences c where c.id = new.scope_ref_id;

  elsif new.scope_type = 'team' then
    v_table := 'teams';
    select true, (t.archived_at is not null or t.is_active = false)
      into v_exists, v_archived
      from public.teams t where t.id = new.scope_ref_id;

  else
    raise exception 'season_scopes: unknown scope_type %', new.scope_type
      using errcode = '23514';
  end if;

  if not coalesce(v_exists, false) then
    raise exception
      'season_scopes: % is not a row in public.% (scope_type=%). Nothing was written.',
      new.scope_ref_id, v_table, new.scope_type
      using errcode = '23514',
            hint = 'Scope refs must be live ids read from leagues / conferences / teams.';
  end if;

  if v_archived and not coalesce(new.is_excluded, false) then
    raise exception
      'season_scopes: % is archived in public.% and cannot be INCLUDED in a season scope. Nothing was written.',
      new.scope_ref_id, v_table
      using errcode = '23514',
            hint = 'An archived league, conference or team may be EXCLUDED, but never included.';
  end if;

  return new;
end $$;

drop trigger if exists trg_season_scopes_validate_ref on public.season_scopes;
create trigger trg_season_scopes_validate_ref
  before insert or update on public.season_scopes
  for each row execute function public.fn_season_scopes_validate_ref();

-- ── 3. the resolution engine (D1, D3, D4, D6; D7 overridden) ─────────────────
--
-- D1  include-set minus exclude-set, evaluated now — never a materialised list.
-- D3  exclusion ALWAYS wins, at any level. One rule, no tie-breaking.
-- D4  no include rows ⇒ whole platform. A non-excluded `platform` row is the
--     same thing said explicitly. This is what keeps all six pre-existing
--     seasons byte-identical with zero data migration.
-- D6  team→conference is per-season via team_conference_memberships for THIS
--     season, falling back to teams.conference_id only when the team has no
--     membership row for the season. team→league is the resolved conference's
--     league_id, falling back to teams.league_id. Both are multi-valued: one
--     in-scope conference is enough.
-- D7  OVERRIDDEN by Myke 2026-08-03 — archived/inactive teams ARE in scope.
--     The original rationale ("matches team_leaderboard's current behaviour")
--     was factually wrong: team_leaderboard has no is_active/archived_at filter
--     and `Lonely hearts` (archived) ranks 5th in Season 1 and 3rd in Season 2
--     today. Filtering here would silently re-rank two closed seasons.

create or replace function public.fn_season_scope_teams(p_season_id uuid)
returns table (team_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  with rules as (
    select scope_type, scope_ref_id, coalesce(is_excluded, false) as is_excluded
      from public.season_scopes
     where season_id = p_season_id
  ),
  inc as (select * from rules where not is_excluded),
  exc as (select * from rules where     is_excluded),

  -- D6 — every (team, conference) pair that counts for THIS season.
  team_conf as (
    select tcm.team_id as tid, tcm.conference_id as cid
      from public.team_conference_memberships tcm
     where tcm.season_id = p_season_id
    union
    select t.id, t.conference_id
      from public.teams t
     where t.conference_id is not null
       and not exists (
         select 1 from public.team_conference_memberships tcm
          where tcm.team_id = t.id and tcm.season_id = p_season_id
       )
  ),

  -- D6 — team → league, via the resolved conferences, else teams.league_id.
  team_league as (
    select tc.tid, c.league_id as lid
      from team_conf tc
      join public.conferences c on c.id = tc.cid
     where c.league_id is not null
    union
    select t.id, t.league_id
      from public.teams t
     where t.league_id is not null
       and not exists (
         select 1
           from team_conf tc
           join public.conferences c on c.id = tc.cid
          where tc.tid = t.id and c.league_id is not null
       )
  ),

  included as (
    select t.id
      from public.teams t
     where
       -- D4 — an empty or exclusions-only rule set means "whole platform".
       -- Resolving it to NOBODY instead would turn a half-filled form into a
       -- silently dead season, which is the failure buildScopeRows already
       -- guards against on the write side.
       not exists (select 1 from inc)
       or exists (select 1 from inc where scope_type = 'platform')
       or exists (select 1 from inc i where i.scope_type = 'team' and i.scope_ref_id = t.id)
       or exists (
            select 1 from inc i join team_conf tc on tc.tid = t.id
             where i.scope_type = 'conference' and i.scope_ref_id = tc.cid)
       or exists (
            select 1 from inc i join team_league tl on tl.tid = t.id
             where i.scope_type = 'league' and i.scope_ref_id = tl.lid)
  ),

  excluded as (
    select t.id
      from public.teams t
     where
       -- An EXCLUDED platform row means "nobody". lo_set_season_scope refuses to
       -- write one; the engine still has to define it rather than ignore it.
       exists (select 1 from exc where scope_type = 'platform')
       or exists (select 1 from exc e where e.scope_type = 'team' and e.scope_ref_id = t.id)
       or exists (
            select 1 from exc e join team_conf tc on tc.tid = t.id
             where e.scope_type = 'conference' and e.scope_ref_id = tc.cid)
       or exists (
            select 1 from exc e join team_league tl on tl.tid = t.id
             where e.scope_type = 'league' and e.scope_ref_id = tl.lid)
  )

  select id from included
  except
  select id from excluded;
$$;

comment on function public.fn_season_scope_teams(uuid) is
  'CC-LO-SEASON-SCOPE-1.0: the teams a season covers. Include-set minus exclude-set, resolved at read time; exclusion always wins (D3). No include rows = whole platform (D4). Conference membership is per-season via team_conference_memberships (D6). Archived teams are NOT filtered out — see the migration header.';

-- ── 4. summary, for the UI preview and the audit payload ─────────────────────

create or replace function public.fn_season_scope_summary(p_season_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with rules as (
    select scope_type::text as scope_type, scope_ref_id,
           coalesce(is_excluded, false) as is_excluded
      from public.season_scopes
     where season_id = p_season_id
  ),
  named as (
    select r.scope_type, r.scope_ref_id, r.is_excluded,
           case r.scope_type
             when 'platform'   then 'Whole platform'
             when 'league'     then (select l.name from public.leagues l     where l.id = r.scope_ref_id)
             when 'conference' then (select c.name from public.conferences c where c.id = r.scope_ref_id)
             when 'team'       then (select t.name from public.teams t       where t.id = r.scope_ref_id)
           end as name
      from rules r
  ),
  teams as (
    select t.id, t.name
      from public.fn_season_scope_teams(p_season_id) s
      join public.teams t on t.id = s.team_id
  )
  select jsonb_build_object(
    'season_id', p_season_id,
    'mode', case
              when not exists (select 1 from rules where not is_excluded) then 'platform'
              when exists (select 1 from rules where not is_excluded and scope_type = 'platform') then 'platform'
              else (select string_agg(distinct scope_type, '+' order by scope_type)
                      from rules where not is_excluded)
            end,
    'included', coalesce((
      select jsonb_agg(jsonb_build_object('type', scope_type, 'id', scope_ref_id, 'name', name)
                       order by scope_type, name)
        from named where not is_excluded), '[]'::jsonb),
    'excluded', coalesce((
      select jsonb_agg(jsonb_build_object('type', scope_type, 'id', scope_ref_id, 'name', name)
                       order by scope_type, name)
        from named where is_excluded), '[]'::jsonb),
    'team_count', (select count(*) from teams),
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name)
        from teams), '[]'::jsonb)
  );
$$;

comment on function public.fn_season_scope_summary(uuid) is
  'CC-LO-SEASON-SCOPE-1.0: resolved scope for one season — rules with display names plus the full in-scope team list. Feeds the League Office live preview and the season.set_scope audit before/after (D10).';

-- ── 5. the single writer (D9, D10, D11) ──────────────────────────────────────

create or replace function public.lo_set_season_scope(
  p_season_id   uuid,
  p_scopes      jsonb,
  p_staff_email text,
  p_reason      text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_season        public.seasons;
  v_before        jsonb;
  v_after         jsonb;
  v_before_teams  uuid[];
  v_after_teams   uuid[];
  v_inc_total     int;
  v_inc_platform  int;
  v_exc_platform  int;
  v_entering      jsonb;
  v_leaving       jsonb;
  v_warning       jsonb := null;
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'A reason is required — it is the audit trail for this scope change.'
      using errcode = 'P0001';
  end if;

  if p_scopes is null or jsonb_typeof(p_scopes) <> 'array' then
    raise exception 'p_scopes must be a JSON array of {scope_type, scope_ref_id, is_excluded} rows. Pass [] for "whole platform".'
      using errcode = 'P0001';
  end if;

  select * into v_season from public.seasons where id = p_season_id for update;
  if not found then
    raise exception 'Season % not found.', p_season_id using errcode = 'P0002';
  end if;

  -- D11 — closed seasons are final.
  if v_season.status = 'closed' then
    raise exception
      'Season "%" is closed. Its scope cannot be changed — the standings it produced are final.',
      v_season.name
      using errcode = 'P0001';
  end if;

  -- D5 — a platform include is "everyone"; pairing it with a narrower include is
  -- always a UI bug, never an intent. Exclusions alongside it are the expected
  -- "everyone except X" case and are allowed.
  select count(*) filter (where not coalesce(is_excluded, false)),
         count(*) filter (where not coalesce(is_excluded, false) and scope_type = 'platform'),
         count(*) filter (where     coalesce(is_excluded, false) and scope_type = 'platform')
    into v_inc_total, v_inc_platform, v_exc_platform
    from jsonb_to_recordset(p_scopes)
      as x(scope_type text, scope_ref_id uuid, is_excluded boolean);

  if v_inc_platform > 0 and v_inc_total > v_inc_platform then
    raise exception
      'A "whole platform" include cannot be combined with league, conference or team includes — "everyone plus X" is not a scope. Remove one or the other.'
      using errcode = 'P0001';
  end if;

  if v_exc_platform > 0 then
    raise exception
      'A "whole platform" EXCLUSION would resolve to no teams at all. Refusing to write it.'
      using errcode = 'P0001';
  end if;

  -- Capture the world before we touch it (D10).
  v_before := public.fn_season_scope_summary(p_season_id);
  select coalesce(array_agg(team_id), '{}') into v_before_teams
    from public.fn_season_scope_teams(p_season_id);

  -- Replace the set. One transaction — trg_season_scopes_validate_ref rolls the
  -- whole thing back if any ref is dangling or an archived include slips in.
  delete from public.season_scopes where season_id = p_season_id;

  insert into public.season_scopes (season_id, scope_type, scope_ref_id, is_excluded)
  select p_season_id,
         x.scope_type::public.season_scope_type,
         x.scope_ref_id,
         coalesce(x.is_excluded, false)
    from jsonb_to_recordset(p_scopes)
      as x(scope_type text, scope_ref_id uuid, is_excluded boolean)
   where x.scope_type is not null;

  v_after := public.fn_season_scope_summary(p_season_id);
  select coalesce(array_agg(team_id), '{}') into v_after_teams
    from public.fn_season_scope_teams(p_season_id);

  -- D11 — a mid-season scope change retroactively rewrites standings. Allowed,
  -- never quiet: name every team crossing the boundary so the UI can confirm.
  if v_season.status = 'active' then
    select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.name), '[]'::jsonb)
      into v_entering
      from public.teams t
     where t.id = any (v_after_teams) and not (t.id = any (v_before_teams));

    select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.name), '[]'::jsonb)
      into v_leaving
      from public.teams t
     where t.id = any (v_before_teams) and not (t.id = any (v_after_teams));

    if jsonb_array_length(v_entering) > 0 or jsonb_array_length(v_leaving) > 0 then
      v_warning := jsonb_build_object(
        'kind', 'active_season_scope_change',
        'season', v_season.name,
        'locked_at', v_season.locked_at,
        'entering', v_entering,
        'leaving',  v_leaving,
        'message', format(
          'Season "%s" is ACTIVE. This change moves %s team(s) into scope and %s out. Standings will be recomputed against the new set.',
          v_season.name, jsonb_array_length(v_entering), jsonb_array_length(v_leaving))
      );
    end if;
  end if;

  -- D10 — before/after are the full resolved rule set AND the resolved team
  -- list, so the change is reconstructable without re-running resolution.
  insert into public.lo_audit_log
    (staff_email, domain, action, reason, target_type, target_id, before, after, reversible)
  values
    (coalesce(nullif(btrim(p_staff_email), ''), 'system'), 'seasons', 'season.set_scope',
     p_reason, 'season', p_season_id::text, v_before, v_after, true);

  return jsonb_build_object('ok', true, 'summary', v_after, 'warning', v_warning);
end $$;

comment on function public.lo_set_season_scope(uuid, jsonb, text, text) is
  'CC-LO-SEASON-SCOPE-1.0: the ONLY writer for season_scopes (D9). Validates D5, refuses closed seasons, warns by name on active ones (D11), and writes exactly one lo_audit_log row with action season.set_scope (D10).';

revoke all on function public.lo_set_season_scope(uuid, jsonb, text, text) from public;
revoke all on function public.lo_set_season_scope(uuid, jsonb, text, text) from anon, authenticated;
grant execute on function public.lo_set_season_scope(uuid, jsonb, text, text) to service_role;

grant execute on function public.fn_season_scope_teams(uuid)   to service_role;
grant execute on function public.fn_season_scope_summary(uuid) to service_role;

-- ── 6. seasons.league_id is legacy FOR SCOPING (D12) ─────────────────────────
--
-- Deliberately NOT worded "unused". Contrary to the ticket's premise it is read
-- in three live paths, and a "legacy/unused" comment would invite a drop that
-- breaks all three:
--   • fn_season_roster_carry_forward — picks the default source season by
--     `WHERE league_id = v_to.league_id`;
--   • generationFindings() — blocks generation with `no_league` when it is null;
--   • seasons_no_overlap_per_league — EXCLUDE (league_id WITH =, daterange &&).

comment on column public.seasons.league_id is
  'LEGACY FOR SCOPING (CC-LO-SEASON-SCOPE-1.0, D12). A season is scoped by season_scopes, NOT by this column — never use it to decide which teams a season covers. Still load-bearing elsewhere: fn_season_roster_carry_forward default source-season selection, the generation no_league gate, and the seasons_no_overlap_per_league exclusion constraint. Do not drop without addressing those three.';

-- ── verification gate ────────────────────────────────────────────────────────
-- D4 must make this migration a behavioural no-op for every existing season.
-- Any divergence means the resolution engine is wrong; fail the migration
-- rather than ship a silent re-ranking.
do $$
declare
  r        record;
  v_scope  int;
  v_lb     int;
  v_rows   int;
begin
  select count(*) into v_rows from public.season_scopes;
  if v_rows <> 6 then
    raise exception 'gate: expected 6 pre-existing season_scopes rows, got %', v_rows;
  end if;

  for r in select id, name from public.seasons loop
    -- The teams team_leaderboard would show, intersected with the resolved
    -- scope. With every season on a platform scope these must be equal.
    select count(distinct tm.team_id) into v_scope
      from public.team_memberships tm
      join public.fn_season_scope_teams(r.id) s on s.team_id = tm.team_id
     where tm.season_id = r.id and tm.pending = false;

    select count(*) into v_lb from public.team_leaderboard(r.name, 1000);

    if coalesce(v_scope, 0) <> v_lb then
      raise exception
        'gate: season "%" — scope resolves % team(s) with rosters but team_leaderboard returns %',
        r.name, v_scope, v_lb;
    end if;
  end loop;
end $$;

commit;
