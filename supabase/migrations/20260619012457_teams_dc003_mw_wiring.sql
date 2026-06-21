-- Wire the per-player completion system (DC-003: dc_subscribers/dc_completions)
-- to the dormant teams_v1 leaderboard. When a player records a puzzle
-- completion, route the MW they earned into their CURRENT team's totals so
-- public.team_leaderboard() reflects real per-player results.
--
-- Join key is email: dc_completions.subscriber_id -> dc_subscribers.email ->
-- team_members.member_email (citext, unique => one team per email). MW only
-- accrues to a team for completions made while the player is a member; it is
-- never retroactively backfilled on join. The dc_completions unique index on
-- (subscriber_id, puzzle_type, puzzle_date) guarantees one completion per
-- puzzle/day, so this fires at most once per puzzle and cannot double-count.
--
-- Deployed to Supabase project ycadmmngkdhvpcsrcuaq (Faraday).

create or replace function public.dc_completion_to_team_mw()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email   public.dc_subscribers.email%type;
  v_team_id uuid;
begin
  if coalesce(new.mw_earned, 0) = 0 then
    return new;
  end if;

  select email into v_email
  from public.dc_subscribers
  where id = new.subscriber_id;

  if v_email is null then
    return new;
  end if;

  -- At most one membership (member_email is unique). Bump the member's
  -- personal contribution and capture their team.
  update public.team_members
     set my_mw = coalesce(my_mw, 0) + new.mw_earned
   where member_email = v_email
  returning team_id into v_team_id;

  if v_team_id is not null then
    update public.teams
       set mw_total = coalesce(mw_total, 0) + new.mw_earned
     where id = v_team_id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_dc_completion_to_team_mw on public.dc_completions;
create trigger trg_dc_completion_to_team_mw
after insert on public.dc_completions
for each row execute function public.dc_completion_to_team_mw();
