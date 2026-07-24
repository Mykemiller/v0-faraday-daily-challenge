-- FAR-287 — Daily Challenge Puzzle Bank staging schema
--
-- Bulk themed puzzle generation writes HERE first (Supabase read model), because
-- the production Airtable Puzzle Bank has a write-approval gate blocking bulk API
-- creates. Nothing in the generation pipeline bulk-writes to Airtable.
--
-- Three tables:
--   dc_daily_theme            — one row per serve day: the Theater/Sector/Thread(s)/
--                               JPAS-tier tuple + subscriber-facing title/blurb.
--   dc_puzzle_bank_staging    — one row per (puzzle_type, go_live_date): the generated
--                               Puzzle Content JSON, hints, answer, provenance.
--   dc_puzzle_generation_runs — run-level bookkeeping for resumable, checkpointed runs.
--
-- ADDITIVE + reversible. RLS enabled with NO policies (deny-all); the service role
-- bypasses RLS and is the only writer/reader. This is UNAPPROVED staging content —
-- no anon read. Everything lands status='Draft' / published='Unpublished'; the
-- rotator (AUTO-128) only ever promotes Airtable rows, never these.

-- ── Run bookkeeping ───────────────────────────────────────────────────────────
create table if not exists public.dc_puzzle_generation_runs (
  id                uuid primary key default gen_random_uuid(),
  started_at        timestamptz not null default now(),
  completed_at      timestamptz,
  target_count      integer,
  written_count     integer not null default 0,
  failed_count      integer not null default 0,
  rotation_seed     text,
  registry_version  text,
  params            jsonb,
  status            text not null default 'running'
);
comment on table public.dc_puzzle_generation_runs is
  'FAR-287: run-level bookkeeping for resumable themed puzzle generation.';

-- ── Daily theme calendar ──────────────────────────────────────────────────────
create table if not exists public.dc_daily_theme (
  id                uuid primary key default gen_random_uuid(),
  theme_date        date not null unique,
  theater_id        text not null,                 -- T-001..T-007
  theater_name      text not null,
  sector_code       text not null,                 -- D1..D23
  sector_name       text not null,
  thread_codes      text[] not null,               -- 1-3 D#.#
  thread_names      text[] not null,
  jpas_tier_code    text not null references public.jpas_tiers(tier_code),
  theme_title       text not null,                 -- subscriber-facing, count-agnostic
  theme_blurb       text not null,                 -- 1-2 sentences, public labels only
  maturity_grade    text not null,                 -- Established | Developing
  coverage_grade    text,                          -- Dedicated | Broad-only | Whitespace
  rotation_seed     text not null,
  registry_version  text not null,                 -- 'IDF 4.0'
  generation_run_id uuid,
  created_at        timestamptz not null default now()
);
comment on table public.dc_daily_theme is
  'FAR-287: one themed day = Theater/Sector/Thread(s)/JPAS-tier tuple + public copy.';
comment on column public.dc_daily_theme.jpas_tier_code is
  'Internal only — shapes the day''s constraint kind; NEVER surfaced to subscribers.';

create index if not exists dc_daily_theme_theater_idx on public.dc_daily_theme (theater_id);
create index if not exists dc_daily_theme_sector_idx  on public.dc_daily_theme (sector_code);
create index if not exists dc_daily_theme_run_idx     on public.dc_daily_theme (generation_run_id);

-- ── Staged puzzles ────────────────────────────────────────────────────────────
create table if not exists public.dc_puzzle_bank_staging (
  id                  uuid primary key default gen_random_uuid(),
  theme_date          date not null references public.dc_daily_theme(theme_date),
  puzzle_type         text not null,
  puzzle_name         text not null,
  go_live_date        date not null,
  status              text not null default 'Draft',
  published           text not null default 'Unpublished',
  puzzle_content      jsonb not null,
  hint_1              text not null,
  hint_2              text not null,
  hint_3              text not null,
  answer_key          text not null,
  answer_explanation  text,
  domain              text,                          -- D#, inherited from theme
  sub_domain          text,                          -- D#.#
  theater_id          text,                          -- T-###
  jpas_tier_code      text,
  difficulty          text,                          -- easy | medium | hard
  subject_fingerprint text not null,
  source_refs         jsonb,                         -- company_ids, signal ids, lexicon ids
  content_hash        text not null unique,
  generation_batch_id uuid not null,
  generator_model     text not null,
  generated_at        timestamptz not null default now(),
  validation_status   text not null default 'pending',
  validation_errors   jsonb,
  airtable_record_id  text,
  synced_at           timestamptz,
  constraint dc_puzzle_bank_staging_type_date_uniq unique (puzzle_type, go_live_date)
);
comment on table public.dc_puzzle_bank_staging is
  'FAR-287: generated Puzzle Content per (type, go_live_date). Draft/Unpublished only.';
comment on column public.dc_puzzle_bank_staging.subject_fingerprint is
  'Normalized subject key for the 90-day non-repeat gate (per game type).';

create index if not exists dc_staging_theme_date_idx  on public.dc_puzzle_bank_staging (theme_date);
create index if not exists dc_staging_type_idx        on public.dc_puzzle_bank_staging (puzzle_type);
create index if not exists dc_staging_batch_idx       on public.dc_puzzle_bank_staging (generation_batch_id);
create index if not exists dc_staging_validation_idx  on public.dc_puzzle_bank_staging (validation_status);
create index if not exists dc_staging_fingerprint_idx on public.dc_puzzle_bank_staging (puzzle_type, subject_fingerprint);

-- ── RLS: deny-all (service role bypasses) ─────────────────────────────────────
alter table public.dc_puzzle_generation_runs enable row level security;
alter table public.dc_daily_theme            enable row level security;
alter table public.dc_puzzle_bank_staging    enable row level security;

-- No policies = no anon/authenticated access. Service role bypasses RLS.
revoke all on public.dc_puzzle_generation_runs from anon, authenticated;
revoke all on public.dc_daily_theme            from anon, authenticated;
revoke all on public.dc_puzzle_bank_staging    from anon, authenticated;
