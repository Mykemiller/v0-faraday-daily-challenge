-- CC-LO-SEASON-SCOPE-1.0 · Phase 3a — resolve PROPOSED rules, not just saved ones.
--
-- Phase 3 requirement 4 asks for a live preview: "the commissioner must see the
-- resolved team list before saving." fn_season_scope_summary() reads
-- season_scopes, so it can only ever describe what is already committed — and
-- in the create wizard there is no season row at all yet.
--
-- So the resolution core is lifted out into fn_season_scope_resolve(season,
-- rules jsonb). fn_season_scope_teams() becomes a thin wrapper that feeds it the
-- saved rows; fn_season_scope_preview() feeds it whatever the form currently
-- holds. ONE implementation of D1/D3/D4/D6 — a preview that disagreed with the
-- engine would be worse than no preview.
--
-- p_season_id may be NULL (the create wizard). D6's per-season conference
-- lookup then has nothing to read, so every team resolves through the
-- teams.conference_id fallback. The UI labels this.

begin;

-- ── the resolution core ──────────────────────────────────────────────────────

create or replace function public.fn_season_scope_resolve(
  p_season_id uuid,
  p_rules     jsonb
)
returns table (team_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  with rules as (
    select x.scope_type, x.scope_ref_id, coalesce(x.is_excluded, false) as is_excluded
      from jsonb_to_recordset(coalesce(p_rules, '[]'::jsonb))
        as x(scope_type text, scope_ref_id uuid, is_excluded boolean)
     where x.scope_type is not null
  ),
  inc as (select * from rules where not is_excluded),
  exc as (select * from rules where     is_excluded),

  -- D6 — per-season conference membership, with the teams.conference_id
  -- fallback for teams that have no row for this season (and for every team
  -- when p_season_id is NULL).
  team_conf as (
    select tcm.team_id as tid, tcm.conference_id as cid
      from public.team_conference_memberships tcm
     where p_season_id is not null and tcm.season_id = p_season_id
    union
    select t.id, t.conference_id
      from public.teams t
     where t.conference_id is not null
       and not exists (
         select 1 from public.team_conference_memberships tcm
          where p_season_id is not null
            and tcm.team_id = t.id and tcm.season_id = p_season_id
       )
  ),
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
     where not exists (select 1 from inc)
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
     where exists (select 1 from exc where scope_type = 'platform')
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

comment on function public.fn_season_scope_resolve(uuid, jsonb) is
  'CC-LO-SEASON-SCOPE-1.0: THE resolution implementation (D1/D3/D4/D6) over an arbitrary rule set. fn_season_scope_teams feeds it the saved rows; fn_season_scope_preview feeds it unsaved form state. p_season_id NULL = no season yet, so conference membership falls back to teams.conference_id.';

-- ── saved-rows wrapper (signature and behaviour unchanged) ───────────────────

create or replace function public.fn_season_scope_teams(p_season_id uuid)
returns table (team_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select r.team_id
    from public.fn_season_scope_resolve(
      p_season_id,
      coalesce((
        select jsonb_agg(jsonb_build_object(
                 'scope_type',   ss.scope_type,
                 'scope_ref_id', ss.scope_ref_id,
                 'is_excluded',  ss.is_excluded))
          from public.season_scopes ss
         where ss.season_id = p_season_id), '[]'::jsonb)
    ) r;
$$;

-- ── summary over an arbitrary rule set, and its two entry points ─────────────

create or replace function public.fn_season_scope_summary_of(
  p_season_id uuid,
  p_rules     jsonb
) returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with rules as (
    select x.scope_type, x.scope_ref_id, coalesce(x.is_excluded, false) as is_excluded
      from jsonb_to_recordset(coalesce(p_rules, '[]'::jsonb))
        as x(scope_type text, scope_ref_id uuid, is_excluded boolean)
     where x.scope_type is not null
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
      from public.fn_season_scope_resolve(p_season_id, p_rules) s
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
    'league_count', (
      select count(distinct coalesce(c.league_id, t2.league_id))
        from public.fn_season_scope_resolve(p_season_id, p_rules) s2
        join public.teams t2 on t2.id = s2.team_id
        left join public.conferences c on c.id = t2.conference_id),
    'conference_count', (
      select count(distinct t3.conference_id)
        from public.fn_season_scope_resolve(p_season_id, p_rules) s3
        join public.teams t3 on t3.id = s3.team_id
       where t3.conference_id is not null),
    'team_count', (select count(*) from teams),
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name)
        from teams), '[]'::jsonb)
  );
$$;

create or replace function public.fn_season_scope_summary(p_season_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.fn_season_scope_summary_of(
    p_season_id,
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'scope_type',   ss.scope_type,
               'scope_ref_id', ss.scope_ref_id,
               'is_excluded',  ss.is_excluded))
        from public.season_scopes ss
       where ss.season_id = p_season_id), '[]'::jsonb));
$$;

/** Preview for the League Office scope editor: what WOULD this rule set resolve
 *  to, without writing anything. Read-only and safe to call on every keystroke. */
create or replace function public.fn_season_scope_preview(
  p_season_id uuid,
  p_scopes    jsonb
) returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.fn_season_scope_summary_of(p_season_id, p_scopes);
$$;

comment on function public.fn_season_scope_preview(uuid, jsonb) is
  'CC-LO-SEASON-SCOPE-1.0: resolves a PROPOSED rule set without writing. Drives the League Office live preview, including in the create wizard where no season row exists yet (pass NULL).';

grant execute on function public.fn_season_scope_resolve(uuid, jsonb)     to service_role;
grant execute on function public.fn_season_scope_summary_of(uuid, jsonb)  to service_role;
grant execute on function public.fn_season_scope_preview(uuid, jsonb)     to service_role;

-- ── verification gate ────────────────────────────────────────────────────────
-- The refactor must not move a single team for any existing season.
do $$
declare r record; a uuid[]; b uuid[];
begin
  for r in select id, name from public.seasons loop
    select coalesce(array_agg(team_id order by team_id), '{}') into a
      from public.fn_season_scope_teams(r.id);
    select coalesce(array_agg(team_id order by team_id), '{}') into b
      from public.fn_season_scope_resolve(r.id, coalesce((
        select jsonb_agg(jsonb_build_object('scope_type', ss.scope_type,
                                            'scope_ref_id', ss.scope_ref_id,
                                            'is_excluded', ss.is_excluded))
          from public.season_scopes ss where ss.season_id = r.id), '[]'::jsonb));
    if a <> b then
      raise exception 'gate: season "%" — wrapper and core disagree', r.name;
    end if;
  end loop;
end $$;

commit;
