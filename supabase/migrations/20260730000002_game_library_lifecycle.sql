-- CC-LO-GAME-LIBRARY-1.0 · Phase 1 — game lifecycle + runtime-key bridge
--
-- EXTENDS game_catalog. Does NOT create a parallel games table, does NOT rename
-- game_key or display_name, does NOT touch RLS (D10), does NOT change serving.
--
-- The load-bearing fact this migration makes explicit: the runtime keys games by
-- the free-text DISPLAY NAME ("Signal Drop"), while game_catalog.game_key is a
-- snake_case slug ("signal_drop") that NOTHING joins on. `runtime_key` names that
-- join so it is testable instead of implicit (D3). It is a MIRROR of the string
-- the serving path already uses — writing it changes no serving behaviour (D4).
--
-- Additive and reversible: one new enum, five new columns (all defaulted or
-- nullable), one partial unique index, one CHECK, one trigger, one index.

begin;

-- ── D1/D2: lifecycle is ONE state per game ───────────────────────────────────
-- "Assigned to a Season" is deliberately NOT a state here. Assignment is
-- many-to-many and lives in season_games; all 7 live games are simultaneously
-- Live *and* assigned to 4 seasons, which a single-state model cannot express.
create type game_lifecycle_state as enum ('new_idea', 'in_test', 'live', 'retired');

-- is_active / is_beta are deliberately KEPT (D2). Dropping columns is out of
-- scope and other code may read them.
alter table game_catalog
  add column lifecycle_state  game_lifecycle_state not null default 'new_idea',
  add column runtime_key      text,
  add column public_id_prefix text,
  add column idea_source      text,
  add column notes            text;

comment on column game_catalog.lifecycle_state is
  'Lifecycle: new_idea → in_test → live → retired. NOT season assignment — that is season_games (D1).';
comment on column game_catalog.runtime_key is
  'EXACT free-text string the serving path keys on (dc_completions.puzzle_type, dc_daily_attempts.game_type, dc_solve_time_bands.game_type, dc_puzzle_bank_staging.puzzle_type). Frozen once live (D3).';
comment on column game_catalog.public_id_prefix is
  'Public puzzle-ID prefix as minted by trg_dc_assign_public_id. A SEPARATE system from short_code — never derive one from the other (D8).';

-- ── Backfill the 7 existing games ────────────────────────────────────────────
-- runtime_key = the CURRENT display_name, which is exactly what the runtime
-- already stores. Matched on game_key (the stable slug), never on display_name.
update game_catalog set
  lifecycle_state = 'live',
  runtime_key     = display_name,
  public_id_prefix = case game_key
    when 'rackl'       then 'RACK'
    when 'signal_drop' then 'SGNL'
    when 'the_stack'   then 'STAK'
    when 'circuit'     then 'CIRC'
    when 'dark_fiber'  then 'FIBR'
    when 'frequency'   then 'FREQ'
    when 'the_brief'   then 'BRIF'
  end
where game_key in
  ('rackl','signal_drop','the_stack','circuit','dark_fiber','frequency','the_brief');

-- Fail loudly if the catalog was not what Phase 0 verified, BEFORE the
-- constraints below turn a surprise into a confusing constraint violation.
do $$
declare n int;
begin
  select count(*) into n from game_catalog
   where lifecycle_state = 'live' and runtime_key is not null and public_id_prefix is not null;
  if n <> 7 then
    raise exception 'Expected exactly 7 backfilled live games, found %. Aborting.', n;
  end if;
end $$;

-- ── D3: runtime_key is the join key — it must be unique and present for live ──
create unique index game_catalog_runtime_key_uq
  on game_catalog (runtime_key) where runtime_key is not null;

alter table game_catalog add constraint game_catalog_live_needs_runtime_key
  check (lifecycle_state <> 'live' or runtime_key is not null);

-- ── D9: a game may only be ASSIGNED to a season when live or in_test ─────────
-- Enforced in the database, not just the UI: a new_idea has no puzzle bank, so
-- scheduling one would promise a game that cannot be served.
--
-- Fires on INSERT, and on UPDATE only when game_id actually changes. Retiring a
-- game therefore does not brick edits to its EXISTING assignment rows (e.g.
-- toggling is_enabled); it only blocks assigning it somewhere new. Note the
-- shipped saveConfigBundle() replaces a config's whole slate by DELETE + INSERT,
-- so re-saving a slate that still contains a retired game will raise here — the
-- Phase 4 retire transition refuses while live assignments exist, and tells
-- staff to unassign first.
create or replace function fn_season_games_assignable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare st game_lifecycle_state;
begin
  select lifecycle_state into st from game_catalog where id = new.game_id;
  if st is null then
    raise exception 'Game % is not in the catalog.', new.game_id
      using errcode = '23503';
  end if;
  if st not in ('live', 'in_test') then
    raise exception
      'Game % cannot be assigned to a season while its lifecycle state is %. Only live or in_test games may be scheduled.',
      new.game_id, st
      using errcode = '23514';
  end if;
  return new;
end $$;

create trigger trg_season_games_assignable
  before insert or update of game_id on season_games
  for each row execute function fn_season_games_assignable();

-- ── Read-path index for the season matrix + per-season slate ────────────────
create index if not exists season_games_config_enabled_idx
  on season_games (season_config_id, is_enabled);

-- ── Verification gate: the catalog and every assignment must be UNTOUCHED ────
do $$
declare g int; sg int;
begin
  select count(*) into g  from game_catalog;
  select count(*) into sg from season_games;
  if g <> 7 or sg <> 28 then
    raise exception
      'VERIFICATION FAILED — expected game_catalog=7 and season_games=28, got % and %. Rolling back.', g, sg;
  end if;
end $$;

commit;
