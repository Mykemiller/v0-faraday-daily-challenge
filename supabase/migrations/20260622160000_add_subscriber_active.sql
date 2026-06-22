-- Daily Challenge cosmetic buff — soft opt-out ("leave the game").
-- Additive + reversible. No drops, no renames. Safe to run more than once.
--
-- Reverse:
--   alter table public.dc_subscribers drop column if exists active;
--
-- Enforcement note: setting active = false stops streak accrual and notifications
-- and hides the player from the in-app team board (client-side, this pass). Full
-- exclusion from the Leaderboard V2 ranking RPCs is a deferred follow-on (it
-- requires editing the locked standings functions) and is intentionally NOT done
-- here.

alter table public.dc_subscribers
  add column if not exists active boolean not null default true;

comment on column public.dc_subscribers.active is
  'Soft opt-out flag ("leave the game"). false = opted out: streak accrual stops and the player is hidden from leaderboards; all data is retained. Set via the Next /api/account route. (FAR Daily Challenge cosmetic buff)';
