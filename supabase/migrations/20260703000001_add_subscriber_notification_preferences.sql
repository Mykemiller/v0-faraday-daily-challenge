-- Daily Challenge notification settings (subscriber profile).
-- Additive + reversible. No drops, no renames. Safe to run more than once.
--
-- Reverse:
--   alter table public.dc_subscribers drop column if exists notification_preferences;
--
-- Shape (contract — the four category keys are fixed; other services read/write
-- against them, do NOT rename):
--   { "master_enabled": true,
--     "categories": {
--       "reminder_to_play":     { "enabled": true,  "channels": { "sms": false, "email": true  } },
--       "streak_at_risk":       { "enabled": true,  "channels": { "sms": true,  "email": false } },
--       "teammate_completed":   { "enabled": true,  "channels": { "sms": false, "email": true  } },
--       "leaderboard_movement": { "enabled": false, "channels": { "sms": false, "email": false } } } }
--
-- Nullable with no database default on purpose: pre-existing subscribers keep
-- NULL and every reader falls back to DEFAULT_NOTIFICATION_PREFERENCES in
-- src/lib/notification-preferences.ts — the single source of truth for defaults,
-- shared by the /api/account route, the /account/notifications page, and any
-- future sender. Senders must gate each send through shouldSendNotification().

alter table public.dc_subscribers
  add column if not exists notification_preferences jsonb;

comment on column public.dc_subscribers.notification_preferences is
  'Daily Challenge alert preferences: {master_enabled, categories.{reminder_to_play|streak_at_risk|teammate_completed|leaderboard_movement}.{enabled, channels.{sms,email}}}. NULL = defaults (src/lib/notification-preferences.ts). Written via the Next /api/account route; master_enabled=false silences all sends while per-category settings persist underneath.';
