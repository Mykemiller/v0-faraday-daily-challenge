-- CC-DC-GAME-REGISTRY-1.0 · Phase 2 — game_id FK columns (D1/D2)
--
-- Every table that identified a game by its DISPLAY NAME now carries a stable
-- uuid FK to game_catalog. Renaming a game no longer orphans its data.
--
-- Scope note: the CC named two tables. Phase 0 found five columns storing display
-- names with no FK; Myke approved covering all of them (Q2). All five backfill
-- 100% — there is not one unresolved row anywhere.
--
--   dc_puzzle_bank_staging.puzzle_type -> game_id            NOT NULL (D1)
--   dc_completions.puzzle_type         -> game_id            nullable (D1)
--   dc_daily_attempts.game_type        -> game_id            nullable
--   dc_solve_time_bands.game_type      -> game_id            nullable  (per-game CONFIG)
--   score_events.game_id (text!)       -> game_catalog_id    nullable
--
-- ⚠️ score_events.game_id is ALREADY TAKEN by a text column that holds a display
-- name despite its id-ish name. The new FK there is game_catalog_id — the one
-- naming inconsistency in this migration, and it is deliberate: renaming the
-- existing column would break its writer (/api/score) mid-flight.
--
-- D2: puzzle_type / game_type are KEPT as denormalised display columns for this
-- release. 268 completions and every existing query read them. They are marked
-- deprecated below; dropping them is a separate cleanup CC.

begin;

-- ── dc_puzzle_bank_staging (D1: NOT NULL once backfilled) ───────────────────
alter table public.dc_puzzle_bank_staging
  add column game_id uuid references public.game_catalog(id);

update public.dc_puzzle_bank_staging s
   set game_id = g.id
  from public.game_catalog g
 where g.display_name = s.puzzle_type
   and s.game_id is null;

alter table public.dc_puzzle_bank_staging alter column game_id set not null;
create index if not exists dc_puzzle_bank_staging_game_id_idx
  on public.dc_puzzle_bank_staging (game_id);

-- ── dc_completions (D1: stays nullable — legacy rows may not resolve) ───────
alter table public.dc_completions
  add column game_id uuid references public.game_catalog(id);

update public.dc_completions c
   set game_id = g.id
  from public.game_catalog g
 where g.display_name = c.puzzle_type
   and c.game_id is null;

create index if not exists dc_completions_game_id_idx
  on public.dc_completions (game_id);

-- ── dc_daily_attempts ───────────────────────────────────────────────────────
alter table public.dc_daily_attempts
  add column game_id uuid references public.game_catalog(id);

update public.dc_daily_attempts a
   set game_id = g.id
  from public.game_catalog g
 where g.display_name = a.game_type
   and a.game_id is null;

create index if not exists dc_daily_attempts_game_id_idx
  on public.dc_daily_attempts (game_id);

-- ── dc_solve_time_bands (per-game config — an 8th game needs a row here) ────
alter table public.dc_solve_time_bands
  add column game_id uuid references public.game_catalog(id);

update public.dc_solve_time_bands b
   set game_id = g.id
  from public.game_catalog g
 where g.display_name = b.game_type
   and b.game_id is null;

create index if not exists dc_solve_time_bands_game_id_idx
  on public.dc_solve_time_bands (game_id);

-- ── score_events (name collision — see header) ──────────────────────────────
alter table public.score_events
  add column game_catalog_id uuid references public.game_catalog(id);

update public.score_events e
   set game_catalog_id = g.id
  from public.game_catalog g
 where g.display_name = e.game_id
   and e.game_catalog_id is null;

create index if not exists score_events_game_catalog_id_idx
  on public.score_events (game_catalog_id);

-- ── D2: deprecation markers ─────────────────────────────────────────────────
comment on column public.dc_puzzle_bank_staging.puzzle_type is
  'DEPRECATED, derived from game_id -> game_catalog.display_name. Kept as a denormalised display column for one release (CC-DC-GAME-REGISTRY-1.0 D2). Join on game_id; do not key new code on this text.';
comment on column public.dc_completions.puzzle_type is
  'DEPRECATED, derived from game_id -> game_catalog.display_name. Kept for one release (D2). Join on game_id.';
comment on column public.dc_daily_attempts.game_type is
  'DEPRECATED, derived from game_id -> game_catalog.display_name. Kept for one release (D2). Join on game_id.';
comment on column public.dc_solve_time_bands.game_type is
  'DEPRECATED, derived from game_id -> game_catalog.display_name. Kept for one release (D2). Join on game_id.';
comment on column public.score_events.game_id is
  'DEPRECATED and MISNAMED: text display name, not an id. The real FK is game_catalog_id. Kept for one release (D2).';

-- ── In-transaction assertions ───────────────────────────────────────────────
do $$
declare n int;
begin
  select count(*) into n from public.dc_puzzle_bank_staging where game_id is null;
  if n <> 0 then raise exception 'AC2 violated: % staging rows unresolved', n; end if;

  select count(*) into n from public.dc_puzzle_bank_staging s
    join public.game_catalog g on g.id = s.game_id
   where g.display_name <> s.puzzle_type;
  if n <> 0 then raise exception '% staging rows resolved to the WRONG game', n; end if;

  select count(*) into n from public.dc_completions where game_id is null;
  if n <> 0 then raise exception 'unexpected: % completions unresolved', n; end if;

  select count(*) into n from public.dc_daily_attempts where game_id is null;
  if n <> 0 then raise exception 'unexpected: % attempts unresolved', n; end if;

  select count(*) into n from public.dc_solve_time_bands where game_id is null;
  if n <> 0 then raise exception 'unexpected: % solve bands unresolved', n; end if;

  select count(*) into n from public.score_events where game_catalog_id is null;
  if n <> 0 then raise exception 'unexpected: % score events unresolved', n; end if;
end $$;

commit;
