// League Office — Tier 2 audited write path (server-only).
//
// THE trust mechanic: every staff mutation goes through executeAction(), which
// (1) captures a before-snapshot, (2) performs the change via service-role
// PostgREST, and (3) writes exactly one lo_audit_log row with the REQUIRED
// reason. "Revert" re-applies the before-snapshot and writes a linked reversal
// row — history is append-only, never deleted.

import { type Svc } from "./service";
import {
  validateResetReason,
  rpcErrorMessage,
  resetSuccessMessage,
} from "./scoring-reset-logic.mjs";
import { countActivePlayers, isSeverity } from "./broadcasts";
import {
  createGame,
  changeLifecycle,
  updateGame,
  setSeasonAssignment,
  type LogFn as GameLogFn,
} from "./game-library-write";
import { htmlToText, safeHref, sanitizeBroadcastBody, sanitizeHtml } from "./sanitize-html";
import {
  startGenerationRun,
  approvePilot,
  approveSeasonPuzzles,
  type GenLogFn,
} from "./generation-write";

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

/** The single active season's id, or null if none is active. Roster placement is
 *  season-scoped (team_memberships.season_id is NOT NULL) and the League Office
 *  works against "the" active season, exactly like the rest of the console. */
async function resolveActiveSeasonId(s: Svc): Promise<string | null> {
  const row = await getOne(s, `seasons?status=eq.active&select=id&order=starts_on.desc&limit=1`);
  return (row as { id?: string } | null)?.id ?? null;
}

/** teams.code is citext-UNIQUE with no default, so a created team needs a code.
 *  Derive a readable slug from the name and append -2, -3, … until it is free. */
async function uniqueTeamCode(s: Svc, name: string): Promise<string> {
  const base =
    name.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 28) || "TEAM";
  const rows = await fetch(`${SUPABASE_URL}/rest/v1/teams?select=code`, { headers: s.headers, cache: "no-store" })
    .then((r) => (r.ok ? r.json() : []))
    .catch(() => []);
  const taken = new Set(
    (Array.isArray(rows) ? rows : []).map((r: { code?: string }) => (r.code || "").toUpperCase())
  );
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base.slice(0, 24)}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base.slice(0, 20)}-${Date.now()}`;
}

function slugCode(name: string, fallback: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 28) || fallback;
}
async function freeCode(base: string, taken: Set<string>): Promise<string> {
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base.slice(0, 24)}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base.slice(0, 20)}-${Date.now()}`;
}

/** leagues.code is text-UNIQUE (global). */
async function uniqueLeagueCode(s: Svc, name: string): Promise<string> {
  const rows = await fetch(`${SUPABASE_URL}/rest/v1/leagues?select=code`, { headers: s.headers, cache: "no-store" })
    .then((r) => (r.ok ? r.json() : []))
    .catch(() => []);
  const taken = new Set((Array.isArray(rows) ? rows : []).map((r: { code?: string }) => (r.code || "").toUpperCase()));
  return freeCode(slugCode(name, "LEAGUE"), taken);
}

/** conferences.code is UNIQUE per (league_id, code). */
async function uniqueConferenceCode(s: Svc, leagueId: string, name: string): Promise<string> {
  const rows = await fetch(
    `${SUPABASE_URL}/rest/v1/conferences?league_id=eq.${encodeURIComponent(leagueId)}&select=code`,
    { headers: s.headers, cache: "no-store" }
  )
    .then((r) => (r.ok ? r.json() : []))
    .catch(() => []);
  const taken = new Set((Array.isArray(rows) ? rows : []).map((r: { code?: string }) => (r.code || "").toUpperCase()));
  return freeCode(slugCode(name, "CONF"), taken);
}

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
  leagueId?: string;
  conferenceId?: string;
  captainSubscriberId?: string;
  name?: string;
  auditId?: string;
  // Announcements (lo_broadcasts)
  broadcastId?: string;
  bodyHtml?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  severity?: string;
  expiresAt?: string;
  // Game Library (domain 'game_library')
  gameId?: string;
  seasonId?: string;
  lifecycleTo?: string;
  displayName?: string;
  category?: string;
  description?: string;
  patch?: unknown;
};

