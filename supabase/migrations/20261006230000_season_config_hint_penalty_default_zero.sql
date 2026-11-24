-- CC-LO-CONFIG-ENFORCEMENT-STATUS-1.0 — a hint penalty exists only where a
-- commissioner actually typed one.
--
-- WHY THIS EXISTS
-- `season_config.hint_penalty_pct` has been `numeric NOT NULL DEFAULT 25.00`
-- since the table was created, and nothing ever read it. The column was
-- documentation. This pack wires it into scoring (/api/score recomputes every
-- completion through `src/lib/scoring/season-scoring.js`), which turns that
-- dormant default into a live rule the day the app deploys:
--
--   measured 2026-10-06 against ycadmmngkdhvpcsrcuaq — of 10 season_config
--   rows, SEVEN still sit on exactly 25.00 and only three carry a deliberate
--   10.00. Three of the seven are `state = 'active'` RIGHT NOW. Shipping the
--   wiring against the current default would start charging 25% per hint —
--   75% off a three-hint completion — on three live seasons whose
--   commissioner never opened that field.
--
-- Myke's ruling (2026-10-06): the unconfigured penalty is ZERO. A penalty is a
-- decision, and a decision nobody made is not a penalty.
--
-- WHAT THIS DOES
--   1. `hint_penalty_pct` DEFAULT 25.00 → 0.00. Still NOT NULL — the app
--      treats null and 0 identically (`?? 0`), but a nullable scoring column
--      is an invitation to a three-valued bug later.
--   2. Rewrites the five never-chosen 25.00 rows to 0.00, BY ID.
--
-- WHY BY ID AND NOT `WHERE hint_penalty_pct = 25.00`
-- A blanket predicate would also rewrite a config that a commissioner
-- deliberately sets to 25 between the moment this file was written and the
-- moment it is applied — silently undoing a real decision in the name of
-- undoing a fake one. The ids below are pinned to a measurement, so applying
-- this late is safe: it does less than intended, never more.
--
-- THE SEVEN ROWS AT 25.00, measured 2026-10-06 (id · season · version · state):
--   REWRITTEN (5):
--     54cad6a3-0e52-482f-beeb-b861a6d6138b  demo 2                      v2  active
--     9043729d-39a4-495c-ab34-73809d3719ae  Season 2 — Post-YOTTA       v1  active
--     2919aefa-96f4-4b79-9972-76b44bfe4e7b  TEST SEASON 1               v1  active
--     9afb9857-6dc4-4b14-ad0b-93fad98ff4b3  Season 3 — Post-CES/Pre-GTC v1  draft
--     2b6cd6f9-7d4d-410b-abe4-917f4b4f5857  Season 4 — Post-GTC         v1  draft
--   DELIBERATELY LEFT ALONE (2) — `superseded` is HISTORY. These rows record
--   what was in force during a window that has closed; rewriting them would
--   falsify the version timeline the League Office shows, and no scoring path
--   can ever read them again (`v_season_effective_config` only considers
--   active/scheduled inside their effective window).
--     188fc0a3-21f2-4f30-9709-6b379aad6574  demo 2                      v1  superseded
--     5f3a2260-65b2-42de-8af4-526bfd31b4f0  Season 1 — Power Crunch     v1  superseded
--
--   The two DRAFTS are included on purpose, beyond the three live seasons: a
--   draft becomes active the moment it is promoted, so leaving them at 25.00
--   would simply postpone the bug to promote day.
--
--   NOT TOUCHED, and must not be: the three configs carrying a deliberate
--   10.00 — Football Season v1 (3bf84bc8-f202-4a2d-9a89-9dcc38f36711),
--   Hot summer Final Beta v1 (667c488f-1c9f-4199-a7ee-40aff7c094a7) and v2
--   (6b289c67-8998-4cf5-b420-6b598aaf3a66).
--
-- NO COMPLETION IS RESCORED. This changes the rule going forward only. Scores
-- already written to dc_completions / score_events / leaderboard_daily are
-- untouched, here and in the application.
--
-- APPLY ORDER — this is the THIRD unapplied migration in the stack. Apply in
-- timestamp order, each before the app deploy that needs it:
--   1. 20261006214500_dc_puzzle_bank_superseded.sql   (#194, regenerate-from)
--   2. the FDY-53 `team_join` migration                (PR stacked above this one)
--   3. 20261006230000_season_config_hint_penalty_default_zero.sql  (this file)
-- This one is independent of the other two and may be applied before or after
-- them; it must be applied BEFORE the app deploy that ships season scoring, or
-- the three live seasons charge 25% for a day.
--
-- ROLLBACK
--   begin;
--     alter table public.season_config
--       alter column hint_penalty_pct set default 25.00;
--     update public.season_config set hint_penalty_pct = 25.00
--      where id in (
--        '54cad6a3-0e52-482f-beeb-b861a6d6138b','9043729d-39a4-495c-ab34-73809d3719ae',
--        '2919aefa-96f4-4b79-9972-76b44bfe4e7b','9afb9857-6dc4-4b14-ad0b-93fad98ff4b3',
--        '2b6cd6f9-7d4d-410b-abe4-917f4b4f5857');
--   commit;
--   Rolling back restores the 25% charge on those five configs. It does not
--   un-write any score earned in between.

begin;

-- ── 1. the default ──────────────────────────────────────────────────────────
alter table public.season_config
  alter column hint_penalty_pct set default 0.00;

-- ── 2. the five never-chosen rows ───────────────────────────────────────────
-- `and hint_penalty_pct = 25.00` is belt AND braces with the id list: if one of
-- these five has been edited to a real value since the measurement, it is left
-- alone rather than flattened.
update public.season_config
   set hint_penalty_pct = 0.00
 where id in (
         '54cad6a3-0e52-482f-beeb-b861a6d6138b',  -- demo 2 v2, active
         '9043729d-39a4-495c-ab34-73809d3719ae',  -- Season 2 — Post-YOTTA v1, active
         '2919aefa-96f4-4b79-9972-76b44bfe4e7b',  -- TEST SEASON 1 v1, active
         '9afb9857-6dc4-4b14-ad0b-93fad98ff4b3',  -- Season 3 v1, draft
         '2b6cd6f9-7d4d-410b-abe4-917f4b4f5857'   -- Season 4 v1, draft
       )
   and hint_penalty_pct = 25.00;

-- ── 3. verification gate ────────────────────────────────────────────────────
-- Every assertion raises inside the transaction, so a failure rolls the whole
-- migration back rather than leaving the column half-migrated.
do $$
declare
  v_default text;
  v_football numeric;
  v_hot_v1 numeric;
  v_hot_v2 numeric;
  v_stray  int;
  v_done   int;
begin
  -- 3a. the new column default really is 0.00
  select column_default into v_default
    from information_schema.columns
   where table_schema = 'public'
     and table_name   = 'season_config'
     and column_name  = 'hint_penalty_pct';
  if v_default is null or v_default !~ '^0(\.0+)?$' then
    raise exception 'hint_penalty_pct default is % — expected 0.00', coalesce(v_default, '<null>');
  end if;

  -- 3b. the deliberate 10.00s are untouched. Football is the one season
  --     actually being played against this rule today.
  select hint_penalty_pct into v_football
    from public.season_config where id = '3bf84bc8-f202-4a2d-9a89-9dcc38f36711';
  if v_football is distinct from 10.00 then
    raise exception 'Football Season config reads % — expected 10.00', coalesce(v_football::text, '<missing>');
  end if;

  select hint_penalty_pct into v_hot_v1
    from public.season_config where id = '667c488f-1c9f-4199-a7ee-40aff7c094a7';
  select hint_penalty_pct into v_hot_v2
    from public.season_config where id = '6b289c67-8998-4cf5-b420-6b598aaf3a66';
  if v_hot_v1 is distinct from 10.00 or v_hot_v2 is distinct from 10.00 then
    raise exception 'Hot summer configs read %/% — expected 10.00/10.00',
      coalesce(v_hot_v1::text,'<missing>'), coalesce(v_hot_v2::text,'<missing>');
  end if;

  -- 3c. nothing OUTSIDE the enumerated list moved to 0. The only rows that may
  --     read 0.00 after this migration are the five it names — any other zero
  --     would mean the UPDATE's predicate was wider than intended.
  select count(*) into v_stray
    from public.season_config
   where hint_penalty_pct = 0.00
     and id not in (
       '54cad6a3-0e52-482f-beeb-b861a6d6138b','9043729d-39a4-495c-ab34-73809d3719ae',
       '2919aefa-96f4-4b79-9972-76b44bfe4e7b','9afb9857-6dc4-4b14-ad0b-93fad98ff4b3',
       '2b6cd6f9-7d4d-410b-abe4-917f4b4f5857');
  if v_stray > 0 then
    raise exception '% config(s) outside the enumerated list read 0.00 — the update was too wide', v_stray;
  end if;

  -- 3d. the two superseded history rows still read 25.00
  if exists (
    select 1 from public.season_config
     where id in ('188fc0a3-21f2-4f30-9709-6b379aad6574','5f3a2260-65b2-42de-8af4-526bfd31b4f0')
       and hint_penalty_pct is distinct from 25.00
  ) then
    raise exception 'a superseded history row was rewritten — it must not be';
  end if;

  select count(*) into v_done
    from public.season_config
   where hint_penalty_pct = 0.00;
  raise notice 'hint_penalty_pct default -> 0.00; % config(s) now read 0.00 (expected 5, fewer if some were edited since 2026-10-06)', v_done;
end $$;

commit;
