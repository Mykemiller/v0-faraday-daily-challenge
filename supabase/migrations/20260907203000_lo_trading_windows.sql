-- League Office — stored trading windows (New Season wizard step 3).
--
-- Until now the two trading windows existed ONLY as hardcoded cosmetics in the
-- season-detail timeline (`addDays(start, 7)` / `addDays(end, -7)`) — nothing
-- was stored, nothing was configurable, and nothing per-league. This migration
-- makes them real: a per-league default length, and four dates on the season.
--
-- Deliberately NOT touched: `seasons.free_agency_start` and
-- `free_agency_notice_start` stay GENERATED ALWAYS (`ends_on - 3` / `- 7`).
-- Free agency remains anchored to the season END and read-only in the wizard
-- (Myke, 2026-09-07). Any write to them — including NULL — raises 428C9.
--
-- Additive only. Every column is nullable with a default, so existing rows and
-- every current reader keep working untouched.

begin;

-- ── league defaults ──────────────────────────────────────────────────────────
-- Lengths in DAYS, not dates: a league default cannot know a season's window.
-- 7/7 reproduces exactly what the timeline has been drawing, so seeding a new
-- season from these defaults is visually a no-op against today's behaviour.

alter table public.leagues
  add column if not exists default_trading_open_days  integer not null default 7,
  add column if not exists default_trading_close_days integer not null default 7;

alter table public.leagues
  drop constraint if exists leagues_default_trading_open_days_sane;
alter table public.leagues
  add constraint leagues_default_trading_open_days_sane
  check (default_trading_open_days between 0 and 365);

alter table public.leagues
  drop constraint if exists leagues_default_trading_close_days_sane;
alter table public.leagues
  add constraint leagues_default_trading_close_days_sane
  check (default_trading_close_days between 0 and 365);

comment on column public.leagues.default_trading_open_days is
  'Default LENGTH in days of the opening trading window. Seeds seasons.trading_open_ends_on = starts_on + this.';
comment on column public.leagues.default_trading_close_days is
  'Default LENGTH in days of the closing trading window. Seeds seasons.trading_close_starts_on = ends_on - this.';

-- ── season windows ───────────────────────────────────────────────────────────
-- Nullable: seasons created before this migration have no stored windows, and
-- the timeline falls back to the legacy ±7 derivation for them. A season either
-- has BOTH ends of a window or neither — enforced below.

alter table public.seasons
  add column if not exists trading_open_starts_on  date,
  add column if not exists trading_open_ends_on    date,
  add column if not exists trading_close_starts_on date,
  add column if not exists trading_close_ends_on   date;

-- Both-or-neither, per window.
alter table public.seasons drop constraint if exists seasons_trading_open_paired;
alter table public.seasons add constraint seasons_trading_open_paired
  check ((trading_open_starts_on is null) = (trading_open_ends_on is null));

alter table public.seasons drop constraint if exists seasons_trading_close_paired;
alter table public.seasons add constraint seasons_trading_close_paired
  check ((trading_close_starts_on is null) = (trading_close_ends_on is null));

-- Each window opens before it closes.
alter table public.seasons drop constraint if exists seasons_trading_open_ordered;
alter table public.seasons add constraint seasons_trading_open_ordered
  check (trading_open_starts_on is null or trading_open_starts_on < trading_open_ends_on);

alter table public.seasons drop constraint if exists seasons_trading_close_ordered;
alter table public.seasons add constraint seasons_trading_close_ordered
  check (trading_close_starts_on is null or trading_close_starts_on < trading_close_ends_on);

-- Every window date sits inside the season, inclusive of both endpoints. Unlike
-- free agency (which deliberately overhangs `ends_on` in the timeline), trading
-- windows are strictly in-season.
alter table public.seasons drop constraint if exists seasons_trading_within_window;
alter table public.seasons add constraint seasons_trading_within_window
  check (
    (trading_open_starts_on  is null or trading_open_starts_on  between starts_on and ends_on) and
    (trading_open_ends_on    is null or trading_open_ends_on    between starts_on and ends_on) and
    (trading_close_starts_on is null or trading_close_starts_on between starts_on and ends_on) and
    (trading_close_ends_on   is null or trading_close_ends_on   between starts_on and ends_on)
  );

-- The two windows may touch but never overlap.
alter table public.seasons drop constraint if exists seasons_trading_windows_disjoint;
alter table public.seasons add constraint seasons_trading_windows_disjoint
  check (
    trading_open_ends_on is null
    or trading_close_starts_on is null
    or trading_open_ends_on <= trading_close_starts_on
  );

comment on column public.seasons.trading_open_starts_on is
  'Opening trading window start. NULL on pre-2026-09 seasons; the timeline falls back to starts_on for those.';
comment on column public.seasons.trading_close_ends_on is
  'Closing trading window end. NULL on pre-2026-09 seasons; the timeline falls back to ends_on for those.';

commit;
