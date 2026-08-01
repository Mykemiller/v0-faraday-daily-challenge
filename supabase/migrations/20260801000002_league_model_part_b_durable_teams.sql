-- CC-LEAGUE-MODEL-1.0 Part B (phase 1 of 2) — teams become durable franchises.
-- APPLIED to prod (ycadmmngkdhvpcsrcuaq) 2026-08-01 as
-- `league_model_part_b_durable_teams`, after a full transactional dry run;
-- kept here for VCS parity. Decisions (Myke, 2026-08-01):
--   Q1: DROP the demo DELOITTE company team (5 @example.com members, zero
--       conversations); DELOITTE-2026 is the real Deloitte.
--   Q2: team_conference_memberships is DERIVED from real play — the distinct
--       (team, season) pairs in team_memberships — and kept live going forward
--       by the trg_team_memberships_tcm_autofill trigger below.
--   Q3: the DELOITTE-2026 team + Network Edge + Cloud and Platforms all join
--       the Deloitte org conference (the DELOITTE-2026 league's GENERAL
--       conference, upgraded in place to code DELOITTE / type 'org').
--   Q4b: the one season whose season_scopes referenced team ids as "leagues"
--       (Hot summer Final Beta) resets to a platform scope.
--   Q4c: the demo DELOITTE league + its conference are ARCHIVED, not deleted.
-- Column drops are deliberately NOT here — they land in phase 2
-- (20260801000003) which must be applied ONLY after this PR's Vercel prod
-- deploy is live, so no serving window mixes old code with dropped columns.

update public.conferences c
   set code='DELOITTE', name='Deloitte', type='org', org_domain='deloitte.com'
 where c.league_id=(select id from public.leagues where code='DELOITTE-2026')
   and c.code='GENERAL';

insert into public.conferences (league_id, code, name, type)
values ((select id from public.leagues where code='INDEPENDENT'),
        'LONELY-HEARTS','Lonely hearts','private');

update public.teams
   set league_id=(select id from public.leagues where code='DELOITTE-2026'),
       conference_id=(select c.id from public.conferences c
                       join public.leagues l on l.id=c.league_id
                      where l.code='DELOITTE-2026' and c.code='DELOITTE')
 where code in ('DELOITTE-2026','DELOITTE-NET','HCI');

update public.teams
   set conference_id=(select c.id from public.conferences c
                       join public.leagues l on l.id=c.league_id
                      where l.code='INDEPENDENT' and c.code='LONELY-HEARTS')
 where code='LONELY-HEART-2026';

delete from public.teams where code='DELOITTE';

insert into public.team_conference_memberships (team_id, conference_id, season_id)
select distinct tm.team_id, t.conference_id, tm.season_id
from public.team_memberships tm
join public.teams t on t.id=tm.team_id
where t.conference_id is not null
on conflict do nothing;

delete from public.season_scopes
 where season_id=(select id from public.seasons where name='Hot summer Final Beta');
insert into public.season_scopes (season_id, scope_type, scope_ref_id, is_excluded)
values ((select id from public.seasons where name='Hot summer Final Beta'),
        'platform', null, false);

update public.conferences set archived_at=now(), is_active=false
 where league_id=(select id from public.leagues where code='DELOITTE') and archived_at is null;
update public.leagues set archived_at=now(), is_active=false where code='DELOITTE';

-- ── function rewrites: the company/parent hierarchy is replaced by
--    conferences + team_conference_memberships. RPC names/signatures are kept
--    except team_get_my_teams (return columns changed → drop + recreate). ────

create or replace function public.fn_group_member_emails(p_group uuid)
returns table(member_email citext) language sql stable set search_path to 'public'
as $fn$
  -- p_group is a TEAM id or a CONFERENCE id: a conference's members are the
  -- members of every team holding a team_conference_memberships row in it for
  -- the active season (DISTINCT keeps multi-team members counted once).
  WITH active AS (
    SELECT id FROM public.seasons WHERE status = 'active'
    ORDER BY starts_on DESC LIMIT 1
  )
  SELECT DISTINCT s.email::citext
  FROM public.team_memberships tm
  JOIN public.dc_subscribers s ON s.id = tm.subscriber_id
  CROSS JOIN active a
  WHERE tm.season_id = a.id
    AND tm.pending = false
    AND (
      tm.team_id = p_group
      OR tm.team_id IN (SELECT tcm.team_id FROM public.team_conference_memberships tcm
                        WHERE tcm.conference_id = p_group AND tcm.season_id = a.id)
    );
