-- CC-DC-SUPABASE-SERVING-1.0 · Phase 1 — serve the Daily Challenge from
-- dc_puzzle_bank_staging.
--
-- Adds to the FAR-287 staging table everything the serving path needs so the
-- Airtable Puzzle Bank can be retired: the share-facing Public ID (minted on
-- publish, never on draft), the human approval gate (Draft → Published only via
-- fn_dc_approve_puzzles), and the transactional rotator fn_dc_rotate_live_set
-- (AUTO-128 semantics, promote + retire in ONE transaction — the Airtable
-- rotator's partial-failure mode, which RotationError(step, recordIds) existed
-- to diagnose, ceases to exist here).
--
-- ADDITIVE + reversible. RLS posture unchanged: deny-all, service-role only —
-- no anon policy is added by this migration (D5). Rollback:
--   drop trigger trg_dc_assign_public_id on public.dc_puzzle_bank_staging;
--   drop function public.dc_assign_public_id(), public.fn_dc_rotate_live_set(date),
--     public.fn_dc_approve_puzzles(date[], text);
--   alter table public.dc_puzzle_bank_staging
--     drop constraint dc_staging_public_id_uniq,
--     drop constraint dc_staging_import_or_complete,
--     drop column public_id, drop column approved_by, drop column approved_at,
--     alter column theme_date set not null, alter column hint_1 set not null,
--     alter column hint_2 set not null, alter column hint_3 set not null,
--     alter column answer_key set not null;
--   drop index dc_staging_published_gld_idx, dc_staging_airtable_record_uniq;
--   drop sequence public.dc_public_id_seq;

-- ── 1) Public ID sequence ─────────────────────────────────────────────────────
-- Format TYPE4-YY-MM-DD-NNNNN with a GLOBAL counter across all 7 types (D2 —
-- verified live: RACK-26-07-28-00337 … FREQ-26-07-28-00343 are consecutive
-- across one day's set). Seeded ABOVE the Airtable bank's current max numeric
-- suffix so backfilled historical ids can never collide with newly minted ones.
-- Measured 2026-07-29 across all 373 bank rows (364 carry a Public ID): max
-- suffix = 00364 → start at 365. If Airtable mints more ids before cutover,
-- re-seed with: select setval('public.dc_public_id_seq', <new_max>, true);
-- (the Phase-4 backfill dry-run re-reports the live max so drift is visible).
create sequence if not exists public.dc_public_id_seq start with 365;

comment on sequence public.dc_public_id_seq is
  'CC-DC-SUPABASE-SERVING: global Public ID counter (TYPE4-YY-MM-DD-NNNNN suffix), all 7 game types share it. Seeded above the Airtable bank max (364 @ 2026-07-29).';

-- ── 2) Serving / approval columns ─────────────────────────────────────────────
alter table public.dc_puzzle_bank_staging
  add column if not exists public_id   text,
  add column if not exists approved_by text,
  add column if not exists approved_at timestamptz;

-- UNIQUE with NULLs allowed: drafts carry no Public ID (FAR-287 guarantee).
alter table public.dc_puzzle_bank_staging
  add constraint dc_staging_public_id_uniq unique (public_id);

comment on column public.dc_puzzle_bank_staging.public_id is
  'Share-facing puzzle id (TYPE4-YY-MM-DD-NNNNN). NULL while Unpublished; minted by trg_dc_assign_public_id on the first transition into Published/Live/Retired. Backfilled Airtable rows keep their original ids.';
comment on column public.dc_puzzle_bank_staging.approved_by is
  'Actor recorded by fn_dc_approve_puzzles (D4) — Draft rows reach Published ONLY through that RPC.';

-- ── 3) Serve-path index ───────────────────────────────────────────────────────
-- getLivePuzzles filters published='Live'; the rotator filters
-- (published, go_live_date) both ways.
create index if not exists dc_staging_published_gld_idx
  on public.dc_puzzle_bank_staging (published, go_live_date);

