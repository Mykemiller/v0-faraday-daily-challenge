-- CC-LO-SEASON-CONFIG-1.0 — repair the season-config effective-dating functions.
--
-- ✅ APPLIED to prod (ycadmmngkdhvpcsrcuaq) 2026-07-30, Myke-approved.
--    "Promote now" / "Schedule" in the League Office Season Config editor work
--    from this point on; before it, every promote threw (defect 1 below).
--
-- These two functions shipped with the season_config_* migrations. Four defects
-- were found by exercising the real RPCs end-to-end (in a rolled-back
-- transaction against prod, 2026-07-30). Defects 1 and 2 masked each other,
-- which is why the pair looked healthy: nothing could ever be promoted, so the
-- scheduling path was never reached.
--
-- 1. season_config_promote() ALWAYS THREW.
--       set state = case when ... then 'scheduled' else 'active' end
--    The CASE yields `text`, and Postgres will not implicitly cast text to the
--    season_config_state enum in an UPDATE ... SET. Every call failed with
--    42804. Fix: cast the CASE result to ::season_config_state.
--
-- 2. Scheduling a future version immediately superseded the incumbent.
--    promote() demoted the active version even when the new one was only being
--    SCHEDULED, leaving the season with NO config in force until the effective
--    date — v_season_effective_config returned nothing. That directly breaks the
--    product promise ("until then the current active version stays in force").
--    Fix: only supersede the incumbent on an immediate promote;
--    season_config_apply_due() already demotes it at flip time.
--
-- 3. season_config_apply_due() violated season_config_one_active_uq.
--    It demoted the incumbent and promoted the due version in ONE statement via
--    data-modifying CTEs. Those CTEs share a snapshot and do not see each
--    other's effects, so the unique partial index (one active config per season)
--    saw two active rows and raised 23505. Only defect 2 hid this: the incumbent
--    had already been superseded at schedule time, so there was nothing to
--    demote. Fix: demote and promote in separate statements.
--
-- 4. Superseding at the same instant a version took effect violated
--    season_config_window_chk (effective_to > effective_from). Reachable
--    whenever an incumbent is demoted at or before its own effective_from — two
--    promotes within the same second, or a scheduled flip landing on the same
--    timestamp. Fix: clamp effective_to to at least effective_from + 1µs.
--
-- Also hardened: when two scheduled versions for one season are both overdue
-- (e.g. the cron missed a run), the LATEST wins and the overtaken one is marked
-- superseded rather than being promoted next hour and flip-flopping the season.
--
-- Verified 2026-07-30 by a 17-assertion harness (promote-now · schedule ·
-- incumbent stays live during the wait · cron flip · exactly-one-active
-- invariant · idempotent re-run · blocking-validation refusal · two-overdue
-- resolution), all PASS, run inside BEGIN/ROLLBACK so no test rows persisted.
-- Run twice: once against a draft of this file before applying, and again
-- against the DEPLOYED functions after applying. Post-apply state confirmed
-- unchanged (4 seasons, 4 configs, 1 active, 28 season_games, 0 test rows), and
-- a real season_config_apply_due() call returned 0 (correct no-op).
--
-- Security advisor after apply: no NEW findings. Both functions carry a
-- function_search_path_mutable WARN, but so do the untouched season_config_clone
-- and season_config_validate — it is a pre-existing property of the original
-- migration that CREATE OR REPLACE preserved, not something introduced here.
-- Worth hardening separately; deliberately not folded into a bug fix.

-- ── 1. promote / schedule ────────────────────────────────────────────────────
create or replace function public.season_config_promote(
  p_config_id uuid,
  p_staff_email text default null,
  p_reason text default 'Season config promoted via League Office'
)
returns season_config
language plpgsql
as $function$
declare
  v_cfg season_config;
  v_prev season_config;
  v_errors integer;
  v_now timestamptz := now();
  v_immediate boolean;
begin
  select * into v_cfg from season_config where id = p_config_id;
  if v_cfg is null then
    raise exception 'Config % not found', p_config_id;
  end if;

  -- Errors block; warnings do not. This is THE gate — the UI's disabled button
  -- is only a courtesy.
  select count(*) into v_errors
  from season_config_validate(p_config_id) where severity = 'error';
  if v_errors > 0 then
    raise exception 'Config % has % blocking validation error(s)', p_config_id, v_errors;
  end if;

  v_immediate := v_cfg.effective_from <= v_now;

  -- Defect 2: supersede the incumbent ONLY when this version goes live now.
  -- When scheduling, the incumbent must stay in force until the effective date.
  if v_immediate then
    select * into v_prev
    from season_config
    where season_id = v_cfg.season_id and state = 'active' and id <> p_config_id;

    if v_prev.id is not null then
      update season_config
         set state = 'superseded',
             -- Defect 4: effective_to must be strictly greater than effective_from.
             effective_to = greatest(v_cfg.effective_from, v_now,
                                     v_prev.effective_from + interval '1 microsecond')
       where id = v_prev.id;
    end if;
  end if;

  update season_config
     set state = (case when v_immediate then 'active' else 'scheduled' end)::season_config_state,  -- defect 1
         applied_at = case when v_immediate then v_now else null end
   where id = p_config_id
  returning * into v_cfg;

  insert into lo_audit_log (staff_email, domain, action, reason, target_type, target_id,
                            before, after, reversible)
  values (coalesce(p_staff_email, 'system'), 'seasons', 'promote_config', p_reason,
          'season_config', p_config_id::text,
          to_jsonb(v_prev), to_jsonb(v_cfg), true);

  return v_cfg;
end;
$function$;

-- ── 2. the hourly effective-dating actuator ──────────────────────────────────
create or replace function public.season_config_apply_due()
returns integer
language plpgsql
as $function$
declare
  v_count integer := 0;
  v_now timestamptz := now();
begin
  -- One winner per season: the latest due scheduled version.
  create temp table _season_config_due on commit drop as
  select distinct on (season_id) id, season_id
  from season_config
  where state = 'scheduled' and effective_from <= v_now
  order by season_id, effective_from desc, version desc;

  -- An older due version the winner overtook never goes live.
  update season_config sc
     set state = 'superseded',
         effective_to = greatest(v_now, sc.effective_from + interval '1 microsecond')
   where sc.state = 'scheduled'
     and sc.effective_from <= v_now
     and sc.id not in (select id from _season_config_due);

  -- Defect 3: demote incumbents in their OWN statement. Demoting and promoting
  -- inside one statement (data-modifying CTEs) trips season_config_one_active_uq.
  update season_config sc
     set state = 'superseded',
         effective_to = greatest(v_now, sc.effective_from + interval '1 microsecond')
   where sc.state = 'active'
     and sc.season_id in (select season_id from _season_config_due);

  update season_config
     set state = 'active', applied_at = v_now
   where id in (select id from _season_config_due);

  get diagnostics v_count = row_count;
  drop table _season_config_due;
  return v_count;
end;
$function$;
