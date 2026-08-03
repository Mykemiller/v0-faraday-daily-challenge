-- CC-LO-SEASON-SCOPE-1.0 · Phase 1, part 1 of 2 — the `team` scope type.
--
-- SPLIT FROM 20260803170100_season_scope_v1.sql ON PURPOSE. Postgres refuses to
-- USE an enum value in the same transaction that ADDed it, and Supabase's
-- migration runner wraps each file in one transaction. Part 2 references
-- 'team' in fn_season_scopes_validate_ref / fn_season_scope_teams, so the ADD
-- has to commit first. Apply this file, then part 2.
--
-- Why `team` at all (D2): the exclusions the commissioner actually reached for
-- on 2026-07-31 were three TEAMS (Lonely hearts, Deloitte, Strategy & Growth).
-- With only platform|league|conference the one real use case on record cannot
-- be expressed at all.

alter type public.season_scope_type add value if not exists 'team';
