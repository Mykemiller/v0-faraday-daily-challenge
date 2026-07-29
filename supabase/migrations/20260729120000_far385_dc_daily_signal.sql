-- FAR-385: Faraday Signal — daily intelligence items authored directly in
-- Supabase (no Airtable coupling), matched per-puzzle to the day's Daily
-- Challenge content by the sync-day-content cron and rendered post-solve on
-- the ScoreCard (The Brief pilot; Signal Drop/Rackl are a later config flip).
--
-- Additive + reversible (DROP TABLE dc_daily_signal).
--
-- RLS posture: enable RLS, NO policies — deny-all for anon/authenticated keys,
-- service-role only, identical to the other dc_* tables. The sync cron writes
-- match results into dc_daily_page_content; the serve path never reads this
-- table at request time. NEVER add an anon or authenticated policy here.

create table if not exists public.dc_daily_signal (
  id uuid primary key default gen_random_uuid(),
  signal_date date not null,
  headline text not null,
  body text not null,
  source_url text,
  source_label text,
  -- matchable metadata (IDF 4.0 PUBLIC LABELS ONLY — never backend D#/D#.# ids)
  domain text,
  sub_domain text,
  tags text[] not null default '{}',
  -- commissioner overrides
  pinned_for_date date,          -- if set, this signal wins for that serve date
  pinned_puzzle_type text,       -- optional: pin to one game only (free text, puzzle_type convention)
  -- lifecycle
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.dc_daily_signal is
  'FAR-385 Faraday Signal items. Authored directly in Supabase (service role). domain/sub_domain are IDF 4.0 public labels, never backend ids. Matched per puzzle by /api/cron/sync-day-content.';

create index if not exists dc_daily_signal_date_published_idx
  on public.dc_daily_signal (signal_date, published);

alter table public.dc_daily_signal enable row level security;
-- Deliberately NO policies: deny-all for anon/authenticated; service role bypasses.