/** Cap on the CTA button label — it renders inside a single banner row. */
const CTA_LABEL_MAX = 60;

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

    // ── Team lifecycle (create / archive / restore) ──────────────────────────
    // A commissioner-created team is INDEPENDENT with no captain and no
    // conference (conference/league assignment is a separate surface). `code` is
    // citext-UNIQUE, so it is generated from the name and de-duplicated here.
    case "team.create": {
      const name = (input.name || "").trim();
      if (!name) return { ok: false, message: "A team name is required." };
      const leagueRow = await getOne(s, `leagues?code=eq.INDEPENDENT&select=id`);
      const league_id = (leagueRow as { id?: string } | null)?.id ?? null;
      const code = await uniqueTeamCode(s, name);
      const created = await insert(s, "teams", {
        name,
        code,
        created_by_email: staffEmail,
        league_id,
        // captain_id / conference_id left null — assigned via their own actions.
      });
      const id = (created?.[0] as { id?: string } | undefined)?.id;
      if (!id) return { ok: false, message: "Create failed — nothing was written." };
      await log("teams", "team.create", "team", id, null, { name, code, league_id }, false);
      return { ok: true, message: `Team “${name}” created — logged to Audit Log.` };
    }

    case "team.archive": {
      if (!input.teamId) return { ok: false, message: "Missing team." };
      const before = await getOne(s, `teams?id=eq.${input.teamId}&select=is_active,archived_at`);
      if (!before) return { ok: false, message: "Team not found." };
      if (before.is_active === false) return { ok: false, message: "That team is already disbanded." };
      const archived_at = new Date().toISOString();
      const res = await patch(s, "teams", `id=eq.${input.teamId}`, { is_active: false, archived_at });
      if (!res) return { ok: false, message: "Disband failed." };
      // Reversible: the revert path restores the before-snapshot (is_active + archived_at).
      await log("teams", "team.archive", "team", input.teamId, before, { is_active: false, archived_at }, true);
      return { ok: true, message: "Team disbanded — its roster and history are preserved. Logged to Audit Log." };
    }

    case "team.restore": {
      if (!input.teamId) return { ok: false, message: "Missing team." };
      const before = await getOne(s, `teams?id=eq.${input.teamId}&select=is_active,archived_at`);
      if (!before) return { ok: false, message: "Team not found." };
      if (before.is_active !== false) return { ok: false, message: "That team is already active." };
      const res = await patch(s, "teams", `id=eq.${input.teamId}`, { is_active: true, archived_at: null });
      if (!res) return { ok: false, message: "Restore failed." };
      await log("teams", "team.restore", "team", input.teamId, before, { is_active: true, archived_at: null }, true);
      return { ok: true, message: "Team restored — logged to Audit Log." };
    }

    // ── Roster placement (add a subscriber · move to another team) ────────────
    // Both scope to the ACTIVE season and INSERT (never UPDATE) so the
    // team_conference_memberships autofill trigger fires for the destination.
    case "membership.add": {
      if (!input.teamId || !input.subscriberId) return { ok: false, message: "Missing team or subscriber." };
      const seasonId = await resolveActiveSeasonId(s);
      if (!seasonId) return { ok: false, message: "No active season — cannot place a member." };
      const existing = await getOne(
        s,
        `team_memberships?team_id=eq.${input.teamId}&subscriber_id=eq.${input.subscriberId}&season_id=eq.${seasonId}&select=id`
      );
      if (existing) return { ok: false, message: "That subscriber is already on this team for the active season." };
      const created = await insert(s, "team_memberships", {
        team_id: input.teamId,
        subscriber_id: input.subscriberId,
        season_id: seasonId,
        pending: false,
        role: "player",
      });
      const id = (created?.[0] as { id?: string } | undefined)?.id;
      if (!id) return { ok: false, message: "Add failed — nothing was written." };
      await log("teams", "membership.add", "team_membership", id, null, { team_id: input.teamId, subscriber_id: input.subscriberId, season_id: seasonId }, false);
      return { ok: true, message: "Subscriber added to the team — logged to Audit Log." };
    }

    case "membership.move": {
      // membershipId = the row being moved; teamId = destination team.
      if (!input.membershipId || !input.teamId) return { ok: false, message: "Missing membership or destination team." };
      const before = await getOne(
        s,
        `team_memberships?id=eq.${input.membershipId}&select=team_id,subscriber_id,season_id,pending,role`
      );
      if (!before) return { ok: false, message: "Membership not found." };
      if (before.team_id === input.teamId) return { ok: false, message: "That member is already on the destination team." };
      const dupe = await getOne(
        s,
        `team_memberships?team_id=eq.${input.teamId}&subscriber_id=eq.${before.subscriber_id}&season_id=eq.${before.season_id}&pending=eq.${before.pending}&select=id`
      );
      if (dupe) return { ok: false, message: "That subscriber is already on the destination team for this season." };
      // Delete the old row, then insert into the destination so the autofill
      // trigger fires. Season/role/pending are carried over unchanged.
      const removed = await del(s, "team_memberships", `id=eq.${input.membershipId}`);
      if (!removed) return { ok: false, message: "Move failed — the member was not changed." };
      const created = await insert(s, "team_memberships", {
        team_id: input.teamId,
        subscriber_id: before.subscriber_id,
        season_id: before.season_id,
        pending: before.pending,
        role: before.role,
      });
      const id = (created?.[0] as { id?: string } | undefined)?.id;
      if (!id) {
        // Best-effort re-add to the origin so the member is never dropped on a failed move.
        await insert(s, "team_memberships", { team_id: before.team_id, subscriber_id: before.subscriber_id, season_id: before.season_id, pending: before.pending, role: before.role });
        return { ok: false, message: "Move failed — the member was returned to their team." };
      }
      await log("teams", "membership.move", "team_membership", id, before, { team_id: input.teamId, subscriber_id: before.subscriber_id, season_id: before.season_id }, false);
      return { ok: true, message: "Member moved — logged to Audit Log." };
    }

    // ── Leagues & Conferences (domain 'leagues') ─────────────────────────────
    // Create/archive/restore the leagues + conferences tables, and assign a team
    // to a conference via the teams.conference_id / league_id FK columns. The
    // trigger-derived team_conference_memberships table is NEVER touched here.
    case "league.create": {
      const name = (input.name || "").trim();
      if (!name) return { ok: false, message: "A league name is required." };
      const code = await uniqueLeagueCode(s, name);
      const created = await insert(s, "leagues", { name, code, league_type: "public", owner_email: staffEmail });
      const id = (created?.[0] as { id?: string } | undefined)?.id;
      if (!id) return { ok: false, message: "Create failed — nothing was written." };
      await log("leagues", "league.create", "league", id, null, { name, code }, false);
      return { ok: true, message: `League “${name}” created — logged to Audit Log.` };
    }

    case "league.archive":
    case "league.restore": {
      if (!input.leagueId) return { ok: false, message: "Missing league." };
      const archiving = input.action === "league.archive";
      const before = await getOne(s, `leagues?id=eq.${input.leagueId}&select=is_active,archived_at`);
      if (!before) return { ok: false, message: "League not found." };
      if (archiving && before.is_active === false) return { ok: false, message: "That league is already archived." };
      if (!archiving && before.is_active !== false) return { ok: false, message: "That league is already active." };
      const after = archiving ? { is_active: false, archived_at: new Date().toISOString() } : { is_active: true, archived_at: null };
      const res = await patch(s, "leagues", `id=eq.${input.leagueId}`, after);
      if (!res) return { ok: false, message: archiving ? "Archive failed." : "Restore failed." };
      await log("leagues", input.action, "league", input.leagueId, before, after, true);
      return { ok: true, message: archiving ? "League archived — logged to Audit Log." : "League restored — logged to Audit Log." };
    }

    case "conference.create": {
      const name = (input.name || "").trim();
      if (!input.leagueId) return { ok: false, message: "Missing league." };
      if (!name) return { ok: false, message: "A conference name is required." };
      const code = await uniqueConferenceCode(s, input.leagueId, name);
      // type defaults to 'public' (org/private are assigned via a later editor).
      const created = await insert(s, "conferences", { league_id: input.leagueId, name, code, type: "public" });
      const id = (created?.[0] as { id?: string } | undefined)?.id;
      if (!id) return { ok: false, message: "Create failed — nothing was written." };
      await log("leagues", "conference.create", "conference", id, null, { league_id: input.leagueId, name, code }, false);
      return { ok: true, message: `Conference “${name}” created — logged to Audit Log.` };
    }

    case "conference.archive":
    case "conference.restore": {
      if (!input.conferenceId) return { ok: false, message: "Missing conference." };
      const archiving = input.action === "conference.archive";
      const before = await getOne(s, `conferences?id=eq.${input.conferenceId}&select=is_active,archived_at`);
      if (!before) return { ok: false, message: "Conference not found." };
      if (archiving && before.is_active === false) return { ok: false, message: "That conference is already archived." };
      if (!archiving && before.is_active !== false) return { ok: false, message: "That conference is already active." };
      const after = archiving ? { is_active: false, archived_at: new Date().toISOString() } : { is_active: true, archived_at: null };
      const res = await patch(s, "conferences", `id=eq.${input.conferenceId}`, after);
      if (!res) return { ok: false, message: archiving ? "Archive failed." : "Restore failed." };
      await log("leagues", input.action, "conference", input.conferenceId, before, after, true);
      return { ok: true, message: archiving ? "Conference archived — logged to Audit Log." : "Conference restored — logged to Audit Log." };
    }

    case "team.set_conference": {
      // Assign a team to a conference; the team's league is set to the
      // conference's league so the two FK columns stay consistent.
      if (!input.teamId || !input.conferenceId) return { ok: false, message: "Missing team or conference." };
      const conf = await getOne(s, `conferences?id=eq.${input.conferenceId}&select=league_id,name`);
      if (!conf) return { ok: false, message: "Conference not found." };
      const before = await getOne(s, `teams?id=eq.${input.teamId}&select=conference_id,league_id`);
      const after = { conference_id: input.conferenceId, league_id: conf.league_id };
      const res = await patch(s, "teams", `id=eq.${input.teamId}`, after);
      if (!res) return { ok: false, message: "Assignment failed." };
      await log("leagues", "team.set_conference", "team", input.teamId, before, after, true);
      return { ok: true, message: "Team assigned to conference — logged to Audit Log." };
    }

    case "team.clear_conference": {
      // Remove a team from its conference (independent). league_id is left as-is.
      if (!input.teamId) return { ok: false, message: "Missing team." };
      const before = await getOne(s, `teams?id=eq.${input.teamId}&select=conference_id,league_id`);
      if (!before) return { ok: false, message: "Team not found." };
      const res = await patch(s, "teams", `id=eq.${input.teamId}`, { conference_id: null });
      if (!res) return { ok: false, message: "Update failed." };
      await log("leagues", "team.clear_conference", "team", input.teamId, before, { conference_id: null }, true);
      return { ok: true, message: "Team removed from its conference — logged to Audit Log." };
    }

    // ── Announcements ────────────────────────────────────────────────────────
    // The body is sanitized HERE, server-side, before it is ever persisted —
    // lo_broadcasts.body_html always holds the sanitized output, never the raw
    // payload, and body_text is derived from that sanitized html.
    case "broadcast.send": {
      const sanitized = sanitizeBroadcastBody(input.bodyHtml);
      if (!sanitized.ok) return { ok: false, message: sanitized.message };

      const cta = normalizeCta(input.ctaLabel, input.ctaUrl);
      if (!cta.ok) return { ok: false, message: cta.message };

      const expires = normalizeExpiry(input.expiresAt);
      if (!expires.ok) return { ok: false, message: expires.message };

      const severity = isSeverity(input.severity) ? input.severity : "info";
      const recipients = await countActivePlayers(s);

      const created = await insert(s, "lo_broadcasts", {
        body_html: sanitized.body.html,
        body_text: sanitized.body.text,
        cta_label: cta.label,
        cta_url: cta.url,
        severity,
        expires_at: expires.value,
        created_by_email: staffEmail,
      });
      const id = (created?.[0] as { id?: string } | undefined)?.id;
      if (!id) return { ok: false, message: "Send failed — nothing was published." };

      await log("comms", "send_broadcast", "broadcast", id, null, {
        body_html: sanitized.body.html,
        body_text: sanitized.body.text,
        cta_label: cta.label,
        cta_url: cta.url,
        severity,
        expires_at: expires.value,
        recipient_count: recipients,
      }, true);

      return {
        ok: true,
        message: `Broadcast sent to ${recipients.toLocaleString()} active player${recipients === 1 ? "" : "s"} — logged to Audit Log.`,
      };
    }

    case "broadcast.revoke":
      return revokeBroadcast(s, staffEmail, input.broadcastId, reason);

    case "scoring.reset_season":
      return resetSeasonScoring(s, staffEmail, reason);

    case "audit.revert":
      return revertAction(s, staffEmail, input.auditId, reason);

    // ── Game Library (CC-LO-GAME-LIBRARY-1.0) ────────────────────────────────
    // Each case delegates to game-library-write.ts but keeps the audit row here,
    // via the same `log` closure every other action uses — so the mandatory
    // reason, the staff email and the one-row-per-write rule are identical.
    case "game.create":
    case "game.lifecycle_change":
    case "game.update":
    case "game.reorder":
    case "game.season_assign":
    case "game.season_unassign": {
      const gameLog: GameLogFn = (action, targetId, before, after, reversible, targetType) =>
        log("game_library", action, targetType ?? "game", targetId, before, after, reversible);

      switch (input.action) {
        case "game.create":
          return createGame(s, gameLog, input);
        case "game.lifecycle_change":
          return changeLifecycle(s, gameLog, { ...input, reason });
        case "game.update":
        case "game.reorder":
          return updateGame(s, gameLog, { ...input, action: input.action });
        default:
          return setSeasonAssignment(s, gameLog, staffEmail, {
            ...input,
            reason,
            assign: input.action === "game.season_assign",
          });
      }
    }

    // ── Season generation (CC-FARADAY-LEAGUE-1.0 Part D) ─────────────────────
    // Each case re-derives the server-side GENERATABLE status before writing;
    // the audit row stays here via the same `log` closure (domain 'seasons').
    case "season.generate_pilot":
    case "season.generate_full":
    case "season.approve_pilot":
    case "season.approve_puzzles": {
      const genLog: GenLogFn = (action, targetType, targetId, before, after, reversible) =>
        log("seasons", action, targetType, targetId, before, after, reversible);

      switch (input.action) {
        case "season.generate_pilot":
          return startGenerationRun(s, genLog, { seasonId: input.seasonId, kind: "pilot" });
        case "season.generate_full":
          return startGenerationRun(s, genLog, { seasonId: input.seasonId, kind: "full" });
        case "season.approve_pilot":
          return approvePilot(s, genLog, { seasonId: input.seasonId });
        default:
          return approveSeasonPuzzles(s, genLog, staffEmail, { seasonId: input.seasonId });
      }
    }

    default:
      return { ok: false, message: `Unknown action: ${input.action}` };
  }
}

