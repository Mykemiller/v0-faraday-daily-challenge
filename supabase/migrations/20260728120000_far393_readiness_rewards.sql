-- FAR-393 — Intelligence Readiness rewards
-- Phase-0 decisions (PHASE-0-FINDINGS.md), confirmed by Myke 2026-07-28:
--   D1: reward ladder keys off dc_subscribers.play_streak (the live streak SoT).
--   D2/D5: ONE Faraday wallet = live_agent_token_ledger (keyed to dc_subscribers.id).
--          Streak rewards land there as a DURABLE bonus balance.
--   D3: token_transactions CANNOT hold these rows (its subscriber_id FKs to the empty
--       `subscribers` table, not dc_subscribers), so the grant audit/idempotency log is
--       a dedicated table keyed to dc_subscribers.id. No token_transactions writes here.
--   D4: 10-day tier descoped from "Friday brief access" to a token grant (no brief-unlock
--       model exists in the app today).
-- Reset rule + timezone: America/Chicago (matches complete-puzzle / /api/score).
-- No-backfill: only streak runs that STARTED on/after the feature epoch can be rewarded.
-- ADDITIVE + reversible. Touches only live_agent_token_ledger + a new grant-log table.

-- 1) Durable bonus balance on the single Faraday wallet. NOT reset on the monthly
--    plan cycle; spent before the plan balance; usable even by non-entitled (free) tiers.
alter table public.live_agent_token_ledger
  add column if not exists bonus_balance integer not null default 0;

comment on column public.live_agent_token_ledger.bonus_balance is
  'FAR-393: durable Faraday-token balance from Intelligence Readiness streak rewards. Survives the monthly plan reset; spent before plan balance; spendable by free tier.';

-- 2) Grant audit + idempotency log (keyed to dc_subscribers.id — see D3 above).
create table if not exists public.dc_streak_grants (
  id                    uuid primary key default gen_random_uuid(),
  subscriber_id         uuid not null references public.dc_subscribers(id) on delete cascade,
  threshold             integer not null check (threshold in (5, 10)),
  tokens                integer not null check (tokens > 0),
  play_streak_at_grant  integer not null,
  grant_date            date    not null,          -- Central calendar date the milestone fired
  created_at            timestamptz not null default now()
);

comment on table public.dc_streak_grants is
  'FAR-393: audit + idempotency log of Intelligence Readiness token rewards. One row per fired milestone. Backs the abuse-cap window checks (5-day: 30d rolling; 10-day: per calendar week).';

create index if not exists dc_streak_grants_sub_thr_created_idx
  on public.dc_streak_grants (subscriber_id, threshold, created_at desc);

alter table public.dc_streak_grants enable row level security;
-- Deny-all (no policies): service role bypasses RLS; the grant RPC is SECURITY DEFINER.
-- Mirrors the live_agent_* deny-all posture.

