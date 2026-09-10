-- CC-LO-MIX-NORMALIZE-1.0 · A theme or difficulty mix that does not total 100%
-- is a BLOCKING error, not a warning.
--
-- What happened (demo season "demo 2", 2026-09-10): the League Office config
-- editor let a 111% difficulty mix and a 140.2% theme mix be saved AND
-- promoted (season_config_validate only WARNED), and the operator found out
-- on the season page when the generation checklist refused to run. A mix is
-- relative by definition, so an off-100 total is never a legitimate
-- configuration — it is an operator mid-edit.
--
-- The app-side fix (same PR) is the real remedy: saveConfigDraft and the
-- copy-from-season path rescale every mix group to exactly 100 before writing,
-- and the editor previews that. This migration is the backstop for any row
-- that reaches the tables by another path (SQL, a future writer): promote()
-- selects `severity = 'error'` from this function, so flipping the severity
-- makes an un-normalized mix un-promotable rather than silently accepted.
--
-- Body is the deployed function verbatim except for the two severities.

begin;

create or replace function public.season_config_validate(p_config_id uuid)
returns table(severity text, code text, message text)
language sql
stable
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
  with cfg as (select * from season_config where id = p_config_id),
  theme as (
    select round(sum(target_pct), 2) as total
    from season_theme_mix
    where season_config_id = p_config_id and not is_excluded
  ),
  diff as (
    select round(sum(target_pct), 2) as total
    from season_difficulty_mix
    where season_config_id = p_config_id and applies_to_game_id is null
  ),
  games as (
    select count(*) filter (where is_enabled) as enabled_count from season_games
    where season_config_id = p_config_id
  )
  select 'error', 'no_games_enabled',
         'No games are enabled for this season.'
  from games where enabled_count = 0
  union all
  select 'error', 'theme_mix_not_100',
         'Theme mix totals ' || coalesce(total, 0) || '% (must be exactly 100%).'
  from theme where total is not null and total <> 100
  union all
  select 'error', 'difficulty_mix_not_100',
         'Difficulty mix totals ' || coalesce(total, 0) || '% (must be exactly 100%).'
  from diff where total is not null and total <> 100
  union all
  select 'error', 'games_per_day_exceeds_slate',
         'games_per_day exceeds the number of enabled games.'
  from cfg, games where cfg.games_per_day is not null and cfg.games_per_day > games.enabled_count
  union all
  select 'error', 'top_n_missing',
         'team_score_method is top_n but team_score_top_n is not set.'
  from cfg where team_score_method = 'top_n' and team_score_top_n is null
  union all
  select 'warning', 'roster_lock_outside_season',
         'roster_lock_on falls outside the season window.'
  from cfg join seasons s on s.id = cfg.season_id
  where cfg.roster_lock_on is not null
    and (cfg.roster_lock_on < s.starts_on or cfg.roster_lock_on > s.ends_on);
$function$;

-- verification gate: the two mix findings must now be errors
do $$
declare
  v_theme text;
  v_diff text;
begin
  select substring(pg_get_functiondef('public.season_config_validate(uuid)'::regprocedure)
                   from '''(error|warning)'', ''theme_mix_not_100''')
    into v_theme;
  select substring(pg_get_functiondef('public.season_config_validate(uuid)'::regprocedure)
                   from '''(error|warning)'', ''difficulty_mix_not_100''')
    into v_diff;
  if v_theme is distinct from 'error' or v_diff is distinct from 'error' then
    raise exception 'season_config_validate: mix totals are not blocking errors (theme=%, difficulty=%)', v_theme, v_diff;
  end if;
end $$;

commit;

-- Rollback: re-run the CREATE OR REPLACE above with the two severities set back
-- to 'warning' and the messages to '(expected 100%).'.
