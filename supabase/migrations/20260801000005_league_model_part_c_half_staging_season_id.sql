-- CC-LEAGUE-MODEL-1.0 Part C½ — dc_puzzle_bank_staging.season_id
--
-- APPLIED TO PROD 2026-08-01 (as `league_model_part_c_half_staging_season_id`,
-- version 20260801093124, via the Supabase MCP). This file is the VCS record.
--
-- Optional season tag for a staged puzzle. Nullable on purpose:
--   - Imported Airtable rows and generated rows are season-agnostic; the serve
--     path (published='Live') never reads it.
--   - The League Office season slate (season_config/season_games) remains the
--     season-facing assignment model — this column is a forward hook for
--     season-scoped bank curation, not a serving gate (Game Library D4 stands).
-- No index: no read path filters on it yet.

alter table public.dc_puzzle_bank_staging
  add column if not exists season_id uuid references public.seasons(id);

comment on column public.dc_puzzle_bank_staging.season_id is
  'Optional season tag (CC-LEAGUE-MODEL-1.0 Part C½). Nullable; never read by the serve path. Season slates live in season_config/season_games.';
