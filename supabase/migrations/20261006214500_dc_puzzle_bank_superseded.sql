-- CC-LO-REGENERATE-FROM-DATE-1.0 — the archive that makes "regenerate a season
-- from a date" survivable.
--
-- WHY THIS EXISTS
-- `season.regenerate_from` deletes APPROVED production content: the season's
-- `dc_puzzle_bank_staging` rows from a future cutoff date onward, and the
-- `dc_daily_theme` rows for the same range, so a normal full run can rebuild
-- them under the current configuration. A delete with no archive would make the
-- commissioner's only undo "generate it again, differently" — the exact puzzles
-- that were reviewed and approved would be gone. These two tables hold the
-- removed rows verbatim so `season.restore_superseded` can put them back,
-- Public IDs and approval columns included.
--
-- SECURITY
-- The archived staging rows carry `answer_key`, `hint_1..3` and
-- `answer_explanation`. They are therefore treated exactly like
-- `dc_puzzle_bank_staging`: RLS ENABLED with ZERO policies (deny-all), so only
-- the service role — which bypasses RLS — can read or write them. `anon` and
-- `authenticated` are revoked BY NAME as well, so a future permissive GRANT on
-- the schema cannot quietly open them.
--
-- APPLY ORDER: this migration FIRST, then deploy the app. The app's
-- `season.regenerate_from` refuses to execute if these tables are missing
-- (the archive insert fails and it aborts BEFORE deleting anything), so the
-- reverse order is safe but useless.
--
-- ROLLBACK
--   begin;
--     drop table if exists public.dc_daily_theme_superseded;
--     drop table if exists public.dc_puzzle_bank_superseded;
--   commit;
-- Dropping these DESTROYS every archived puzzle that has not been restored.
-- Check `select count(*) from public.dc_puzzle_bank_superseded;` first; if it is
-- non-zero, restore or export before dropping.

begin;

-- ── the puzzle archive ──────────────────────────────────────────────────────
-- `LIKE` (no INCLUDING clauses) copies the column names, types and NOT NULL
-- flags of the live staging table and nothing else — no defaults, no CHECKs, no
-- unique indexes, no foreign keys, no triggers. That is deliberate:
--   • no `dc_staging_season_type_date_uniq`, because the same (season, type,
--     date) slot may legitimately be archived more than once across successive
--     regenerations;
--   • no `dc_staging_public_id_uniq`, for the same reason;
--   • no `dc_staging_theme_fk`, because the theme row is archived too and the
--     live parent is deleted in the same operation;
--   • no `dc_assign_public_id` trigger, because an archive must store the
--     Public ID the row HAD, never mint a new one.
create table if not exists public.dc_puzzle_bank_superseded (
  like public.dc_puzzle_bank_staging
);

alter table public.dc_puzzle_bank_superseded
  add column if not exists superseded_at     timestamptz not null default now(),
  add column if not exists superseded_reason text,
  add column if not exists superseded_by     text,
  add column if not exists audit_id          uuid;

comment on table public.dc_puzzle_bank_superseded is
  'CC-LO-REGENERATE-FROM-DATE-1.0 — puzzles removed by season.regenerate_from, verbatim. Service-role only (RLS on, zero policies): rows carry answer_key and hints. season.restore_superseded reads it.';
comment on column public.dc_puzzle_bank_superseded.superseded_at is
  'One timestamp per regenerate_from operation — the batch key the archive/verify/delete sequence and the audit_id backfill both filter on.';
comment on column public.dc_puzzle_bank_superseded.superseded_reason is
  'The mandatory Tier 2 reason, copied from the lo_audit_log row.';
comment on column public.dc_puzzle_bank_superseded.superseded_by is
  'Staff email that executed the action.';
comment on column public.dc_puzzle_bank_superseded.audit_id is
  'lo_audit_log.id of the season.regenerate_from row. Nullable: the rows are archived BEFORE the audit row is written, then stamped.';

-- (id, superseded_at) rather than (id): a slot archived, restored and archived
-- again is the same original row id twice, and that is a legitimate history.
alter table public.dc_puzzle_bank_superseded
  drop constraint if exists dc_puzzle_bank_superseded_pkey;
alter table public.dc_puzzle_bank_superseded
  add constraint dc_puzzle_bank_superseded_pkey primary key (id, superseded_at);

create index if not exists dc_puzzle_bank_superseded_season_date_idx
  on public.dc_puzzle_bank_superseded (season_id, go_live_date);
create index if not exists dc_puzzle_bank_superseded_batch_idx
  on public.dc_puzzle_bank_superseded (superseded_at);

-- ── the theme archive ───────────────────────────────────────────────────────
create table if not exists public.dc_daily_theme_superseded (
  like public.dc_daily_theme
);

alter table public.dc_daily_theme_superseded
  add column if not exists superseded_at     timestamptz not null default now(),
  add column if not exists superseded_reason text,
  add column if not exists superseded_by     text,
  add column if not exists audit_id          uuid;