$fn$;

create or replace function public.fn_company_standings(p_period text, p_day date, p_season uuid)
returns table(company_id uuid, code citext, name text, signals bigint, rank bigint)
language sql stable set search_path to 'public'
as $fn$
  -- "Companies" are org-type conferences now.
  WITH co AS (
    SELECT c.id, c.code::citext AS code, c.name,
           public.fn_group_period_signals(c.id, p_period, p_day, p_season) AS signals
    FROM public.conferences c
    WHERE c.type = 'org' AND c.archived_at IS NULL
  )
  SELECT id, code, name, signals, RANK() OVER (ORDER BY signals DESC, name ASC)
  FROM co ORDER BY signals DESC, name ASC;
$fn$;

create or replace function public.fn_company_team_standings(p_company uuid, p_period text, p_day date, p_season uuid)
returns table(team_id uuid, code citext, name text, signals bigint, rank bigint)
language sql stable set search_path to 'public'
as $fn$
  -- p_company is a conference id; siblings are the teams with a membership row
  -- in it (any season — mirrors the old static parent_id list).
  WITH sib AS (
    SELECT t.id, t.code, t.name,
           public.fn_group_period_signals(t.id, p_period, p_day, p_season) AS signals
    FROM public.teams t
    WHERE t.id IN (SELECT tcm.team_id FROM public.team_conference_memberships tcm
                   WHERE tcm.conference_id = p_company)
  )
  SELECT id, code, name, signals, RANK() OVER (ORDER BY signals DESC, name ASC)
  FROM sib ORDER BY signals DESC, name ASC;
$fn$;

create or replace function public.team_create(p_email citext, p_name text, p_code citext default null::citext, p_group_type group_type default 'custom'::group_type, p_parent_code citext default null::citext)
returns teams language plpgsql set search_path to 'public'
as $fn$
DECLARE
  v_sub uuid;
  v_season public.seasons;
  v_code citext := coalesce(p_code, (public.slugify_team(p_name) || '-' || extract(year from now())::text)::citext);
  v_team public.teams;
  v_league uuid;
  v_conf uuid;
BEGIN
  -- p_group_type / p_parent_code retained for wire compatibility, IGNORED:
  -- the company/parent hierarchy is retired (Part B) — org structure lives in
  -- conferences + team_conference_memberships now.
  IF p_email IS NULL OR p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'email and name are required';
  END IF;
  SELECT id INTO v_sub FROM public.dc_subscribers WHERE email = p_email;
  IF v_sub IS NULL THEN RAISE EXCEPTION 'subscriber not found'; END IF;
  SELECT * INTO v_season FROM public.seasons WHERE status = 'active'
   ORDER BY starts_on DESC LIMIT 1;
  IF v_season.id IS NULL THEN RAISE EXCEPTION 'no active season'; END IF;
  SELECT l.id, c.id INTO v_league, v_conf
    FROM public.leagues l JOIN public.conferences c ON c.league_id = l.id
   WHERE l.code = 'INDEPENDENT' AND c.code = 'GENERAL';
  INSERT INTO public.teams (code, name, created_by_email, captain_id, league_id, conference_id)
  VALUES (v_code, p_name, p_email, v_sub, v_league, v_conf)
  RETURNING * INTO v_team;
  INSERT INTO public.team_memberships (subscriber_id, team_id, season_id, pending)
  VALUES (v_sub, v_team.id, v_season.id, false)
  ON CONFLICT DO NOTHING;
  RETURN v_team;
END $fn$;

drop function public.team_get_my_teams(citext);
create function public.team_get_my_teams(p_email citext)
returns table(team_id uuid, code citext, name text, conference_code text, conference_name text, role text, members integer, joined_at timestamptz)
language sql stable set search_path to 'public'
as $fn$
  WITH active AS (
    SELECT id FROM public.seasons WHERE status = 'active'
    ORDER BY starts_on DESC LIMIT 1
  ), me AS (
    SELECT id FROM public.dc_subscribers WHERE email = p_email
  )
  SELECT t.id, t.code, t.name, c.code, c.name,
         CASE WHEN t.captain_id = me.id THEN 'creator' ELSE 'member' END AS role,
         (SELECT count(*)::int FROM public.team_memberships x, active a2
           WHERE x.team_id = t.id AND x.season_id = a2.id AND x.pending = false) AS members,
         tm.created_at AS joined_at
  FROM me
  CROSS JOIN active a
  JOIN public.team_memberships tm ON tm.subscriber_id = me.id AND tm.season_id = a.id AND tm.pending = false
  JOIN public.teams t ON t.id = tm.team_id
  LEFT JOIN public.conferences c ON c.id = t.conference_id
  ORDER BY t.name;
