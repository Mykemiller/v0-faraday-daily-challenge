// League Office — Announcements pure logic.
//
// Split out from broadcasts.ts (which pulls in the server-only service client)
// so the visibility rules that back the ticket's acceptance criteria are unit
// testable, following the scoring-reset-logic precedent.

export const SEVERITIES = ["info", "warning", "celebration"] as const;
export type Severity = (typeof SEVERITIES)[number];

export function isSeverity(v: unknown): v is Severity {
  return typeof v === "string" && (SEVERITIES as readonly string[]).includes(v);
}

export type BroadcastStatus = "live" | "scheduled" | "expired" | "revoked";

/** Lifecycle label for the staff table. `now` is injectable so it is testable. */
export function broadcastStatus(
  row: { starts_at: string; expires_at: string | null; revoked_at: string | null },
  now: Date = new Date()
): BroadcastStatus {
  if (row.revoked_at) return "revoked";
  if (row.expires_at && new Date(row.expires_at) <= now) return "expired";
  if (new Date(row.starts_at) > now) return "scheduled";
  return "live";
}

/**
 * THE player visibility rule, as PostgREST filters. A broadcast reaches a player
 * only when it is not revoked, has started, has not expired, and this player has
 * not dismissed it. Ordering + limit 1 (appended by the caller) is what makes
 * "exactly one banner" true even with several live broadcasts — deliberately a
 * query rule, not a database constraint, so staff can stage a future-dated one.
 */
export function buildLiveBroadcastFilters(
  nowIso: string,
  dismissedIds: string[]
): string[] {
  const filters = [
    "revoked_at=is.null",
    `starts_at=lte.${nowIso}`,
    `or=(expires_at.is.null,expires_at.gt.${nowIso})`,
  ];
  // Values are uuids straight out of lo_broadcast_dismissals.broadcast_id, so
  // the bare PostgREST list form is unambiguous — no quoting needed.
  if (dismissedIds.length > 0) filters.push(`id=not.in.(${dismissedIds.join(",")})`);
  return filters;
}

/** The ordering that makes the newest live broadcast the one that shows. */
export const LIVE_BROADCAST_ORDER = "order=starts_at.desc&limit=1";
