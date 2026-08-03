-- CC-LO-SEASON-SCOPE-1.0 — resolution test harness (acceptance criterion 8).
--
-- Follows the docs/lo-slate-filter/verify-harness.sql convention: everything
-- runs inside ONE transaction that ends in ROLLBACK, so it is safe to run
-- against prod. It writes scope rows for two seasons that have no rosters,
-- asserts, and undoes itself.
--
--   psql "$DATABASE_URL" -f docs/lo-season-scope/verify-harness.sql
--
-- Deliberately does NOT insert into `seasons`. That would fire
-- trg_seasons_insert_carry_forward → fn_season_roster_carry_forward, which the
-- ticket's guardrails forbid running as a test. It borrows two existing
-- `upcoming` seasons (Season 3 / Season 4), both of which have zero
-- team_memberships, and rolls their scope rows back.
--
-- Nothing here touches score_events, dc_completions or leaderboard_daily.
--
-- Every case is an assertion: the script raises on the first failure and the
-- transaction unwinds. Reaching the final NOTICE means all cases passed.

begin;

do $$
declare
  v_season   uuid;  -- Season 3 — Post-CES/Pre-GTC   (upcoming, no rosters)
  v_season2  uuid;  -- Season 4 — Post-GTC           (upcoming, no rosters)
  v_league_d uuid;  -- DELOITTE-2026 (active)
  v_league_i uuid;  -- INDEPENDENT   (active)
  v_league_x uuid;  -- DELOITTE      (ARCHIVED)
  v_conf_d   uuid;  -- DELOITTE conference (in DELOITTE-2026)
  v_conf_g   uuid;  -- GENERAL conference  (in INDEPENDENT)
  v_team_sg  uuid;  -- Strategy & Growth — the multi-conference team
  v_team_dl  uuid;  -- Deloitte
  v_team_ts  uuid;  -- Team_Sheba (Independent)
  v_team_lh  uuid;  -- Lonely hearts (ARCHIVED)
  v_n        int;