-- Idempotency key for the Airtable backfill (one staging row per bank record).
create unique index if not exists dc_staging_airtable_record_uniq
  on public.dc_puzzle_bank_staging (airtable_record_id)
  where airtable_record_id is not null;

-- ── 4) Import relaxations (D7) ────────────────────────────────────────────────
-- The 373 historical Airtable rows predate both the FAR-287 theme calendar
-- (dc_daily_theme starts 2026-08-01; bank go-lives start 2026-06-24) and the
-- hint/answer authoring conventions. Seeding synthetic dc_daily_theme rows was
-- rejected: theme_title/theme_blurb are subscriber-facing editorial copy (the
-- About page), so fabricated rows risk fake copy shipping. Instead these
-- columns become nullable and the CHECK below keeps them REQUIRED for
-- pipeline-generated rows — only imported rows (airtable_record_id set) may
-- omit them, so the FAR-287 invariant holds for everything CC-2 generates.
alter table public.dc_puzzle_bank_staging
  alter column theme_date drop not null,
  alter column hint_1     drop not null,
  alter column hint_2     drop not null,
  alter column hint_3     drop not null,
  alter column answer_key drop not null;

alter table public.dc_puzzle_bank_staging
  add constraint dc_staging_import_or_complete check (
    airtable_record_id is not null
    or (
      theme_date is not null
      and hint_1 is not null
      and hint_2 is not null
      and hint_3 is not null
      and answer_key is not null
    )
  );

-- ── 5) Assign-on-publish trigger (D2) ─────────────────────────────────────────
-- Drafts must never carry a Public ID; ids mint exactly once, on the first
-- transition into the published lifecycle, and are never re-minted (a row that
-- already has one — e.g. a backfilled Airtable row inserted as Retired — is
-- left untouched).
create or replace function public.dc_assign_public_id()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_prefix text;
  v_n bigint;
begin
  if new.public_id is not null then
    return new; -- already minted (or backfilled) — never re-mint
  end if;
  if new.published not in ('Published', 'Live', 'Retired') then
    return new; -- still a draft — no id
  end if;

  v_prefix := case new.puzzle_type
    when 'Rackl'       then 'RACK'
    when 'Signal Drop' then 'SGNL'
    when 'The Stack'   then 'STAK'
    when 'Circuit'     then 'CIRC'
    when 'The Brief'   then 'BRIF'
    when 'Dark Fiber'  then 'FIBR'
    when 'Frequency'   then 'FREQ'
  end;
  if v_prefix is null then
    raise exception 'dc_assign_public_id: unknown puzzle_type "%" on row %', new.puzzle_type, new.id;
  end if;
  if new.go_live_date is null then
    raise exception 'dc_assign_public_id: go_live_date is required to publish row %', new.id;
  end if;

  v_n := nextval('public.dc_public_id_seq');
  new.public_id := v_prefix || '-' || to_char(new.go_live_date, 'YY-MM-DD') || '-' || lpad(v_n::text, 5, '0');
  return new;
end
$$;

drop trigger if exists trg_dc_assign_public_id on public.dc_puzzle_bank_staging;
create trigger trg_dc_assign_public_id
  before insert or update of published
  on public.dc_puzzle_bank_staging
  for each row
  execute function public.dc_assign_public_id();

