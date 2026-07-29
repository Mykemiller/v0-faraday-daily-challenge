-- League Office — Announcements (in-app broadcast banner to all active players).
--
-- Table names stay lo_broadcasts / lo_broadcast_dismissals regardless of the
-- user-facing "Announcements" nav label — "broadcast" is the internal/table/action
-- vocabulary and the send-button verb.
--
-- AUDIENCE: resolved at READ time as "all active players" (dc_subscribers.active).
-- There is deliberately NO per-recipient fan-out table — a broadcast is one row.
--
-- RLS POSTURE (Phase-0 finding, approved 2026-07-29): deny-all, no policies —
-- the same posture as lo_audit_log / dc_streak_grants / dc_daily_page_content.
-- Daily Challenge players do NOT hold Supabase JWTs (identity is the custom
-- dc_sessions token table resolved server-side with the service role), so an
-- `auth.uid()`-scoped policy could never fire for a player and an anon SELECT
-- policy would expose staged/future-dated broadcasts to direct anon-key reads.
-- The ticket's intent — players see only live, non-revoked, non-expired rows and
-- may only dismiss for THEMSELVES — is enforced in /api/broadcast, which applies
-- the live-window filter as the query and takes subscriber_id from the validated
-- session (never from the request body).
--
-- ADDITIVE + reversible.
-- ROLLBACK (reverse this migration):
--   DROP TABLE IF EXISTS public.lo_broadcast_dismissals;
--   DROP TABLE IF EXISTS public.lo_broadcasts;

CREATE TABLE IF NOT EXISTS public.lo_broadcasts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  body_html        text NOT NULL,          -- sanitized server-side on write (strict allowlist)
  body_text        text NOT NULL,          -- plaintext fallback, DERIVED from the sanitized html
  cta_label        text,
  cta_url          text,                   -- https: / mailto: only (scheme allowlist on write)
  severity         text NOT NULL DEFAULT 'info'
                     CHECK (severity IN ('info', 'warning', 'celebration')),
  starts_at        timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz,            -- null = until revoked
  created_by_email text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  revoked_at       timestamptz             -- set by revoke_broadcast; banner disappears for everyone
);

COMMENT ON TABLE public.lo_broadcasts IS
  'League Office Announcements: in-app banner broadcasts to all active players. body_html is sanitized server-side (allowlist: p,br,strong,b,em,i,u,ul,ol,li,a + a[href,title], https/mailto only). Exactly one banner shows at a time — enforced by the read query (order by starts_at desc, limit 1), NOT by a constraint, so staff can stage a future-dated broadcast. Service-role only (RLS deny-all).';

-- The player read path: live window, newest first.
CREATE INDEX IF NOT EXISTS lo_broadcasts_live_idx
  ON public.lo_broadcasts (starts_at DESC)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS public.lo_broadcast_dismissals (
  broadcast_id  uuid NOT NULL REFERENCES public.lo_broadcasts(id) ON DELETE CASCADE,
  subscriber_id uuid NOT NULL REFERENCES public.dc_subscribers(id) ON DELETE CASCADE,
  dismissed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (broadcast_id, subscriber_id)
);

COMMENT ON TABLE public.lo_broadcast_dismissals IS
  'One row per (broadcast, player) dismissal. Dismissal is PERMANENT and per-player — a dismissed broadcast is never resurfaced for that subscriber. Anonymous visitors never write here. Service-role only (RLS deny-all).';

-- Player read filters "not dismissed by me" by subscriber, so index that side.
CREATE INDEX IF NOT EXISTS lo_broadcast_dismissals_subscriber_idx
  ON public.lo_broadcast_dismissals (subscriber_id);

-- Deny-all: enable RLS and add NO policies. The service role bypasses RLS, so the
-- server routes keep full access while anon/authenticated get nothing.
ALTER TABLE public.lo_broadcasts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lo_broadcast_dismissals ENABLE ROW LEVEL SECURITY;
