-- League Office — lo_audit_log: the console's core trust mechanic.
--
-- EVERY staff override (pause a subscriber, correct a score, approve a trade,
-- resync puzzles, …) writes exactly one row here: who did it, what they did, and
-- the REQUIRED reason captured in the confirm modal. "Revert" writes a second,
-- linked reversal row (reverts_id) rather than deleting history.
--
-- Additive + reversible. Tier 1 (read-only screens) does NOT depend on this
-- table — it is authored ahead of the Tier 2 write-actions so the schema is
-- ready. RLS is enabled with NO policies: anon/authenticated are denied entirely
-- and only server-side service-role code (the /api/league-office/* routes) can
-- read or write it, matching the live_agent_* deny-all posture.
--
-- ROLLBACK (reverse this migration):
--   DROP TABLE IF EXISTS public.lo_audit_log;

CREATE TABLE IF NOT EXISTS public.lo_audit_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  at           timestamptz NOT NULL DEFAULT now(),
  staff_email  text NOT NULL,                       -- authed staff actor (allowlist)
  domain       text NOT NULL,                        -- subscribers | teams | seasons | trading | puzzles | …
  action       text NOT NULL,                        -- short human label of the mutation
  reason       text NOT NULL CHECK (length(btrim(reason)) > 0),  -- confirm-modal reason (required)
  target_type  text,                                 -- e.g. 'dc_subscriber', 'team', 'season'
  target_id    text,                                 -- id of the affected row (text: uuid/bigint/slug)
  before       jsonb,                                -- snapshot pre-change (where available)
  after        jsonb,                                -- snapshot post-change (where available)
  reversible   boolean NOT NULL DEFAULT false,
  reverts_id   uuid REFERENCES public.lo_audit_log(id) ON DELETE SET NULL, -- set on a reversal row
  reverted_by  uuid REFERENCES public.lo_audit_log(id) ON DELETE SET NULL  -- set on the original when reverted
);

COMMENT ON TABLE public.lo_audit_log IS
  'League Office append-only audit trail. One row per staff override; reason is mandatory. Reversals are linked rows, never deletes. Service-role-only (RLS deny-all).';

CREATE INDEX IF NOT EXISTS lo_audit_log_at_idx     ON public.lo_audit_log (at DESC);
CREATE INDEX IF NOT EXISTS lo_audit_log_domain_idx ON public.lo_audit_log (domain, at DESC);
CREATE INDEX IF NOT EXISTS lo_audit_log_target_idx ON public.lo_audit_log (target_type, target_id);

-- Deny-all: enable RLS and add NO policies. The service role bypasses RLS, so the
-- server routes keep full access while anon/authenticated get nothing.
ALTER TABLE public.lo_audit_log ENABLE ROW LEVEL SECURITY;
