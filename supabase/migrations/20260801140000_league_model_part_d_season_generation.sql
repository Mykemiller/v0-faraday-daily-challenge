-- CC-FARADAY-LEAGUE-1.0 Part D — season builder + generate-on-approval schema.
--
-- DEC-1: themes become season-scoped. The 500 existing dc_daily_theme rows are the
-- reusable CORPUS and keep season_id NULL — never served directly, never deleted.
-- DEC-2: season_games.puzzle_count (NULL = one per game per day, derived).
-- DEC-3: run 34dd26f6 (the global calendar-wide model) is superseded, never resumed.
--
-- FK restructure (approved via the Part D Phase 0 report): acceptance 5 (two
-- overlapping seasons each holding theme rows for the same date) is impossible
-- under the old global UNIQUE(theme_date), so that constraint and the simple FK
-- that depended on it are replaced by:
--   • a FULL unique index (season_id, theme_date) — the composite FK's target;
--     NULLS DISTINCT means it does not constrain corpus rows,
--   • a PARTIAL unique on theme_date WHERE season_id IS NULL — preserving the
--     corpus one-row-per-date invariant the old constraint provided,
--   • the composite FK (season_id, theme_date) MATCH SIMPLE — generated rows
--     (season_id set) are enforced; the 98 season-less import rows skip the
--     check (their theme link was validated at import and is documented as
--     no longer FK-enforced).

-- 1) dc_daily_theme gains season_id (corpus rows stay NULL)
alter table public.dc_daily_theme
  add column season_id uuid references public.seasons(id);
comment on column public.dc_daily_theme.season_id is
  'NULL = reusable corpus row (never served). Set = theme row generated for one season (Part D).';

-- 2) uniqueness restructure
create unique index dc_daily_theme_season_date_key
  on public.dc_daily_theme (season_id, theme_date);
create unique index dc_daily_theme_corpus_date_uniq
  on public.dc_daily_theme (theme_date) where season_id is null;

alter table public.dc_puzzle_bank_staging
  drop constraint dc_puzzle_bank_staging_theme_date_fkey;
alter table public.dc_daily_theme
  drop constraint dc_daily_theme_theme_date_key;

alter table public.dc_puzzle_bank_staging
  add constraint dc_staging_theme_fk
  foreign key (season_id, theme_date)
  references public.dc_daily_theme (season_id, theme_date);

-- 3) generation-run columns (worker contract: resumable, heartbeat, honest counters)
alter table public.dc_puzzle_generation_runs
  add column season_id uuid references public.seasons(id),
  add column run_kind text not null default 'full'
    constraint dc_gen_runs_kind_ck check (run_kind in ('pilot','full')),
  add column superseded_at timestamptz,
  add column last_heartbeat_at timestamptz,
  add column phase_cursor jsonb not null default '{}'::jsonb;

create index dc_gen_runs_season_idx on public.dc_puzzle_generation_runs (season_id);
create index dc_gen_runs_inflight_idx on public.dc_puzzle_generation_runs (status)
  where completed_at is null and superseded_at is null;

update public.dc_puzzle_generation_runs
   set superseded_at = now()
 where id = '34dd26f6-9fe7-40be-bfcd-7a733031e2e5';

-- 4) season gates (DEC-5: pilot before full; generated_at gates Lock Season)
alter table public.seasons
  add column pilot_approved_at timestamptz,
  add column generated_at timestamptz;

-- 5) DEC-2 home: per-game puzzle count on the live season_games slate table.
--    NULL = default (one puzzle per day, ends_on - starts_on + 1); validation
--    enforces override-upward-only against the season's day count.
alter table public.season_games
  add column puzzle_count integer
    constraint season_games_puzzle_count_ck check (puzzle_count > 0);
comment on column public.season_games.puzzle_count is
  'Part D DEC-2: puzzles to generate for this game. NULL = season day count. May only exceed the day count (selection surplus), never undercut it — enforced by the generation validator.';

-- 6) locked seasons reject config mutation AT THE DB LEVEL (Part D guardrail).
--    One deliberate exemption: UPDATEs that touch ONLY the state-machine
--    bookkeeping columns (state, effective_from, effective_to, applied_at) still
--    pass, so season_config_promote / _apply_due / _cancel keep working on a
--    locked season. Content edits, INSERTs (clone), DELETEs, and every child-row
--    write are refused.
create or replace function public.fn_season_config_locked_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_season uuid := coalesce(new.season_id, old.season_id);
  v_locked timestamptz;
  bookkeeping constant text[] := array['state','effective_from','effective_to','applied_at'];
begin
  select locked_at into v_locked from seasons where id = v_season;
  if v_locked is null then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE'
     and (to_jsonb(new) - bookkeeping) is not distinct from (to_jsonb(old) - bookkeeping) then
    return new;
  end if;
  raise exception 'season % is locked — configuration is frozen', v_season
    using errcode = '55P03';
end;
$$;

create trigger trg_season_config_locked_guard
  before insert or update or delete on public.season_config
  for each row execute function public.fn_season_config_locked_guard();

create or replace function public.fn_season_config_child_locked_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_config uuid := coalesce(new.season_config_id, old.season_config_id);
  v_locked timestamptz;
begin
  select s.locked_at into v_locked
  from season_config sc join seasons s on s.id = sc.season_id
  where sc.id = v_config;
  if v_locked is not null then
    raise exception 'season config % belongs to a locked season — slate/mix edits are frozen', v_config
      using errcode = '55P03';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger trg_season_games_locked_guard
  before insert or update or delete on public.season_games
  for each row execute function public.fn_season_config_child_locked_guard();
create trigger trg_season_difficulty_mix_locked_guard
  before insert or update or delete on public.season_difficulty_mix
  for each row execute function public.fn_season_config_child_locked_guard();
create trigger trg_season_theme_mix_locked_guard
  before insert or update or delete on public.season_theme_mix
  for each row execute function public.fn_season_config_child_locked_guard();

-- 7) verification gates — raise (rolling the migration back) on unexpected state
do $$
declare n int;
begin
  select count(*) into n from public.dc_daily_theme where season_id is not null;
  if n <> 0 then raise exception 'gate: expected 0 season-scoped theme rows, got %', n; end if;

  select count(*) into n from public.dc_daily_theme;
  if n <> 500 then raise exception 'gate: expected 500 corpus theme rows, got %', n; end if;

  select count(*) into n from public.dc_puzzle_bank_staging;
  if n <> 105 then raise exception 'gate: expected 105 staging rows, got %', n; end if;

  select count(*) into n from public.dc_puzzle_generation_runs
   where superseded_at is not null;
  if n <> 1 then raise exception 'gate: expected exactly 1 superseded run, got %', n; end if;

  select count(*) into n from public.seasons;
  if n <> 5 then raise exception 'gate: expected 5 seasons, got %', n; end if;
end $$;
