-- Durable, rotatable per-team join token for team invite links (team page, FAR team-page).
-- Additive + reversible. Applied to prod ycadmmngkdhvpcsrcuaq 2026-07-24.
--
-- Distinct from teams.code (the human-facing join code used by the team_join RPC)
-- so the invite link can be rotated without changing the team's identity or the
-- team-page route key (which is teams.id). Existing rows are backfilled with
-- distinct tokens by the column default on ADD.
ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS join_token uuid NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX IF NOT EXISTS teams_join_token_key ON public.teams (join_token);

COMMENT ON COLUMN public.teams.join_token IS
  'Durable, rotatable invite-link token. Captain may rotate via /api/leaderboard/team rotate-token. Not the route key (teams.id is) and not the join code (teams.code is).';
