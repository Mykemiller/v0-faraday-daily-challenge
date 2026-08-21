-- CC-DC-GAME-REGISTRY-1.0 · Phase 4 follow-on — two behaviour flags
--
-- Found while de-hardcoding DailyChallenge.jsx. Both encode a real product
-- decision that was previously expressed as a game name in a conditional.
--
-- name_is_answer — Signal Drop's puzzle.name IS the answer word
--   ("SOVEREIGNTY"), so it must never render in-game. Every other game uses a
--   descriptive name that is safe to show.
--   ⚠️ DEFAULT true — FAIL CLOSED. A new game that nobody has configured yet
--   hides its name rather than risking a leaked answer. Being briefly less
--   informative is recoverable; spoiling the answer is not.
--
-- is_hero_cta — which game the lobby's front-door "start" button launches.
--   Was hardcoded to Circuit. Readers fall back to the first game in lobby
--   order when no row (or more than one) is flagged.

begin;

alter table public.game_catalog
  add column name_is_answer boolean not null default true,
  add column is_hero_cta    boolean not null default false;

comment on column public.game_catalog.name_is_answer is
  'True when puzzle.name reveals the solution and must not render in-game. Defaults TRUE (fail closed) so an unconfigured game cannot leak its answer.';
comment on column public.game_catalog.is_hero_cta is
  'The game the lobby hero button launches. Readers fall back to the first game in lobby order if this is not set on exactly one row.';

-- Seed today's behaviour exactly: only Signal Drop hides its name; the hero CTA
-- stays on Circuit.
update public.game_catalog set name_is_answer = (game_key = 'signal_drop')
 where lifecycle_state = 'live';
update public.game_catalog set is_hero_cta = (game_key = 'circuit')
 where lifecycle_state = 'live';

do $$
declare n int;
begin
  select count(*) into n from public.game_catalog
   where lifecycle_state='live' and name_is_answer;
  if n <> 1 then raise exception 'expected exactly 1 name_is_answer game, found %', n; end if;

  select count(*) into n from public.game_catalog
   where lifecycle_state='live' and is_hero_cta;
  if n <> 1 then raise exception 'expected exactly 1 hero CTA game, found %', n; end if;
end $$;

commit;
