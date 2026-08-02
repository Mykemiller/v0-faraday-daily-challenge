-- Down-migration for 20260802140000_league_playoffs_part3_bracket.sql
-- CC-LEAGUE-PLAYOFFS-1.0
--
-- Part 3 was purely additive — four new tables and three new functions, no
-- existing object modified — so the down is a clean drop with nothing to
-- restore.
--
-- ⚠️ THIS IS DESTRUCTIVE OF PLAYOFF STATE. Dropping the tables discards every
-- seeded bracket, seed snapshot and matchup result. That is recoverable only in
-- the sense that everything here is DERIVED: re-applying the migration and
-- re-running fn_playoff_seed_field() rebuilds the same bracket from the same
-- score_events, provided the seeding window's scores have not themselves
-- changed. The one thing that does NOT survive is the seeded_at / seeded_by
-- provenance and any display_name snapshot taken before a rename.
--
-- Order matters: matchups self-reference (next_matchup_id) and both child tables
-- reference brackets, so drop children first. `cascade` is deliberately NOT used
-- — an unexpected dependency should fail loudly rather than be silently removed.
--
-- Proven in BEGIN … ROLLBACK against prod alongside the up-migration.

begin;

drop function if exists public.fn_playoff_seed_field(uuid, text);
drop function if exists public.fn_playoff_recompute(uuid);
drop function if exists public.fn_playoff_participant_points(uuid, text, uuid, date, date);

drop table if exists public.dc_playoff_matchups;
drop table if exists public.dc_playoff_seeds;
drop table if exists public.dc_playoff_brackets;
drop table if exists public.dc_playoff_config;

commit;
