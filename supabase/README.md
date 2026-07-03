# Supabase — Daily Challenge backend

These artifacts are deployed to Supabase project **`ycadmmngkdhvpcsrcuaq`** (Faraday).
They are committed here for version control; the live deploy was done via the
Supabase management API.

## Team membership + leaderboard wiring

**Reconciled 2026-07-03** (`migrations/20260703120000…` + `…120001…`): the
email-keyed `team_members` table and the whole MW currency
(`teams.mw_total`, `team_members.my_mw`, `dc_subscribers.mw_balance`,
`dc_completions.mw_earned`, and the `dc_completions → team MW` trigger) are
**gone**. `team_memberships` (`subscriber_id` + `season_id`) is the single
canonical membership table, and `teams.captain_id` records the Team Captain
(auto-set to the creator; the hook for future trade-approval work).
`teams.season` (text) is deprecated — founding-era label only.

- The `team_create` / `team_join` / `team_leave` / `team_get_my_teams` RPCs kept
  their signatures but now read/write `team_memberships` and maintain
  `captain_id` (leave rolls captaincy to the earliest remaining member).
- `team_leaderboard()` ranks by season score (`team_memberships` +
  `score_events`), matching `/api/leaderboard/season`.
- All ranking/cache functions (`fn_leaderboard_*`, `fn_player_rank_*`,
  `fn_group_member_board`, the daily-cache trigger) sum `dc_completions.score`
  ("signals" = score).
- `functions/get-team-leaderboard/` — public read of seasonal standings; also
  returns the caller's team + rank when a valid session token is supplied.
- `functions/team-action/` — session-gated create/join/leave, wrapping the
  `team_create` / `team_join` / `team_leave` RPCs.

Both functions are deployed with `verify_jwt = false` (custom session-token
auth), matching the sibling daily-challenge functions
(`register-with-magic-link`, `verify-magic-link`, `complete-puzzle`,
`get-subscriber-state`).