comment on table public.dc_daily_theme_superseded is
  'CC-LO-REGENERATE-FROM-DATE-1.0 — season theme days removed by season.regenerate_from, verbatim. Service-role only. Restored BEFORE the puzzle rows, because dc_staging_theme_fk points (season_id, theme_date) at dc_daily_theme.';

alter table public.dc_daily_theme_superseded
  drop constraint if exists dc_daily_theme_superseded_pkey;
alter table public.dc_daily_theme_superseded
  add constraint dc_daily_theme_superseded_pkey primary key (id, superseded_at);

create index if not exists dc_daily_theme_superseded_season_date_idx
  on public.dc_daily_theme_superseded (season_id, theme_date);
create index if not exists dc_daily_theme_superseded_batch_idx
  on public.dc_daily_theme_superseded (superseded_at);

-- ── deny-all ────────────────────────────────────────────────────────────────
-- RLS on + ZERO policies = nothing but the service role (which bypasses RLS)
-- can see a single row. The explicit REVOKEs are belt and braces: they survive
-- a future `grant select on all tables in schema public` because that grant
-- would have to name these tables again.
alter table public.dc_puzzle_bank_superseded enable row level security;
alter table public.dc_daily_theme_superseded enable row level security;

-- Measured 2026-10-06: pg_default_acl grants anon, authenticated AND
-- service_role every privilege on a newly created table in `public`. So the
-- revoke below is not theoretical tidiness — without it these two tables ship
-- readable by `authenticated` through PostgREST, and RLS-with-no-policies would
-- be the only thing standing between a logged-in player and every answer key.
revoke all on public.dc_puzzle_bank_superseded from anon;
revoke all on public.dc_puzzle_bank_superseded from authenticated;
revoke all on public.dc_daily_theme_superseded from anon;
revoke all on public.dc_daily_theme_superseded from authenticated;

-- ...and the one role that MUST keep them, stated rather than inherited.
grant select, insert, update, delete on public.dc_puzzle_bank_superseded to service_role;
grant select, insert, update, delete on public.dc_daily_theme_superseded to service_role;

-- ── verification gate ───────────────────────────────────────────────────────
-- The migration refuses to commit unless every property the feature depends on
-- is true. A silently half-applied archive is how approved puzzles get deleted
-- with nowhere to land.
do $$
declare
  v_missing text;
  v_policies int;
  v_rls boolean;
  v_grants int;
  v_cols int;
  t text;
begin
  -- 1. every live column exists in its archive, with the same type.
  --    dc_puzzle_bank_STAGING archives into dc_puzzle_bank_SUPERSEDED, so the
  --    archive name is the live name with '_staging' stripped first.
  select string_agg(format('%s.%s (%s)', c.table_name, c.column_name, c.data_type), ', ')
    into v_missing
    from information_schema.columns c
   where c.table_schema = 'public'
     and c.table_name in ('dc_puzzle_bank_staging', 'dc_daily_theme')
     and not exists (
       select 1 from information_schema.columns a
        where a.table_schema = 'public'
          and a.table_name = replace(c.table_name, '_staging', '') || '_superseded'
          and a.column_name = c.column_name
          and a.data_type = c.data_type
     );
  if v_missing is not null then
    raise exception 'archive column drift: %', v_missing;
  end if;

  -- 2. the four bookkeeping columns exist on both archives.
  foreach t in array array['dc_puzzle_bank_superseded', 'dc_daily_theme_superseded'] loop
    select count(*) into v_cols
      from information_schema.columns
     where table_schema = 'public' and table_name = t
       and column_name in ('superseded_at', 'superseded_reason', 'superseded_by', 'audit_id');
    if v_cols <> 4 then
      raise exception '% is missing one of the four bookkeeping columns (found %)', t, v_cols;
    end if;

    -- 3. RLS enabled.
    select relrowsecurity into v_rls from pg_class where oid = ('public.' || t)::regclass;
    if not coalesce(v_rls, false) then
      raise exception 'RLS is not enabled on %', t;
    end if;

    -- 4. ZERO policies — deny-all is the policy.
    select count(*) into v_policies from pg_policies
     where schemaname = 'public' and tablename = t;
    if v_policies <> 0 then
      raise exception '% has % policy/policies; it must have none (deny-all)', t, v_policies;
    end if;

    -- 5. anon and authenticated hold no privilege on it.
    select count(*) into v_grants from information_schema.role_table_grants
     where table_schema = 'public' and table_name = t
       and grantee in ('anon', 'authenticated');
    if v_grants <> 0 then
      raise exception '% still grants % privilege(s) to anon/authenticated', t, v_grants;
    end if;

    -- 6. ...and service_role, which is the only writer, still holds all four.
    select count(*) into v_grants from information_schema.role_table_grants
     where table_schema = 'public' and table_name = t
       and grantee = 'service_role'
       and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE');
    if v_grants <> 4 then
      raise exception '% grants service_role only % of SELECT/INSERT/UPDATE/DELETE', t, v_grants;
    end if;
  end loop;

  raise notice 'dc_puzzle_bank_superseded + dc_daily_theme_superseded verified: deny-all, four bookkeeping columns, no column drift.';
end
$$;

commit;
