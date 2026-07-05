// League Office — Tier 2 audited write path (server-only).
//
// THE trust mechanic: every staff mutation goes through executeAction(), which
// (1) captures a before-snapshot, (2) performs the change via service-role
// PostgREST, and (3) writes exactly one lo_audit_log row with the REQUIRED
// reason. "Revert" re-applies the before-snapshot and writes a linked reversal
// row — history is append-only, never deleted.

import { type Svc } from "./service";

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://ycadmmngkdhvpcsrcuaq.supabase.co";

// ── low-level PostgREST writes ───────────────────────────────────────────────
async function rq(s: Svc, path: string, init: RequestInit): Promise<unknown[] | null> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      ...init,
      headers: { ...s.headers, Prefer: "return=representation", ...(init.headers || {}) },
      cache: "no-store",
    });
    if (!r.ok) return null;
    const j = await r.json().catch(() => []);
    return Array.isArray(j) ? j : [];
  } catch {
    return null;
  }
}
const getOne = async (s: Svc, path: string): Promise<Record<string, unknown> | null> => {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: s.headers, cache: "no-store" });
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    return Array.isArray(j) ? (j[0] ?? null) : null;
  } catch {
    return null;
  }
};
const patch = (s: Svc, table: string, filter: string, body: Record<string, unknown>) =>
  rq(s, `${table}?${filter}`, { method: "PATCH", body: JSON.stringify(body) });
const del = (s: Svc, table: string, filter: string) =>
  rq(s, `${table}?${filter}`, { method: "DELETE" });
const insert = (s: Svc, table: string, body: Record<string, unknown>) =>
  rq(s, table, { method: "POST", body: JSON.stringify(body) });

// ── audit ────────────────────────────────────────────────────────────────────
export type AuditRow = {
  id: string;
  at: string;
  staff_email: string;
  domain: string;
  action: string;
  reason: string;
  target_type: string | null;
  target_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reversible: boolean;
  reverts_id: string | null;
  reverted_by: string | null;
};

async function writeAudit(
  s: Svc,
  row: Omit<AuditRow, "id" | "at" | "reverts_id" | "reverted_by"> & { reverts_id?: string | null }
): Promise<string | null> {
  const out = await insert(s, "lo_audit_log", { ...row });
  const created = (out?.[0] as { id?: string } | undefined)?.id;
  return created ?? null;
}

