-- CC-06 / FAR-29 — Live Agent entitlement + per-product token meter.
-- ADDITIVE + reversible. Live Agent costs 1 token per answered question.
--
-- Design notes / invariants (mirrors the Jurisdiction Watch token discipline):
--  • The token debit is the ONLY financial guard and is ATOMIC + server-side.
--    Any client-side meter is UX only — never trusted.
--  • Plan grants/entitlement live in `live_agent_plan` (a table), NOT hardcoded
--    in app code, so tiers/limits are tunable without a deploy. Names are
--    PROVISIONAL (FAR-46 meters are DRAFT — do not publish meter values).
--  • Tokens are a monthly cycle with NO rollover (reset on first use in a new
--    calendar month).
--  • Only a refused/un-answered question is free — the caller debits exactly
--    once, after it has decided to answer, and passes a request_id so a retry
--    of the same question never double-charges.
--
-- Reverse:
--   DROP FUNCTION IF EXISTS public.live_agent_debit(uuid, int, text, text);
--   DROP TABLE IF EXISTS public.live_agent_usage;
--   DROP TABLE IF EXISTS public.live_agent_token_ledger;
--   DROP TABLE IF EXISTS public.live_agent_plan;

-- ── Plans (provisional; tune in-table, not in code) ─────────────────────────
CREATE TABLE IF NOT EXISTS public.live_agent_plan (
  tier           text PRIMARY KEY,
  entitled       boolean     NOT NULL DEFAULT false,
  monthly_tokens int         NOT NULL DEFAULT 0,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.live_agent_plan (tier, entitled, monthly_tokens) VALUES
  ('free',   false,   0),   -- not entitled to Live Agent
  ('member', true,   50),   -- provisional grant
  ('pro',    true,  200)    -- provisional grant
ON CONFLICT (tier) DO NOTHING;

-- ── Per-subscriber token ledger (monthly cycle, no rollover) ────────────────
CREATE TABLE IF NOT EXISTS public.live_agent_token_ledger (
  subscriber_id uuid PRIMARY KEY,
  tier          text        NOT NULL DEFAULT 'free' REFERENCES public.live_agent_plan(tier),
  balance       int         NOT NULL DEFAULT 0,
  cycle_month   date        NOT NULL DEFAULT date_trunc('month', now())::date,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ── Usage audit log (also the idempotency key for debits) ───────────────────
CREATE TABLE IF NOT EXISTS public.live_agent_usage (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subscriber_id   uuid        NOT NULL,
  request_id      text,
  asked_at        timestamptz NOT NULL DEFAULT now(),
  question        text,
  grounded        boolean,
  citation_count  int,
  tokens_charged  int,
  retrieval_mode  text
);

-- Idempotency: one charge per (subscriber, request_id). NULL request_ids never
-- collide (each ad-hoc ask is its own row).
CREATE UNIQUE INDEX IF NOT EXISTS live_agent_usage_idem
  ON public.live_agent_usage (subscriber_id, request_id)
  WHERE request_id IS NOT NULL;

-- ── Atomic debit ────────────────────────────────────────────────────────────
-- Returns jsonb: { ok, reason, balance, tier, entitled }.
--   reason ∈ 'ok' | 'not_entitled' | 'insufficient_tokens' | 'duplicate'
-- Steps (all under the row lock taken by the upsert):
--   1. Ensure a ledger row exists; seed balance from the plan grant.
--   2. Roll the monthly cycle (reset balance to the grant on a new month).
--   3. Enforce entitlement (plan.entitled).
--   4. If request_id already charged → 'duplicate' (idempotent no-op, ok=true).
--   5. If balance >= cost → deduct + log usage; else 'insufficient_tokens'.
CREATE OR REPLACE FUNCTION public.live_agent_debit(
  p_subscriber uuid,
  p_cost       int  DEFAULT 1,
  p_request_id text DEFAULT NULL,
  p_question   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tier        text;
  v_entitled    boolean;
  v_grant       int;
  v_balance     int;
  v_cycle       date;
  v_this_month  date := date_trunc('month', now())::date;
BEGIN
  -- Resolve the subscriber's tier (default 'free' if no ledger row yet).
  SELECT l.tier INTO v_tier
  FROM public.live_agent_token_ledger l
  WHERE l.subscriber_id = p_subscriber
  FOR UPDATE;

  IF NOT FOUND THEN
    v_tier := 'free';
  END IF;

  SELECT p.entitled, p.monthly_tokens
    INTO v_entitled, v_grant
  FROM public.live_agent_plan p
  WHERE p.tier = v_tier;

  IF v_entitled IS NULL THEN
    v_entitled := false; v_grant := 0;
  END IF;

  -- Ensure a ledger row, seeded with this cycle's grant.
  INSERT INTO public.live_agent_token_ledger (subscriber_id, tier, balance, cycle_month)
  VALUES (p_subscriber, v_tier, v_grant, v_this_month)
  ON CONFLICT (subscriber_id) DO NOTHING;

  SELECT l.balance, l.cycle_month INTO v_balance, v_cycle
  FROM public.live_agent_token_ledger l
  WHERE l.subscriber_id = p_subscriber
  FOR UPDATE;

  -- Roll the monthly cycle — no rollover.
  IF v_cycle < v_this_month THEN
    v_balance := v_grant;
    UPDATE public.live_agent_token_ledger
    SET balance = v_grant, cycle_month = v_this_month, updated_at = now()
    WHERE subscriber_id = p_subscriber;
  END IF;

  IF NOT v_entitled THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_entitled',
                              'balance', v_balance, 'tier', v_tier, 'entitled', false);
  END IF;

  -- Idempotent replay of a prior charge for the same request.
  IF p_request_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.live_agent_usage u
    WHERE u.subscriber_id = p_subscriber AND u.request_id = p_request_id
  ) THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'duplicate',
                              'balance', v_balance, 'tier', v_tier, 'entitled', true);
  END IF;

  IF v_balance < p_cost THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'insufficient_tokens',
                              'balance', v_balance, 'tier', v_tier, 'entitled', true);
  END IF;

  UPDATE public.live_agent_token_ledger
  SET balance = balance - p_cost, updated_at = now()
  WHERE subscriber_id = p_subscriber
  RETURNING balance INTO v_balance;

  INSERT INTO public.live_agent_usage
    (subscriber_id, request_id, question, tokens_charged)
  VALUES (p_subscriber, p_request_id, left(p_question, 500), p_cost);

  RETURN jsonb_build_object('ok', true, 'reason', 'ok',
                            'balance', v_balance, 'tier', v_tier, 'entitled', true);
END;
$$;

REVOKE ALL ON FUNCTION public.live_agent_debit(uuid, int, text, text) FROM anon, authenticated;
