-- Already applied to prod 2026-09-05; committed for the record (schema drift fix). Idempotent.
-- Recorded verbatim from supabase_migrations.schema_migrations where version='20260905163139'
-- (project ycadmmngkdhvpcsrcuaq). Do NOT re-run by hand.

-- 0293_puzzle_difficulty_vocabulary_reconciliation.sql
-- CC-PUZZLE-DIFFICULTY-VOCAB-1.0 — Phase 1 of wiring the League Office
-- configurator to a real configuration engine. See
-- docs/puzzle/DIFFICULTY-VOCABULARY-RECONCILIATION.md
--
-- Canonical vocabulary = foundational / practitioner / expert.
-- Scope: puzzle + season config lane ONLY. Zero reads or writes against
-- jurisdictions, jpas_*, jps_*, jw_score_history, dc_facilities.

create table if not exists puzzle_difficulty_band (
  band          text primary key,
  ordinal       integer not null unique,
  display_name  text    not null,
  description   text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

comment on table puzzle_difficulty_band is
  'Canonical puzzle difficulty vocabulary. Single source of truth shared by the '
  'League Office configurator (season_difficulty_mix, season_games) and the '
  'puzzle generator (dc_puzzle_bank_staging). CC-PUZZLE-DIFFICULTY-VOCAB-1.0.';

insert into puzzle_difficulty_band (band, ordinal, display_name, description) values
  ('foundational', 10, 'Foundational',
   'Entry-level. Answerable from general data-center literacy.'),
  ('practitioner', 20, 'Practitioner',
   'Working-professional level. Assumes day-to-day domain familiarity.'),
  ('expert',       30, 'Expert',
   'Specialist level. Assumes deep subject-matter depth.')
on conflict (band) do nothing;

create table if not exists puzzle_difficulty_alias (
  alias         text primary key,
  band          text not null references puzzle_difficulty_band(band),
  note          text,
  created_at    timestamptz not null default now()
);

comment on table puzzle_difficulty_alias is
  'Crosswalk from legacy/generator difficulty strings to the canonical band. '
  'Edit rows to retune; puzzle_difficulty_canonical() reads this at call time.';

insert into puzzle_difficulty_alias (alias, band, note)
select band, band, 'identity' from puzzle_difficulty_band
on conflict (alias) do nothing;

insert into puzzle_difficulty_alias (alias, band, note) values
  ('easy',   'foundational', 'legacy generator scale (CC-PUZZLE-DIFFICULTY-VOCAB-1.0)'),
  ('medium', 'practitioner', 'legacy generator scale (CC-PUZZLE-DIFFICULTY-VOCAB-1.0)'),
  ('hard',   'expert',       'legacy generator scale; hard->expert pending ratification')
on conflict (alias) do nothing;

create or replace function puzzle_difficulty_canonical(p_value text)
returns text
language plpgsql
stable
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_band text;
  v_key  text := lower(btrim(coalesce(p_value, '')));
begin
  if v_key = '' then
    return null;
  end if;

  select a.band into v_band
  from puzzle_difficulty_alias a
  where a.alias = v_key;

  if v_band is null then
    raise exception
      'puzzle_difficulty_canonical: unknown difficulty %. Add a row to '
      'puzzle_difficulty_alias to map it.', p_value
      using errcode = 'check_violation';
  end if;

  return v_band;
end;
$fn$;

revoke execute on function puzzle_difficulty_canonical(text) from public, anon, authenticated;

alter table dc_puzzle_bank_staging
  add column if not exists difficulty_raw text;

comment on column dc_puzzle_bank_staging.difficulty_raw is
  'The difficulty string exactly as written by the generator, retained for '
  'audit. dc_puzzle_bank_staging.difficulty carries the canonical band.';

update dc_puzzle_bank_staging
   set difficulty_raw = difficulty
 where difficulty is not null
   and difficulty_raw is null;

update dc_puzzle_bank_staging p
   set difficulty = a.band
  from puzzle_difficulty_alias a
 where a.alias = lower(btrim(p.difficulty))
   and p.difficulty is not null
   and p.difficulty <> a.band;

alter table dc_puzzle_bank_staging
  drop constraint if exists dc_puzzle_bank_staging_difficulty_canon;
alter table dc_puzzle_bank_staging
  add constraint dc_puzzle_bank_staging_difficulty_canon
  check (difficulty is null or difficulty in ('foundational','practitioner','expert'));

alter table season_difficulty_mix
  drop constraint if exists season_difficulty_mix_band_canon;
alter table season_difficulty_mix
  add constraint season_difficulty_mix_band_canon
  check (difficulty_band in ('foundational','practitioner','expert'));

alter table season_games
  drop constraint if exists season_games_difficulty_floor_canon;
alter table season_games
  add constraint season_games_difficulty_floor_canon
  check (difficulty_floor is null or difficulty_floor in ('foundational','practitioner','expert'));

alter table season_games
  drop constraint if exists season_games_difficulty_ceiling_canon;
alter table season_games
  add constraint season_games_difficulty_ceiling_canon
  check (difficulty_ceiling is null or difficulty_ceiling in ('foundational','practitioner','expert'));

alter table puzzle_difficulty_band  enable row level security;
alter table puzzle_difficulty_alias enable row level security;

drop policy if exists puzzle_difficulty_band_service on puzzle_difficulty_band;
create policy puzzle_difficulty_band_service on puzzle_difficulty_band
  for all to service_role using (true) with check (true);

drop policy if exists puzzle_difficulty_alias_service on puzzle_difficulty_alias;
create policy puzzle_difficulty_alias_service on puzzle_difficulty_alias
  for all to service_role using (true) with check (true);

revoke all on puzzle_difficulty_band  from anon, authenticated;
revoke all on puzzle_difficulty_alias from anon, authenticated;

do $assert$
declare
  v_bad      integer;
  v_unmapped integer;
  v_raw_lost integer;
begin
  select count(*) into v_bad
  from dc_puzzle_bank_staging
  where difficulty is not null
    and difficulty not in ('foundational','practitioner','expert');
  if v_bad > 0 then
    raise exception 'Assertion failed: % staging rows still non-canonical', v_bad;
  end if;

  select count(*) into v_unmapped
  from dc_puzzle_bank_staging p
  where p.difficulty_raw is not null
    and not exists (select 1 from puzzle_difficulty_alias a
                    where a.alias = lower(btrim(p.difficulty_raw)));
  if v_unmapped > 0 then
    raise exception 'Assertion failed: % rows have an unmapped difficulty_raw', v_unmapped;
  end if;

  select count(*) into v_raw_lost
  from dc_puzzle_bank_staging
  where difficulty is not null and difficulty_raw is null;
  if v_raw_lost > 0 then
    raise exception 'Assertion failed: % rows lost their raw difficulty', v_raw_lost;
  end if;
end;
$assert$;
