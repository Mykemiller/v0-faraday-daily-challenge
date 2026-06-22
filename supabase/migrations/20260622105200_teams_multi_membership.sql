-- Leaderboard V2 §7.2: allow a player to belong to multiple groups.
-- DESTRUCTIVE (§13.4, flagged in PR): drops the standalone UNIQUE(member_email)
-- that blocked multi-membership. The composite PK (team_id, member_email) still
-- prevents joining the same group twice. Reversible.
ALTER TABLE public.team_members DROP CONSTRAINT IF EXISTS team_members_member_email_key;

-- rollback: ALTER TABLE public.team_members ADD CONSTRAINT team_members_member_email_key UNIQUE (member_email);