export async function listAudit(s: Svc, domain?: string): Promise<AuditRow[]> {
  const filter = domain && domain !== "all" ? `domain=eq.${encodeURIComponent(domain)}&` : "";
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/lo_audit_log?${filter}select=*&order=at.desc&limit=200`,
    { headers: s.headers, cache: "no-store" }
  );
  if (!r.ok) return [];
  const j = await r.json().catch(() => []);
  return Array.isArray(j) ? (j as AuditRow[]) : [];
}

// ── action dispatch ──────────────────────────────────────────────────────────
export type ActionInput = {
  action: string;
  reason: string;
  subscriberId?: string;
  membershipId?: string;
  teamId?: string;
  captainSubscriberId?: string;
  name?: string;
  auditId?: string;
};

export type ActionResult = { ok: boolean; message: string };

export async function executeAction(
  s: Svc,
  staffEmail: string,
  input: ActionInput
): Promise<ActionResult> {
  const reason = (input.reason || "").trim();
  if (!reason) return { ok: false, message: "A reason is required." };

  const log = (
    domain: string,
    action: string,
    targetType: string | null,
    targetId: string | null,
    before: Record<string, unknown> | null,
    after: Record<string, unknown> | null,
    reversible: boolean,
    revertsId?: string | null
  ) => writeAudit(s, { staff_email: staffEmail, domain, action, reason, target_type: targetType, target_id: targetId, before, after, reversible, reverts_id: revertsId ?? null });

  switch (input.action) {
    case "subscriber.pause":
    case "subscriber.rejoin": {
      if (!input.subscriberId) return { ok: false, message: "Missing subscriber." };
      const active = input.action === "subscriber.rejoin";
      const before = await getOne(s, `dc_subscribers?id=eq.${input.subscriberId}&select=active`);
      const res = await patch(s, "dc_subscribers", `id=eq.${input.subscriberId}`, { active });
      if (!res) return { ok: false, message: "Update failed." };
      await log("subscribers", input.action, "dc_subscriber", input.subscriberId, before, { active }, true);
      return { ok: true, message: active ? "Account reinstated — logged to Audit Log." : "Account paused — logged to Audit Log." };
    }

    case "membership.approve": {
      if (!input.membershipId) return { ok: false, message: "Missing membership." };
      const before = await getOne(s, `team_memberships?id=eq.${input.membershipId}&select=pending,team_id,subscriber_id`);
      const res = await patch(s, "team_memberships", `id=eq.${input.membershipId}`, { pending: false });
      if (!res) return { ok: false, message: "Approve failed." };
      await log("teams", "membership.approve", "team_membership", input.membershipId, before, { pending: false }, true);
      return { ok: true, message: "Membership approved — logged to Audit Log." };
    }

    case "membership.deny": {
      if (!input.membershipId) return { ok: false, message: "Missing membership." };
      const before = await getOne(s, `team_memberships?id=eq.${input.membershipId}&select=pending,team_id,subscriber_id`);
      const res = await del(s, "team_memberships", `id=eq.${input.membershipId}`);
      if (!res) return { ok: false, message: "Deny failed." };
      await log("teams", "membership.deny", "team_membership", input.membershipId, before, null, false);
      return { ok: true, message: "Request denied — logged to Audit Log." };
    }

    case "team.rename": {
      if (!input.teamId || !input.name?.trim()) return { ok: false, message: "Missing team or name." };
      const before = await getOne(s, `teams?id=eq.${input.teamId}&select=name`);
      const res = await patch(s, "teams", `id=eq.${input.teamId}`, { name: input.name.trim() });
      if (!res) return { ok: false, message: "Rename failed." };
      await log("teams", "team.rename", "team", input.teamId, before, { name: input.name.trim() }, true);
      return { ok: true, message: "Team renamed — logged to Audit Log." };
    }

    case "team.reassign_captain": {
      if (!input.teamId || !input.captainSubscriberId) return { ok: false, message: "Missing team or captain." };
      const before = await getOne(s, `teams?id=eq.${input.teamId}&select=captain_id`);
      const res = await patch(s, "teams", `id=eq.${input.teamId}`, { captain_id: input.captainSubscriberId });
      if (!res) return { ok: false, message: "Reassign failed." };
      await log("teams", "team.reassign_captain", "team", input.teamId, before, { captain_id: input.captainSubscriberId }, true);
      return { ok: true, message: "Captain reassigned — logged to Audit Log." };
    }

    case "audit.revert":
      return revertAction(s, staffEmail, input.auditId, reason);

    default:
      return { ok: false, message: `Unknown action: ${input.action}` };
  }
}

// ── revert ───────────────────────────────────────────────────────────────────
async function revertAction(
  s: Svc,
  staffEmail: string,
  auditId: string | undefined,
  reason: string
): Promise<ActionResult> {
  if (!auditId) return { ok: false, message: "Missing audit id." };
  const orig = await getOne(s, `lo_audit_log?id=eq.${auditId}&select=*`) as AuditRow | null;
  if (!orig) return { ok: false, message: "Audit row not found." };
  if (!orig.reversible) return { ok: false, message: "This action is not reversible." };
  if (orig.reverted_by) return { ok: false, message: "Already reverted." };
  if (!orig.before || !orig.target_type || !orig.target_id)
    return { ok: false, message: "No before-snapshot to restore." };

  // Re-apply the before snapshot to the same target.
  const map: Record<string, { table: string; col: string }> = {
    dc_subscriber: { table: "dc_subscribers", col: "id" },
    team: { table: "teams", col: "id" },
    team_membership: { table: "team_memberships", col: "id" },
  };
  const t = map[orig.target_type];
  if (!t) return { ok: false, message: "Unsupported revert target." };

  const res = await patch(s, t.table, `${t.col}=eq.${orig.target_id}`, orig.before);
  if (!res) return { ok: false, message: "Revert write failed." };

  const reversalId = await writeAudit(s, {
    staff_email: staffEmail,
    domain: orig.domain,
    action: `revert:${orig.action}`,
    reason,
    target_type: orig.target_type,
    target_id: orig.target_id,
    before: orig.after,
    after: orig.before,
    reversible: false,
    reverts_id: orig.id,
  });
  await patch(s, "lo_audit_log", `id=eq.${orig.id}`, { reverted_by: reversalId });
  return { ok: true, message: "Reverted — linked reversal logged to Audit Log." };
}
