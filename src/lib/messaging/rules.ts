// Pure messaging rules for DC messaging v1 (CC-DC-MESSAGING-1.0).
// No I/O, no next imports — everything here is unit-testable with node --test.
// The API routes in /api/messages/* consume these; the SQL constraints in
// 20260730000001_dc_messaging.sql are the mirror of normalizeBody/orderPair
// and the two must stay in agreement.

export const MAX_BODY_CHARS = 2000;
export const MAX_BROADCASTS_PER_TEAM_PER_DAY = 10;
export const MAX_NEW_THREADS_PER_DAY = 10; // blunts spray-spam under open DM reach
export const MAX_DMS_PER_DAY = 200;

export const DAY_MS = 24 * 60 * 60 * 1000;

export type NormalizedBody =
  | { ok: true; body: string }
  | { ok: false; error: 'empty' | 'too_long' };

export function normalizeBody(raw: unknown): NormalizedBody {
  if (typeof raw !== 'string') return { ok: false, error: 'empty' };
  const body = raw.trim();
  if (body.length === 0) return { ok: false, error: 'empty' };
  if (body.length > MAX_BODY_CHARS) return { ok: false, error: 'too_long' };
  return { ok: true, body };
}

/**
 * Canonical uuid ordering for the direct pair. Must match the SQL constraint
 * (pair_low < pair_high, Postgres uuid comparison). Postgres compares uuids
 * byte-wise, which for the canonical lowercase hex form is the same as JS
 * string comparison — so both ids are lowercased before comparing.
 */
export function orderPair(a: string, b: string): { low: string; high: string } {
  const an = a.toLowerCase();
  const bn = b.toLowerCase();
  return an < bn ? { low: an, high: bn } : { low: bn, high: an };
}

/**
 * How many of `timestamps` fall inside the trailing window ending at `nowMs`.
 * A timestamp exactly `windowMs` old is OUTSIDE the window (expired) — the
 * rate limit releases at the boundary, never a moment later.
 */
export function countInWindow(
  timestamps: string[],
  nowMs: number,
  windowMs: number = DAY_MS
): number {
  let n = 0;
  for (const t of timestamps) {
    const ms = Date.parse(t);
    if (Number.isFinite(ms) && ms > nowMs - windowMs && ms <= nowMs) n++;
  }
  return n;
}

/** Unread = messages after last_read_at, authored by someone else, not deleted. */
export function countUnread(
  messages: { created_at: string; author_id: string; deleted_at: string | null }[],
  lastReadAt: string | null,
  viewerId: string
): number {
  const floor = lastReadAt ? Date.parse(lastReadAt) : -Infinity;
  let n = 0;
  for (const m of messages) {
    if (m.deleted_at !== null) continue;
    if (m.author_id === viewerId) continue;
    if (Date.parse(m.created_at) > floor) n++;
  }
  return n;
}

/** Bidirectional: a block in EITHER direction silences the pair. */
export function isPairBlocked(
  blocks: { blocker_id: string; blocked_id: string }[],
  a: string,
  b: string
): boolean {
  return blocks.some(
    bl =>
      (bl.blocker_id === a && bl.blocked_id === b) ||
      (bl.blocker_id === b && bl.blocked_id === a)
  );
}
