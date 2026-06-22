-- Leaderboard V2: an active Season so the Season board + SeasonHero render.
-- Name/dates are adjustable product config (Myke to confirm). 21-day season
-- covering today (2026-06-21 -> "Day 9 of 21"). Idempotent on slug.
INSERT INTO public.seasons (slug, name, starts_on, ends_on, status, tz)
VALUES ('season-1-power-crunch', 'Season 1 — Power Crunch', DATE '2026-06-13', DATE '2026-07-03', 'active', 'America/Chicago')
ON CONFLICT (slug) DO NOTHING;

-- rollback: DELETE FROM public.seasons WHERE slug = 'season-1-power-crunch';
