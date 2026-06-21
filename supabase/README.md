# Supabase — Daily Challenge backend

These artifacts are deployed to Supabase project **`ycadmmngkdhvpcsrcuaq`** (Faraday).
They are committed here for version control; the live deploy was done via the
Supabase management API.

## Team leaderboard wiring (this change)

The team leaderboard (`teams_v1`: `teams`, `team_members`, and the
`team_*` / `current_season` RPCs) predates the current per-player system
(DC-003: `dc_subscribers`, `dc_completions`). It was dormant because nothing
fed per-player MW into team totals.

- `migrations/20260619012457_teams_dc003_mw_wiring.sql` — `AFTER INSERT` trigger
  on `dc_completions` that routes each completion's `mw_earned` into the
  player's current team (`team_members.my_mw` + `teams.mw_total`), joined by
  email. This is the link that makes `team_leaderboard()` show real results.
- `functions/get-team-leaderboard/` — public read of seasonal standings; also
  returns the caller's team + rank when a valid session token is supplied.
- `functions/team-action/` — session-gated create/join/leave, wrapping the
  `team_create` / `team_join` / `team_leave` RPCs.

Both functions are deployed with `verify_jwt = false` (custom session-token
auth), matching the sibling daily-challenge functions
(`register-with-magic-link`, `verify-magic-link`, `complete-puzzle`,
`get-subscriber-state`).