begin
  select id into v_season  from seasons where slug = 'season-3-post-ces-pre-gtc';
  select id into v_season2 from seasons where slug = 'season-4-post-gtc';

  select id into v_league_d from leagues where code = 'DELOITTE-2026';
  select id into v_league_i from leagues where code = 'INDEPENDENT';
  select id into v_league_x from leagues where code = 'DELOITTE';
  select c.id into v_conf_d from conferences c where c.code='DELOITTE' and c.league_id=v_league_d;
  select c.id into v_conf_g from conferences c where c.code='GENERAL'  and c.league_id=v_league_i;
  select id into v_team_sg from teams where name = 'Strategy & Growth';
  select id into v_team_dl from teams where code = 'DELOITTE-2026';
  select id into v_team_ts from teams where code = 'TEAM-SHEBA';
  select id into v_team_lh from teams where code = 'LONELY-HEART-2026';

  if v_season is null or v_season2 is null then
    raise exception 'harness: the two scratch seasons are missing — adjust the slugs at the top';
  end if;

  delete from season_scopes where season_id in (v_season, v_season2);

  ---------------------------------------------------------------------------
  -- CASE 1 — platform default. No rows at all ⇒ every team (D4).
  ---------------------------------------------------------------------------
  select count(*) into v_n from fn_season_scope_teams(v_season);
  if v_n <> (select count(*) from teams) then
    raise exception 'CASE 1 (empty rule set ⇒ platform): expected % teams, got %',
      (select count(*) from teams), v_n;
  end if;

  insert into season_scopes (season_id, scope_type, scope_ref_id, is_excluded)
  values (v_season, 'platform', null, false);
  select count(*) into v_n from fn_season_scope_teams(v_season);
  if v_n <> (select count(*) from teams) then
    raise exception 'CASE 1b (explicit platform row): expected % teams, got %',
      (select count(*) from teams), v_n;
  end if;

  ---------------------------------------------------------------------------
  -- CASE 2 — an archived team IS in scope.
  -- D7 was OVERRIDDEN by Myke 2026-08-03. team_leaderboard has no
  -- is_active/archived_at filter and `Lonely hearts` ranks 5th in Season 1 and
  -- 3rd in Season 2 today; filtering here would silently re-rank both.
  ---------------------------------------------------------------------------
  if not exists (select 1 from fn_season_scope_teams(v_season) where team_id = v_team_lh) then
    raise exception 'CASE 2 (archived team in scope): Lonely hearts was filtered out of a platform scope';
  end if;

  ---------------------------------------------------------------------------
  -- CASE 3 — multi-league include.
  ---------------------------------------------------------------------------
  delete from season_scopes where season_id = v_season;
  insert into season_scopes (season_id, scope_type, scope_ref_id, is_excluded)
  values (v_season, 'league', v_league_d, false),
         (v_season, 'league', v_league_i, false);

  select count(*) into v_n from fn_season_scope_teams(v_season);
  if v_n <> (select count(*) from teams where league_id is not null) then
    raise exception 'CASE 3 (multi-league include): expected % teams, got %',
      (select count(*) from teams where league_id is not null), v_n;
  end if;

  delete from season_scopes where season_id = v_season;
  insert into season_scopes (season_id, scope_type, scope_ref_id, is_excluded)
  values (v_season, 'league', v_league_d, false);
  if exists (select 1 from fn_season_scope_teams(v_season) where team_id = v_team_ts) then
    raise exception 'CASE 3b: Team_Sheba (Independent) leaked into a Deloitte-only league scope';
  end if;
  if not exists (select 1 from fn_season_scope_teams(v_season) where team_id = v_team_dl) then
    raise exception 'CASE 3b: the Deloitte team is missing from its own league scope';
  end if;

  ---------------------------------------------------------------------------
  -- CASE 4 — conference include.
  ---------------------------------------------------------------------------
  delete from season_scopes where season_id = v_season;
  insert into season_scopes (season_id, scope_type, scope_ref_id, is_excluded)
  values (v_season, 'conference', v_conf_d, false);

  if exists (select 1 from fn_season_scope_teams(v_season) where team_id = v_team_ts) then
    raise exception 'CASE 4 (conference include): Team_Sheba leaked into the DELOITTE conference scope';
  end if;
  if not exists (select 1 from fn_season_scope_teams(v_season) where team_id = v_team_dl) then
    raise exception 'CASE 4 (conference include): the Deloitte team is missing from the DELOITTE conference scope';
  end if;

  ---------------------------------------------------------------------------
  -- CASE 5 — D3: exclusion beats include at the TEAM level.
  ---------------------------------------------------------------------------
  delete from season_scopes where season_id = v_season;
  insert into season_scopes (season_id, scope_type, scope_ref_id, is_excluded)
  values (v_season, 'league', v_league_d, false),
         (v_season, 'team',   v_team_dl,  true);
  if exists (select 1 from fn_season_scope_teams(v_season) where team_id = v_team_dl) then
    raise exception 'CASE 5 (D3, team-level exclusion): the excluded team survived its league include';
  end if;

  ---------------------------------------------------------------------------
  -- CASE 6 — D3: exclusion beats include at the CONFERENCE level.
  ---------------------------------------------------------------------------
  delete from season_scopes where season_id = v_season;
  insert into season_scopes (season_id, scope_type, scope_ref_id, is_excluded)
  values (v_season, 'league',     v_league_d, false),
         (v_season, 'conference', v_conf_d,   true);
  select count(*) into v_n from fn_season_scope_teams(v_season);
  if v_n <> 0 then
    raise exception 'CASE 6 (D3, conference-level exclusion): expected 0 teams, got %', v_n;
  end if;

  ---------------------------------------------------------------------------
  -- CASE 7 — D3: exclusion beats include at the LEAGUE level even when the
  -- team is ALSO included directly. "Most specific wins" is NOT the rule.
  ---------------------------------------------------------------------------
  delete from season_scopes where season_id = v_season;
  insert into season_scopes (season_id, scope_type, scope_ref_id, is_excluded)
  values (v_season, 'team',   v_team_dl,  false),
         (v_season, 'league', v_league_d, true);
  if exists (select 1 from fn_season_scope_teams(v_season) where team_id = v_team_dl) then
    raise exception 'CASE 7 (D3, league exclusion beats a direct team include): the team survived';
  end if;

  ---------------------------------------------------------------------------
  -- CASE 8 — D6: the same rule set resolves differently per season for a team
  -- whose conference membership differs between them.
  ---------------------------------------------------------------------------
  delete from season_scopes where season_id in (v_season, v_season2);
  insert into season_scopes (season_id, scope_type, scope_ref_id, is_excluded)
  values (v_season,  'conference', v_conf_g, false),
         (v_season2, 'conference', v_conf_g, false);

  insert into team_conference_memberships (team_id, conference_id, season_id)
  values (v_team_sg, v_conf_g, v_season),    -- season A: S&G is in GENERAL
         (v_team_sg, v_conf_d, v_season2);   -- season B: S&G is in DELOITTE

  if not exists (select 1 from fn_season_scope_teams(v_season) where team_id = v_team_sg) then
    raise exception 'CASE 8 (D6): S&G is missing from the GENERAL scope of the season it belongs to';
  end if;
  if exists (select 1 from fn_season_scope_teams(v_season2) where team_id = v_team_sg) then
    raise exception 'CASE 8 (D6): S&G leaked into the GENERAL scope of a season where it sits in DELOITTE';
  end if;

  -- CASE 8b — fallback: with no membership row for the season, resolution falls
  -- back to teams.conference_id (DELOITTE), NOT to another season's membership.
  delete from team_conference_memberships where team_id = v_team_sg and season_id = v_season;
  if exists (select 1 from fn_season_scope_teams(v_season) where team_id = v_team_sg) then
    raise exception 'CASE 8b (D6 fallback): S&G matched a GENERAL scope though teams.conference_id is DELOITTE';
  end if;

  ---------------------------------------------------------------------------
  -- CASE 9 — D8: the validation trigger. This is the check that would have
  -- caught 6346a188-64e4-483f-a9c7-979627ccbd39 at the source.
  ---------------------------------------------------------------------------
  begin
    insert into season_scopes (season_id, scope_type, scope_ref_id, is_excluded)
    values (v_season, 'league', '6346a188-64e4-483f-a9c7-979627ccbd39', false);
    raise exception 'CASE 9 (D8): a dangling league ref was ACCEPTED';
  exception when check_violation then
    if sqlerrm not like '%6346a188%' or sqlerrm not like '%leagues%' then
      raise exception 'CASE 9 (D8): rejected, but the message names neither the id nor the table: %', sqlerrm;
    end if;
  end;

  -- CASE 9b — archived may be EXCLUDED but never INCLUDED (D8, as narrowed).
  begin
    insert into season_scopes (season_id, scope_type, scope_ref_id, is_excluded)
    values (v_season, 'league', v_league_x, false);
    raise exception 'CASE 9b (D8): an archived league was accepted as an INCLUDE';
  exception when check_violation then
    null;  -- expected
  end;

  delete from season_scopes where season_id = v_season;
  insert into season_scopes (season_id, scope_type, scope_ref_id, is_excluded)
  values (v_season, 'platform', null,      false),
         (v_season, 'team',     v_team_lh, true);   -- archived EXCLUDE: allowed
  if exists (select 1 from fn_season_scope_teams(v_season) where team_id = v_team_lh) then
    raise exception 'CASE 9c: the archived team survived an explicit team-level exclusion';
  end if;

  ---------------------------------------------------------------------------
  -- CASE 10 — D5 / D10, enforced by lo_set_season_scope rather than the table.
  ---------------------------------------------------------------------------
  begin
    perform lo_set_season_scope(v_season,
      format('[{"scope_type":"platform","scope_ref_id":null,"is_excluded":false},
               {"scope_type":"league","scope_ref_id":"%s","is_excluded":false}]', v_league_d)::jsonb,
      'harness', 'D5 negative');
    raise exception 'CASE 10 (D5): platform + league include was ACCEPTED';
  exception when raise_exception then
    if sqlerrm like 'CASE 10 %' then raise; end if;
  end;

  begin
    perform lo_set_season_scope(v_season, '[]'::jsonb, 'harness', '   ');
    raise exception 'CASE 10b (D10): an empty reason was ACCEPTED';
  exception when raise_exception then
    if sqlerrm like 'CASE 10b %' then raise; end if;
  end;

  raise notice 'CC-LO-SEASON-SCOPE-1.0 harness: all cases passed.';
end $$;

rollback;