-- 3) The ONLY sanctioned streak-grant write path. Verifies the streak against the DB
--    (never trusts a client-reported value), enforces no-backfill + abuse caps, and
--    credits the durable bonus balance. Idempotent per (subscriber, threshold, window).
create or replace function public.dc_grant_readiness_reward(
  p_subscriber uuid,
  p_threshold  integer
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  c_epoch  constant date := date '2026-07-28';  -- feature ship epoch (no pre-ship backfill)
  v_streak int;
  v_last   date;
  v_start  date;
  v_today  date := (now() at time zone 'America/Chicago')::date;
  v_tokens int;
  v_dup    boolean;
begin
  -- Only 5 and 10 are wallet-granting tiers (3 is cosmetic, client-only).
  if p_threshold not in (5, 10) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_threshold');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_subscriber::text, 393));

  -- Verify the streak against the DB — the authoritative anti-cheat gate.
  select play_streak, play_streak_last_day
    into v_streak, v_last
    from public.dc_subscribers
    where id = p_subscriber
    for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_subscriber');
  end if;

  v_streak := coalesce(v_streak, 0);

  -- Must currently satisfy the threshold and have advanced TODAY (Central) — i.e. a
  -- real, current milestone crossing tied to the completion that triggered this call.
  if v_streak < p_threshold or v_last is distinct from v_today then
    return jsonb_build_object('ok', false, 'reason', 'streak_not_qualifying', 'streak', v_streak);
  end if;

  -- No-backfill: the whole run must have started on/after the ship epoch. A pre-ship
  -- streak (started before epoch) is never retroactively rewarded, even as it grows.
  v_start := v_last - (v_streak - 1);
  if v_start < c_epoch then
    return jsonb_build_object('ok', false, 'reason', 'pre_ship_streak', 'streak', v_streak, 'started', v_start);
  end if;

  -- Abuse caps, checked against prior grant rows (server-side):
  --   5-day  → at most once per rolling 30 days
  --   10-day → at most once per calendar week (Central)
  if p_threshold = 5 then
    v_tokens := 1;
    select exists(
      select 1 from public.dc_streak_grants
      where subscriber_id = p_subscriber and threshold = 5
        and created_at > now() - interval '30 days'
    ) into v_dup;
  else
    v_tokens := 3;  -- descoped 10-day (D4): token grant in lieu of brief access
    select exists(
      select 1 from public.dc_streak_grants
      where subscriber_id = p_subscriber and threshold = 10
        and date_trunc('week', (created_at at time zone 'America/Chicago'))
          = date_trunc('week', (now()      at time zone 'America/Chicago'))
    ) into v_dup;
  end if;

  if v_dup then
    return jsonb_build_object('ok', false, 'reason', 'already_granted_in_window', 'threshold', p_threshold);
  end if;

  -- Land the grant on the single Faraday wallet (durable bonus balance).
  insert into public.live_agent_token_ledger (subscriber_id, tier, balance, cycle_month, bonus_balance)
    values (p_subscriber, 'free', 0, date_trunc('month', now())::date, 0)
    on conflict (subscriber_id) do nothing;

  update public.live_agent_token_ledger
    set bonus_balance = bonus_balance + v_tokens, updated_at = now()
    where subscriber_id = p_subscriber;

  insert into public.dc_streak_grants (subscriber_id, threshold, tokens, play_streak_at_grant, grant_date)
    values (p_subscriber, p_threshold, v_tokens, v_streak, v_today);

  return jsonb_build_object('ok', true, 'granted', v_tokens, 'threshold', p_threshold, 'streak', v_streak);
end $$;

revoke all on function public.dc_grant_readiness_reward(uuid, integer) from public, anon, authenticated;

-- 4) Make the Faraday wallet honor the durable bonus balance. Spend bonus FIRST, then
--    the monthly plan balance; let a non-entitled (free) subscriber spend bonus tokens
--    (that is the whole point of the streak reward — real intelligence value). The
--    monthly reset still only touches the plan `balance`; bonus survives.
create or replace function public.live_agent_debit(
  p_subscriber uuid,
  p_cost       integer default 1,
  p_request_id text    default null::text,
  p_question   text    default null::text
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tier text; v_entitled boolean; v_grant int; v_balance int; v_bonus int; v_cycle date;
  v_this_month date := date_trunc('month', now())::date;
  v_effective int; v_from_bonus int; v_from_balance int;
begin
  select l.tier into v_tier from public.live_agent_token_ledger l
    where l.subscriber_id = p_subscriber for update;
  if not found then v_tier := 'free'; end if;

  select p.entitled, p.monthly_tokens into v_entitled, v_grant
    from public.live_agent_plan p where p.tier = v_tier;
  if v_entitled is null then v_entitled := false; v_grant := 0; end if;

  insert into public.live_agent_token_ledger (subscriber_id, tier, balance, cycle_month)
    values (p_subscriber, v_tier, v_grant, v_this_month)
    on conflict (subscriber_id) do nothing;

  select l.balance, l.cycle_month, l.bonus_balance
    into v_balance, v_cycle, v_bonus
    from public.live_agent_token_ledger l where l.subscriber_id = p_subscriber for update;

  -- Monthly plan reset — resets the PLAN balance only; durable bonus survives.
  if v_cycle < v_this_month then
    v_balance := v_grant;
    update public.live_agent_token_ledger
      set balance = v_grant, cycle_month = v_this_month, updated_at = now()
      where subscriber_id = p_subscriber;
  end if;

  v_bonus := coalesce(v_bonus, 0);
  v_effective := v_balance + v_bonus;

  -- Idempotent replay: a retried request_id never double-charges.
  if p_request_id is not null and exists (
    select 1 from public.live_agent_usage u
    where u.subscriber_id = p_subscriber and u.request_id = p_request_id) then
    return jsonb_build_object('ok', true, 'reason', 'duplicate', 'balance', v_effective, 'tier', v_tier, 'entitled', v_entitled);
  end if;

  -- Entitlement gate: entitled plans may spend their plan balance; ANY tier (incl. free)
  -- may spend Intelligence Readiness bonus tokens (FAR-393).
  if not v_entitled and v_bonus < p_cost then
    return jsonb_build_object('ok', false, 'reason', 'not_entitled', 'balance', v_effective, 'tier', v_tier, 'entitled', false);
  end if;

  if v_effective < p_cost then
    return jsonb_build_object('ok', false, 'reason', 'insufficient_tokens', 'balance', v_effective, 'tier', v_tier, 'entitled', v_entitled);
  end if;

  -- Spend bonus first, then plan balance.
  v_from_bonus   := least(v_bonus, p_cost);
  v_from_balance := p_cost - v_from_bonus;

  update public.live_agent_token_ledger
    set bonus_balance = bonus_balance - v_from_bonus,
        balance       = balance - v_from_balance,
        updated_at    = now()
    where subscriber_id = p_subscriber
    returning (balance + bonus_balance) into v_effective;

  insert into public.live_agent_usage (subscriber_id, request_id, question, tokens_charged)
    values (p_subscriber, p_request_id, left(p_question, 500), p_cost);

  return jsonb_build_object('ok', true, 'reason', 'ok', 'balance', v_effective, 'tier', v_tier, 'entitled', v_entitled);
end $$;
