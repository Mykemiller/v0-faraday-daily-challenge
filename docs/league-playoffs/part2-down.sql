-- Down-migration for 20260802130000_league_playoffs_part2_phase_scoring.sql
-- CC-LEAGUE-PLAYOFFS-1.0
--
-- Part 2 was purely additive — it created four functions and modified nothing —
-- so the down is a clean drop with nothing to restore. The three original
-- leaderboard RPCs (global_leaderboard, team_leaderboard_season,
-- team_total_score) were never touched and are deliberately absent here.
--
-- Reverting the database alone leaves the app's `?phase=` query parameter in
-- place. That fails safe: the routes only call the *_phase RPCs when a non-full
-- phase is requested, and a missing function surfaces as an empty board rather
-- than wrong numbers. To fully revert, roll back the app deploy too.
--
-- Proven in BEGIN … ROLLBACK against prod alongside the up-migration.

begin;

drop function if exists public.global_leaderboard_phase(uuid, text);
drop function if exists public.team_leaderboard_phase(uuid, uuid, text);
drop function if exists public.team_total_score_phase(uuid, uuid, text);
drop function if exists public.fn_season_phase_window(uuid, text);

commit;
