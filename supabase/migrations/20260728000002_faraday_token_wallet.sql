-- FAR-393 — Faraday Token wallet (generic, cross-storefront intelligence currency).
-- ADDITIVE + reversible. Home of the Intelligence Readiness streak rewards.
--
-- Context (see docs/far393-intelligence-readiness/phase0-findings.md): the two
-- existing token systems are unsuitable homes for a Daily Challenge streak
-- reward — `token_transactions` is the Jurisdiction Watch ledger (FK'd to the
-- EMPTY `subscribers` table, disjoint from `dc_subscribers`), and
-- `live_agent_token_ledger` is Live-Agent-specific. Per Myke (2026-07-28) the
-- 5-day reward pays out a GENERIC "Faraday Token" usable at any Faraday
-- storefront. This migration creates that wallet, keyed to the canonical Daily
-- Challenge identity (`dc_subscribers.id`, the id behind every dc_session).
--
-- Invariants (mirrors the JW / Live Agent token discipline):
--  • The grant is server-side + atomic and NEVER trusts a client-reported
--    streak — the RPC re-reads dc_subscribers.play_streak before crediting.
--  • Balance is mutated ONLY by the SECURITY DEFINER RPCs here (no trigger, to
--    match the codebase's explicit-RPC convention — nothing double-counts).
--  • The audit trail (`faraday_token_transactions`) is append-only; the ledger
--    balance is the running sum the RPCs maintain.
--  • Grants are idempotent (unique ref_id per milestone event) AND rate-capped
--    (5-day reward: once per 30 days per subscriber) — abuse control lives in
--    the DB, not the client.
--  • RLS deny-all / service-role only (service role bypasses RLS). No anon or
--    authenticated grants — the app writes via the service-role Next routes /
--    edge functions, exactly like the other token surfaces.
--
-- SCOPE: this migration is the GRANT (credit) side only. Cross-storefront
-- redemption (spend) is a separate platform integration (out of FAR-393); the
-- schema is spend-ready (negative `delta`, `kind='spend'`, `product_key`) so a
-- later ticket can add a redeem RPC without a migration change.
--
-- Reverse:
--   DROP FUNCTION IF EXISTS public.faraday_token_grant_streak(uuid, int, date, int);
--   DROP FUNCTION IF EXISTS public.faraday_token_balance(uuid);
--   DROP TABLE IF EXISTS public.faraday_token_transactions;
--   DROP TABLE IF EXISTS public.faraday_token_ledger;

-- ── Per-subscriber balance (running total; no monthly cycle — these are earned,
--    not a monthly allowance, so they do NOT reset/roll over) ────────────────
CREATE TABLE IF NOT EXISTS public.faraday_token_ledger (
  subscriber_id uuid PRIMARY KEY
                REFERENCES public.dc_subscribers(id) ON DELETE CASCADE,
  balance       int         NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ── Append-only transaction audit. delta > 0 = credit (grant), < 0 = spend. ──
CREATE TABLE IF NOT EXISTS public.faraday_token_transactions (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subscriber_id uuid        NOT NULL REFERENCES public.dc_subscribers(id) ON DELETE CASCADE,
  delta         int         NOT NULL CHECK (delta <> 0),
  kind          text        NOT NULL CHECK (kind IN ('streak_grant', 'spend', 'adjustment')),
  milestone     text,        -- e.g. 'readiness_5day' — the cap/dedup key for grants
  product_key   text,        -- which storefront redeemed (spend side; NULL for grants)
  ref_id        text,        -- audit link back to the triggering event (idempotency key)
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Idempotency: a given milestone EVENT (subscriber + ref_id) inserts at most
-- once. NULL ref_ids never collide (each ad-hoc adjustment is its own row).
CREATE UNIQUE INDEX IF NOT EXISTS faraday_token_tx_ref_idem
  ON public.faraday_token_transactions (subscriber_id, ref_id)
  WHERE ref_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS faraday_token_tx_sub_kind_time
  ON public.faraday_token_transactions (subscriber_id, kind, created_at DESC);

-- ── RLS: deny-all (service role bypasses). No policies by design. ────────────
ALTER TABLE public.faraday_token_ledger        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.faraday_token_transactions  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.faraday_token_ledger        FROM anon, authenticated;
REVOKE ALL ON public.faraday_token_transactions  FROM anon, authenticated;

-- ── Read helper (STABLE) ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.faraday_token_balance(p_subscriber uuid)
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT balance FROM public.faraday_token_ledger
                   WHERE subscriber_id = p_subscriber), 0);
$$;

-- ── Streak-milestone grant ──────────────────────────────────────────────────
-- Idempotent + capped credit of Faraday Tokens for an Intelligence Readiness
-- milestone. Returns jsonb: { ok, reason, amount, balance, milestone, ref_id }.
--   reason ∈ 'granted' | 'no_milestone' | 'not_current' | 'capped' | 'duplicate'
--
-- Only the 5-day tier grants today (3-day is display-only; 10-day is deferred).
-- The RPC is the financial guard: it re-reads dc_subscribers to confirm the
-- streak is real AND current (play_streak_last_day = p_play_date) — a client
-- can never mint tokens by reporting a fake streak. The caller
-- (complete-puzzle) passes the freshly-computed streak + Central play date.
CREATE OR REPLACE FUNCTION public.faraday_token_grant_streak(
  p_subscriber uuid,
  p_streak     int,
  p_play_date  date,
  p_amount     int DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_milestone   text;
  v_ref_id      text;
  v_cap_days    int;
  v_db_streak   int;
  v_db_last_day date;
  v_balance     int;
  v_rowcount    int := 0;
BEGIN
  -- Map streak → milestone. Only 5 pays out today.
  IF p_streak = 5 THEN
    v_milestone := 'readiness_5day';
    v_cap_days  := 30;                       -- once per 30 days per subscriber
  ELSE
    RETURN jsonb_build_object('ok', false, 'reason', 'no_milestone');
  END IF;

  IF p_amount IS NULL OR p_amount < 1 THEN
    p_amount := 1;
  END IF;

  v_ref_id := 'readiness:' || p_subscriber::text || ':' || p_play_date::text || ':' || p_streak::text;

  -- Financial guard: the grant condition is verified against the DB, never the
  -- caller's word. Require the stored streak to actually be >= the milestone AND
  -- current for the given day (lazy-reset safe — a stale streak from days ago
  -- fails the play_streak_last_day check).
  SELECT play_streak, play_streak_last_day
    INTO v_db_streak, v_db_last_day
  FROM public.dc_subscribers
  WHERE id = p_subscriber
  FOR UPDATE;

  IF NOT FOUND OR v_db_streak IS NULL OR v_db_streak < p_streak OR v_db_last_day IS DISTINCT FROM p_play_date THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_current',
      'balance', public.faraday_token_balance(p_subscriber));
  END IF;

  -- Rate cap: no second 5-day grant within the rolling window.
  IF EXISTS (
    SELECT 1 FROM public.faraday_token_transactions
    WHERE subscriber_id = p_subscriber
      AND kind = 'streak_grant'
      AND milestone = v_milestone
      AND created_at > now() - make_interval(days => v_cap_days)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'capped',
      'balance', public.faraday_token_balance(p_subscriber));
  END IF;

  -- Idempotent insert of the audit row (unique on subscriber_id, ref_id).
  INSERT INTO public.faraday_token_transactions (subscriber_id, delta, kind, milestone, ref_id)
  VALUES (p_subscriber, p_amount, 'streak_grant', v_milestone, v_ref_id)
  ON CONFLICT (subscriber_id, ref_id) DO NOTHING;

  GET DIAGNOSTICS v_rowcount = ROW_COUNT;
  IF v_rowcount = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'duplicate',
      'balance', public.faraday_token_balance(p_subscriber));
  END IF;

  -- Credit the ledger atomically (row created if absent).
  INSERT INTO public.faraday_token_ledger (subscriber_id, balance, updated_at)
  VALUES (p_subscriber, p_amount, now())
  ON CONFLICT (subscriber_id)
  DO UPDATE SET balance = public.faraday_token_ledger.balance + EXCLUDED.balance,
                updated_at = now()
  RETURNING balance INTO v_balance;

  RETURN jsonb_build_object('ok', true, 'reason', 'granted',
    'amount', p_amount, 'balance', v_balance,
    'milestone', v_milestone, 'ref_id', v_ref_id);
END;
$$;

-- Service-role only (mirrors the JW / Live Agent posture).
REVOKE ALL ON FUNCTION public.faraday_token_grant_streak(uuid, int, date, int) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.faraday_token_balance(uuid)                        FROM anon, authenticated;
