-- CC-LEAGUE-MODEL-1.0 Part B (phase 2 of 2) — drop the retired hierarchy
-- columns. ⚠️ Apply ONLY after this PR's Vercel production deploy is live:
-- the pre-Part-B app selects these columns (teamCols in league-office/data.ts,
-- the team leaderboard route, /api/teams create) and would 500 against this.
-- Phase 1 (20260801000002) already made the new code work with the columns
-- still present (group_type has a default, season/parent_id are nullable),
-- so the safe order is: apply phase 1 → deploy app + edge fns → apply this.

drop trigger trg_enforce_group_hierarchy on public.teams;
drop function public.enforce_group_hierarchy();

alter table public.teams drop column season;
alter table public.teams drop column group_type;
alter table public.teams drop column parent_id;
-- The group_type ENUM TYPE is kept: team_create's p_group_type parameter still
-- uses it for wire compatibility (value is ignored).

do $$
declare v_teams int; v_cols int;
begin
  select count(*) into v_teams from public.teams;
  select count(*) into v_cols from information_schema.columns
   where table_schema='public' and table_name='teams'
     and column_name in ('season','group_type','parent_id');
  if v_teams <> 6 or v_cols <> 0 then
    raise exception 'Part B phase-2 gate failed: teams=% legacy_cols=%', v_teams, v_cols;
  end if;
end $$;
