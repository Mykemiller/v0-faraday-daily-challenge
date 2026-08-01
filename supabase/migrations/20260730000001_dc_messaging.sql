-- Daily Challenge messaging v1: captain → team broadcast + 1:1 direct messages,
-- with block / report / mute safety rails (CC-DC-MESSAGING-1.0).
-- Additive + reversible — five new tables, one trigger, one RPC; nothing existing
-- is altered. RLS is enabled deny-all with ZERO policies on every table, matching
-- the posture of every dc_* table (players hold no Supabase JWT — identity is the
-- custom dc_sessions token — so an auth.uid() policy could never fire and an anon
-- policy would leak private messages). All access is server-side service-role.
-- Applied to prod ycadmmngkdhvpcsrcuaq 2026-07-29 (Myke-approved).

-- ---------------------------------------------------------------------------
-- dc_conversations — one row per thread. Two shapes, enforced by CHECK:
--   team_broadcast: keyed (team_id, season_id); captain writes, members read.
--   direct:         keyed by the ORDERED subscriber pair (pair_low < pair_high).
-- The ordered pair + partial unique index makes "find or create the thread
-- between A and B" a single race-safe upsert (see fn_dc_find_or_create_direct).
-- ---------------------------------------------------------------------------
CREATE TABLE public.dc_conversations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            text NOT NULL CHECK (kind IN ('team_broadcast', 'direct')),
  team_id         uuid REFERENCES public.teams(id) ON DELETE CASCADE,
  season_id       uuid REFERENCES public.seasons(id),
  pair_low        uuid REFERENCES public.dc_subscribers(id) ON DELETE CASCADE,
  pair_high       uuid REFERENCES public.dc_subscribers(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz,
  CONSTRAINT dc_conversations_shape CHECK (
    (kind = 'team_broadcast'
       AND team_id IS NOT NULL AND season_id IS NOT NULL
       AND pair_low IS NULL AND pair_high IS NULL)
    OR
    (kind = 'direct'
       AND team_id IS NULL AND season_id IS NULL
       AND pair_low IS NOT NULL AND pair_high IS NOT NULL
       AND pair_low < pair_high)
  )
);

CREATE UNIQUE INDEX dc_conversations_team_key
  ON public.dc_conversations (team_id, season_id)
  WHERE kind = 'team_broadcast';

CREATE UNIQUE INDEX dc_conversations_pair_key
  ON public.dc_conversations (pair_low, pair_high)
  WHERE kind = 'direct';

COMMENT ON TABLE public.dc_conversations IS
  'DC messaging threads. team_broadcast = one channel per (team, season), captain-write/member-read. direct = one thread per unordered subscriber pair, stored ordered (pair_low < pair_high) so the partial unique index makes find-or-create a single race-safe upsert. Authorization is derived from these columns at request time, never from dc_conversation_members.';

COMMENT ON COLUMN public.dc_conversations.pair_low IS
  'Direct threads only: the uuid-lesser member of the pair. Ordering is canonical (pair_low < pair_high enforced by CHECK) so the pair has exactly one representation and dc_conversations_pair_key can dedupe concurrent creates.';

COMMENT ON COLUMN public.dc_conversations.pair_high IS
  'Direct threads only: the uuid-greater member of the pair. See pair_low.';

-- ---------------------------------------------------------------------------
-- dc_conversation_members — per-viewer read/mute STATE ONLY.
-- ---------------------------------------------------------------------------
CREATE TABLE public.dc_conversation_members (
  conversation_id uuid NOT NULL REFERENCES public.dc_conversations(id) ON DELETE CASCADE,
  subscriber_id   uuid NOT NULL REFERENCES public.dc_subscribers(id) ON DELETE CASCADE,
  last_read_at    timestamptz,
  muted_at        timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, subscriber_id)
);

COMMENT ON TABLE public.dc_conversation_members IS
  'Read/mute STATE ONLY — this table is NEVER the authorization source. Who may see a conversation is derived fresh per request: direct → the viewer is pair_low or pair_high on dc_conversations; team_broadcast → the viewer has a non-pending team_memberships row for (team_id, season_id). Rows here are created lazily on first mark-read/mute, so absence of a row means "member with no state yet", not "not a member" — and presence of a row must never grant access (a player who left the team keeps stale rows but loses visibility).';

COMMENT ON COLUMN public.dc_conversation_members.last_read_at IS
  'High-water mark for unread counts: messages authored by someone else after this instant (and not soft-deleted) are unread. NULL = never opened, everything unread.';

COMMENT ON COLUMN public.dc_conversation_members.muted_at IS
  'Set = muted. Muting only suppresses the conversation''s contribution to the nav unread badge; the thread stays fully readable and writable.';

-- ---------------------------------------------------------------------------
-- dc_messages — append-only bodies; deletion is soft (deleted_at), never DELETE.
-- ---------------------------------------------------------------------------
CREATE TABLE public.dc_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.dc_conversations(id) ON DELETE CASCADE,
  author_id       uuid NOT NULL REFERENCES public.dc_subscribers(id),
  body            text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
  created_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  deleted_by      uuid REFERENCES public.dc_subscribers(id)
);

CREATE INDEX dc_messages_convo_created_idx
  ON public.dc_messages (conversation_id, created_at DESC)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE public.dc_messages IS
  'Plain-text message bodies (1–2000 chars after trim; rendered pre-wrap, never as HTML). Append-only: removal is a soft delete (deleted_at + deleted_by set by the author, or by the current team captain for broadcast messages). The API layer never issues a SQL DELETE — the row must survive for moderation and for dc_message_reports integrity.';