$fn$;

create or replace function public.team_leave(p_email citext, p_code citext)
returns boolean language plpgsql set search_path to 'public'
as $fn$
DECLARE
  v_sub uuid;
  v_season uuid;
  v_team public.teams;
  v_remaining int;
  v_new_captain uuid;
BEGIN
  SELECT id INTO v_sub FROM public.dc_subscribers WHERE email = p_email;
  IF v_sub IS NULL THEN RAISE EXCEPTION 'subscriber not found'; END IF;
  SELECT * INTO v_team FROM public.teams WHERE code = p_code;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid team code'; END IF;
  SELECT id INTO v_season FROM public.seasons WHERE status = 'active'
   ORDER BY starts_on DESC LIMIT 1;

  IF NOT EXISTS (SELECT 1 FROM public.team_memberships
                  WHERE subscriber_id = v_sub AND team_id = v_team.id
                    AND (v_season IS NULL OR season_id = v_season)) THEN
    RAISE EXCEPTION 'not a member of this group';
  END IF;

  DELETE FROM public.team_memberships
   WHERE subscriber_id = v_sub AND team_id = v_team.id
     AND (v_season IS NULL OR season_id = v_season);

  SELECT count(*)::int INTO v_remaining
    FROM public.team_memberships WHERE team_id = v_team.id;

  IF v_remaining = 0 THEN
    -- Durable-team model: no company/children special case — an empty team is
    -- deleted (its team_conference_memberships cascade with it).
    DELETE FROM public.teams WHERE id = v_team.id;
  ELSIF v_team.captain_id = v_sub THEN
    SELECT subscriber_id INTO v_new_captain FROM public.team_memberships
     WHERE team_id = v_team.id ORDER BY created_at ASC, subscriber_id ASC LIMIT 1;
    UPDATE public.teams SET captain_id = v_new_captain WHERE id = v_team.id;
  END IF;
  RETURN true;
END $fn$;

-- Forward maintenance for Q2: every new membership keeps the team's season
-- entry in team_conference_memberships current, regardless of write path
-- (RPCs, /api/teams REST writes, create-subscriber).
create function public.fn_tcm_autofill()
returns trigger language plpgsql set search_path to 'public'
as $fn$
DECLARE v_conf uuid;
BEGIN
  SELECT conference_id INTO v_conf FROM public.teams WHERE id = NEW.team_id;
  IF v_conf IS NOT NULL THEN
    INSERT INTO public.team_conference_memberships (team_id, conference_id, season_id)
    VALUES (NEW.team_id, v_conf, NEW.season_id)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $fn$;
create trigger trg_team_memberships_tcm_autofill
after insert on public.team_memberships
for each row execute function public.fn_tcm_autofill();

-- verification gate: raise (and roll everything back) on unexpected counts
do $$
declare v_teams int; v_tcm int; v_tcm_teams int; v_mem int; v_scopes int; v_org_teams int;
begin
  select count(*) into v_teams from public.teams;
  select count(*), count(distinct team_id) into v_tcm, v_tcm_teams from public.team_conference_memberships;
  select count(*) into v_mem from public.team_memberships;
  select count(*) into v_scopes from public.season_scopes
   where season_id=(select id from public.seasons where name='Hot summer Final Beta');
  select count(distinct team_id) into v_org_teams from public.team_conference_memberships tcm
   join public.conferences c on c.id=tcm.conference_id where c.type='org';
  if v_teams<>6 or v_tcm<>12 or v_tcm_teams<>6 or v_mem<>24 or v_scopes<>1 or v_org_teams<>3 then
    raise exception 'Part B gate failed: teams=% tcm=% tcm_teams=% memberships=% hsfb_scopes=% org_teams=%',
      v_teams, v_tcm, v_tcm_teams, v_mem, v_scopes, v_org_teams;
  end if;
end $$;