-- ── 6) Transactional rotator (D3) ─────────────────────────────────────────────
-- Exact AUTO-128 semantics, one transaction:
--   promote: published='Published' AND go_live_date = p_today  → 'Live'
--   retire:  published='Live'      AND go_live_date < p_today  → 'Retired'
-- Retire is strictly-before, so it can only ever retire the PRIOR live set —
-- never today's rows, never a future-dated row promoted early. Idempotent: a
-- same-day re-run finds nothing to promote (already Live) and nothing to
-- retire (already Retired). Promote runs first only so the summary reads like
-- the Airtable rotator's; atomicity makes the ordering safety-irrelevant.
-- live_types/missing_types mirror the old summary exactly: live_types = the
-- types promoted THIS run (so a no-op re-run reports [] / all-7-missing, same
-- as the Airtable rotator did).
create or replace function public.fn_dc_rotate_live_set(p_today date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c_types constant text[] := array['Rackl','Signal Drop','The Stack','Circuit','The Brief','Dark Fiber','Frequency'];
  v_promoted_ids   text[] := '{}';
  v_promoted_types text[] := '{}';
  v_retired_ids    text[] := '{}';
  v_live_types     text[] := '{}';
  v_missing_types  text[] := '{}';
begin
  with promoted as (
    update dc_puzzle_bank_staging
       set published = 'Live'
     where published = 'Published'
       and go_live_date = p_today
    returning id, puzzle_type
  )
  select coalesce(array_agg(id::text), '{}'), coalesce(array_agg(puzzle_type), '{}')
    into v_promoted_ids, v_promoted_types
    from promoted;

  with retired as (
    update dc_puzzle_bank_staging
       set published = 'Retired'
     where published = 'Live'
       and go_live_date < p_today
    returning id
  )
  select coalesce(array_agg(id::text), '{}')
    into v_retired_ids
    from retired;

  select coalesce(array_agg(t), '{}') into v_live_types
    from unnest(v_promoted_types) as t
   where t = any(c_types);
  select coalesce(array_agg(t), '{}') into v_missing_types
    from unnest(c_types) as t
   where not (t = any(v_live_types));

  return jsonb_build_object(
    'promoted',      coalesce(array_length(v_promoted_ids, 1), 0),
    'retired',       coalesce(array_length(v_retired_ids, 1), 0),
    'promoted_ids',  to_jsonb(v_promoted_ids),
    'retired_ids',   to_jsonb(v_retired_ids),
    'live_types',    to_jsonb(v_live_types),
    'missing_types', to_jsonb(v_missing_types)
  );
end
$$;

-- ── 7) Approval gate (D4) ─────────────────────────────────────────────────────
-- The ONLY sanctioned Draft(Unpublished) → Published transition. Staging holds
-- unreviewed generated content — nothing auto-publishes. Idempotent: rows
-- already past Unpublished are untouched by a re-run. Minting happens via the
-- publish trigger, so the returned public_ids are the freshly assigned ones.
create or replace function public.fn_dc_approve_puzzles(p_dates date[], p_actor text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids        text[] := '{}';
  v_public_ids text[] := '{}';
begin
  if p_actor is null or btrim(p_actor) = '' then
    raise exception 'fn_dc_approve_puzzles: p_actor is required (audit trail)';
  end if;

  with approved as (
    update dc_puzzle_bank_staging
       set published   = 'Published',
           status      = 'Approved',
           approved_by = p_actor,
           approved_at = now()
     where go_live_date = any(p_dates)
       and published = 'Unpublished'
    returning id, public_id
  )
  select coalesce(array_agg(id::text), '{}'), coalesce(array_agg(public_id), '{}')
    into v_ids, v_public_ids
    from approved;

  return jsonb_build_object(
    'approved',   coalesce(array_length(v_ids, 1), 0),
    'ids',        to_jsonb(v_ids),
    'public_ids', to_jsonb(v_public_ids)
  );
end
$$;

-- ── 8) Grants — service-role only, matching the table's deny-all posture ──────
revoke all on function public.fn_dc_rotate_live_set(date)            from public, anon, authenticated;
revoke all on function public.fn_dc_approve_puzzles(date[], text)    from public, anon, authenticated;
grant execute on function public.fn_dc_rotate_live_set(date)         to service_role;
grant execute on function public.fn_dc_approve_puzzles(date[], text) to service_role;

revoke all on sequence public.dc_public_id_seq from anon, authenticated;
grant usage, select on sequence public.dc_public_id_seq to service_role;
