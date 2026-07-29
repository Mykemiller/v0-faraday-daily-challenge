// League Office — Announcements (lo_broadcasts) data access.
//
// Two readers live here:
//   • listBroadcasts / countActivePlayers — STAFF side, called from the
//     /league-office/announcements Server Component behind requireStaff().
//   • liveBroadcastFor — PLAYER side, called from /api/broadcast. This is THE
//     query that enforces the ticket's visibility rules, since RLS on these
//     tables is deny-all (players hold no Supabase identity — see the migration).
//
// The write path (send / revoke) lives in write.ts with every other Tier 2
// mutation, so each one lands in lo_audit_log with a mandatory reason.

import { type Svc, q } from "./service";
import {
  LIVE_BROADCAST_ORDER,
  buildLiveBroadcastFilters,
  type Severity,
} from "./broadcast-logic";

export {
  SEVERITIES,
  isSeverity,
  broadcastStatus,
  type Severity,
  type BroadcastStatus,
} from "./broadcast-logic";

export type BroadcastRow = {
  id: string;
  body_html: string;
  body_text: string;
  cta_label: string | null;
  cta_url: string | null;
  severity: Severity;
  starts_at: string;
  expires_at: string | null;
  created_by_email: string;
  created_at: string;
  revoked_at: string | null;
};

/** What a player receives — never the staff/authoring metadata. */
export type PlayerBroadcast = {
  id: string;
  bodyHtml: string;
  bodyText: string;
  ctaLabel: string | null;
  ctaUrl: string | null;
  severity: Severity;
};

/** Every broadcast ever sent, newest first — the staff history table. */
export async function listBroadcasts(s: Svc, limit = 100): Promise<BroadcastRow[]> {
  return q<BroadcastRow>(
    s,
    `lo_broadcasts?select=*&order=created_at.desc&limit=${limit}`
  );
}

/** The audience. Resolved at read time — there is no fan-out table. */
export async function countActivePlayers(s: Svc): Promise<number> {
  try {
    const r = await fetch(`${s.base}/dc_subscribers?active=eq.true&select=id`, {
      headers: { ...s.headers, Prefer: "count=exact", Range: "0-0" },
      cache: "no-store",
    });
    if (!r.ok) return 0;
    // PostgREST reports the exact count in Content-Range: "0-0/<total>".
    const total = (r.headers.get("content-range") || "").split("/")[1];
    const n = Number.parseInt(total, 10);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

/**
 * THE player query. Returns the single most recent broadcast that is
 * live (not revoked · started · not expired) AND not dismissed by this player,
 * or null. Exactly one banner, enforced here by `order + limit 1` — never by a
 * database constraint, so staff can stage a future-dated broadcast.
 *
 * `subscriberId` comes from a validated dc_sessions token, never from the
 * request body. Anonymous callers never reach this function.
 */
export async function liveBroadcastFor(
  s: Svc,
  subscriberId: string
): Promise<PlayerBroadcast | null> {
  const dismissed = await q<{ broadcast_id: string }>(
    s,
    `lo_broadcast_dismissals?subscriber_id=eq.${encodeURIComponent(subscriberId)}&select=broadcast_id`
  );

  const filters = buildLiveBroadcastFilters(
    new Date().toISOString(),
    dismissed.map((d) => d.broadcast_id)
  );

  const rows = await q<BroadcastRow>(
    s,
    `lo_broadcasts?${filters.join("&")}&select=id,body_html,body_text,cta_label,cta_url,severity&${LIVE_BROADCAST_ORDER}`
  );
  const row = rows[0];
  if (!row) return null;

  return {
    id: row.id,
    bodyHtml: row.body_html,
    bodyText: row.body_text,
    ctaLabel: row.cta_label,
    ctaUrl: row.cta_url,
    severity: row.severity,
  };
}