// ── scoring: reset the active season to zero ─────────────────────────────────
// Delegates the whole operation to the lo_reset_season_scoring() RPC so every
// mutation + the audit row run in ONE transaction (atomic rollback on any
// failure). The RPC resolves the active season itself and writes its own audit
// row — do NOT also call writeAudit() here (that would double-log). Pure
// decisions (reason validation, error/success copy) live in scoring-reset-logic.
export async function resetSeasonScoring(
  s: Svc,
  staffEmail: string,
  reason: string
): Promise<ActionResult> {
  const v = validateResetReason(reason);
  if (!v.ok) return { ok: false, message: v.message ?? "A reason is required." };

  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/lo_reset_season_scoring`, {
      method: "POST",
      headers: { ...s.headers, "Content-Type": "application/json" },
      body: JSON.stringify({ p_staff_email: staffEmail, p_reason: v.reason }),
      cache: "no-store",
    });
    const j = await r.json().catch(() => null);
    if (!r.ok) return { ok: false, message: rpcErrorMessage(j) };
    return { ok: true, message: resetSuccessMessage(j ?? {}) };
  } catch {
    return { ok: false, message: "Reset failed — network error. Nothing was changed." };
  }
}

// ── announcements: validation helpers ────────────────────────────────────────
type Checked<T> = { ok: true; value: T } | { ok: false; message: string };

/** The CTA is all-or-nothing, its label is forced to plain text, and its URL
 *  goes through the SAME scheme allowlist as an inline link. */
function normalizeCta(
  rawLabel: string | undefined,
  rawUrl: string | undefined
): { ok: true; label: string | null; url: string | null } | { ok: false; message: string } {
  const label = htmlToText(sanitizeHtml((rawLabel ?? "").trim())).replace(/\s+/g, " ").trim();
  const url = (rawUrl ?? "").trim();
  if (!label && !url) return { ok: true, label: null, url: null };
  if (!label || !url)
    return { ok: false, message: "A call-to-action needs both a label and a URL — or neither." };
  if (label.length > CTA_LABEL_MAX)
    return { ok: false, message: `The call-to-action label is too long (max ${CTA_LABEL_MAX} characters).` };
  const safe = safeHref(url);
  if (!safe)
    return { ok: false, message: "The call-to-action URL must start with https:// or mailto:." };
  return { ok: true, label, url: safe };
}

function normalizeExpiry(raw: string | undefined): Checked<string | null> {
  const v = (raw ?? "").trim();
  if (!v) return { ok: true, value: null }; // null = runs until revoked
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return { ok: false, message: "That expiry date isn't valid." };
  if (d.getTime() <= Date.now())
    return { ok: false, message: "The expiry must be in the future — that broadcast would never show." };
  return { ok: true, value: d.toISOString() };
}

/** Revoke = set revoked_at. The banner disappears for every player on next load
 *  (the player query filters `revoked_at is null`). The revoke audit row LINKS to
 *  the original send row via reverts_id, and stamps reverted_by back on the send
 *  row so the Audit Log renders it as "Reverted" rather than offering a second,
 *  meaningless revert. Shared by the Announcements page's Revoke button and by a
 *  Revert clicked on the send row in the Audit Log. */
async function revokeBroadcast(
  s: Svc,
  staffEmail: string,
  broadcastId: string | undefined,
  reason: string
): Promise<ActionResult> {
  if (!broadcastId) return { ok: false, message: "Missing broadcast." };

  const before = await getOne(
    s,
    `lo_broadcasts?id=eq.${broadcastId}&select=revoked_at,body_text,severity,starts_at,expires_at`
  );
  if (!before) return { ok: false, message: "Broadcast not found." };
  if (before.revoked_at) return { ok: false, message: "That broadcast is already revoked." };

  const revoked_at = new Date().toISOString();
  const res = await patch(s, "lo_broadcasts", `id=eq.${broadcastId}`, { revoked_at });
  if (!res) return { ok: false, message: "Revoke failed — the broadcast is still live." };

  const sendRow = await getOne(
    s,
    `lo_audit_log?target_type=eq.broadcast&target_id=eq.${broadcastId}&action=eq.send_broadcast&select=id&order=at.asc&limit=1`
  );
  const sendAuditId = (sendRow as { id?: string } | null)?.id ?? null;

  const revokeAuditId = await writeAudit(s, {
    staff_email: staffEmail,
    domain: "comms",
    action: "revoke_broadcast",
    reason,
    target_type: "broadcast",
    target_id: broadcastId,
    before,
    after: { revoked_at },
    reversible: false,
    reverts_id: sendAuditId,
  });
  if (sendAuditId && revokeAuditId)
    await patch(s, "lo_audit_log", `id=eq.${sendAuditId}`, { reverted_by: revokeAuditId });

  return { ok: true, message: "Broadcast revoked — the banner disappears for all players." };
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

  // A broadcast send has no before-snapshot to restore — its reversal is a
  // revoke. Handled before the snapshot check so the Audit Log's Revert button
  // does the right thing on a send row instead of reporting an unsupported target.
  if (orig.target_type === "broadcast" && orig.target_id)
    return revokeBroadcast(s, staffEmail, orig.target_id, reason);

  if (!orig.before || !orig.target_type || !orig.target_id)
    return { ok: false, message: "No before-snapshot to restore." };

  // Re-apply the before snapshot to the same target.
  const map: Record<string, { table: string; col: string }> = {
    dc_subscriber: { table: "dc_subscribers", col: "id" },
    team: { table: "teams", col: "id" },
    team_membership: { table: "team_memberships", col: "id" },
    league: { table: "leagues", col: "id" },
    conference: { table: "conferences", col: "id" },
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