COMMENT ON COLUMN public.dc_messages.deleted_at IS
  'Soft-delete stamp. Set = hidden from every read path (the partial index above skips these rows); the row itself is retained for moderation. Never hard-DELETE.';

-- ---------------------------------------------------------------------------
-- dc_message_blocks — stored one-directionally, ENFORCED bidirectionally.
-- ---------------------------------------------------------------------------
CREATE TABLE public.dc_message_blocks (
  blocker_id uuid NOT NULL REFERENCES public.dc_subscribers(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES public.dc_subscribers(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

CREATE INDEX dc_message_blocks_blocked_idx
  ON public.dc_message_blocks (blocked_id);

COMMENT ON TABLE public.dc_message_blocks IS
  'Player blocks. Stored one row per (blocker → blocked), but the API enforces them BIDIRECTIONALLY: a block in either direction silences the pair''s direct thread both ways (hidden from both inboxes, sends rejected with a non-revealing error). Blocks deliberately do NOT suppress team broadcasts — blocking a teammate must not cut a player off from team announcements.';

-- ---------------------------------------------------------------------------
-- dc_message_reports — player-filed reports for the League Office queue.
-- ---------------------------------------------------------------------------
CREATE TABLE public.dc_message_reports (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id         uuid REFERENCES public.dc_messages(id) ON DELETE SET NULL,
  conversation_id    uuid,
  reporter_id        uuid NOT NULL REFERENCES public.dc_subscribers(id),
  reported_author_id uuid NOT NULL REFERENCES public.dc_subscribers(id),
  body_snapshot      text NOT NULL,
  reason             text,
  status             text NOT NULL DEFAULT 'open'
                       CHECK (status IN ('open', 'reviewed', 'actioned', 'dismissed')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  reviewed_at        timestamptz,
  reviewed_by        text
);

CREATE INDEX dc_message_reports_status_idx
  ON public.dc_message_reports (status, created_at DESC);

COMMENT ON TABLE public.dc_message_reports IS
  'Player-filed message reports, reviewed in the League Office report queue. Evidence is self-contained (body_snapshot + denormalized conversation_id) so a report survives the author soft-deleting — or moderation removing — the message it points at. Reporters are never told a report''s status.';

COMMENT ON COLUMN public.dc_message_reports.body_snapshot IS
  'The message body copied verbatim AT REPORT TIME. The report must remain reviewable even if the author soft-deletes the message afterwards, so the evidence is snapshotted here rather than joined from dc_messages.';

-- conversation_id is deliberately denormalized (no FK): it must survive both
-- message deletion (message_id goes NULL via SET NULL) and any future
-- conversation cleanup, so moderators can still see which thread it came from.

-- ---------------------------------------------------------------------------
-- Trigger: keep dc_conversations.last_message_at correct on every insert, so
-- inbox ordering never depends on the route remembering a second write.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.fn_dc_touch_conversation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  UPDATE public.dc_conversations
     SET last_message_at = NEW.created_at
   WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_dc_touch_conversation
  AFTER INSERT ON public.dc_messages
  FOR EACH ROW EXECUTE FUNCTION public.fn_dc_touch_conversation();

-- ---------------------------------------------------------------------------
-- fn_dc_find_or_create_direct — race-safe find-or-create for a direct thread.
-- One transaction: a two-step find-then-insert in the route can lose a race
-- and create nothing (same reasoning as fn_dc_rotate_live_set). The ordered
-- pair + dc_conversations_pair_key guarantee at most one row per pair; the
-- ON CONFLICT DO NOTHING absorbs the losing side of a concurrent create and
-- the follow-up SELECT returns the winner's row either way.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.fn_dc_find_or_create_direct(p_a uuid, p_b uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_low  uuid;
  v_high uuid;
  v_id   uuid;
BEGIN
  IF p_a IS NULL OR p_b IS NULL THEN
    RAISE EXCEPTION 'fn_dc_find_or_create_direct: null subscriber id';
  END IF;
  IF p_a = p_b THEN
    RAISE EXCEPTION 'fn_dc_find_or_create_direct: cannot open a thread with self';
  END IF;

  IF p_a < p_b THEN
    v_low := p_a; v_high := p_b;
  ELSE
    v_low := p_b; v_high := p_a;
  END IF;

  INSERT INTO public.dc_conversations (kind, pair_low, pair_high)
  VALUES ('direct', v_low, v_high)
  ON CONFLICT (pair_low, pair_high) WHERE kind = 'direct' DO NOTHING;

  SELECT id INTO v_id
    FROM public.dc_conversations
   WHERE kind = 'direct' AND pair_low = v_low AND pair_high = v_high;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.fn_dc_find_or_create_direct(uuid, uuid) IS
  'Race-safe find-or-create of the single direct conversation between two subscribers. Orders the pair canonically, upserts against dc_conversations_pair_key, returns the thread id. Service-role only (deny-all RLS; no grants issued).';

-- ---------------------------------------------------------------------------
-- RLS: enabled, ZERO policies — deny-all, service-role only (decision D5;
-- same posture as lo_broadcasts / dc_daily_signal / every other dc_* table).
-- ---------------------------------------------------------------------------
ALTER TABLE public.dc_conversations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dc_conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dc_messages            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dc_message_blocks      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dc_message_reports     ENABLE ROW LEVEL SECURITY;
