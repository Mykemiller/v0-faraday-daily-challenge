// Teams API — search teams + read/write player's season-scoped team memberships.
//
// GET /api/teams                        → all teams (max 50) + the season's teamCap
// GET /api/teams?q=search               → list teams matching query (max 50)
// GET /api/teams?scope=my&token=...     → player's current memberships + pending
//                                         + teamCap / maxTeamSize
// POST /api/teams                       → upsert memberships (respects Free Agency gate)
//   body: { token, team_ids: string[], season_id: string }
//
// ⚠️ Every POST path here writes `team_memberships` DIRECTLY over service-role
// PostgREST — it does not go through the team_join / team_leave RPCs. The playoff
// roster freeze added in migration 20260802120000 lives in those RPCs, so it does
// NOT cover this route: the guards below are the matching fence, using the same
// predicate from the same pure module. Add a guard to any NEW write path here.
//
// CC-DC-TEAM-CAP-FROM-CONFIG-1.0: the per-player team cap and the maximum team
// size come from the season's effective config via `@/lib/seasons/team-rules`,
// never from a constant here. Every cap decision on this route goes through
// that module's pure predicates so the API, the DB RPC and the UI copy agree.

import { fetchSeasonRules, rosterMoveGuard } from '@/lib/league-playoffs/server';
import { SEASON_PLAYOFF_COLUMNS } from '@/lib/league-playoffs/server';
import { memberCountsPath, tallyMemberCounts } from '@/lib/league-office/member-counts';
import { resolveSeasonFor } from '@/lib/seasons/resolve';
import {
  TEAM_FULL_CODE,
  TEAM_LIMIT_CODE,
  type TeamRules,
  canJoinAnotherTeam,
  isTeamFull,
  isTeamSetAllowed,
  teamFullMessage,
  teamLimitMessage,
  teamRulesFor,
} from '@/lib/seasons/team-rules';

const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://ycadmmngkdhvpcsrcuaq.supabase.co';

export const dynamic = 'force-dynamic';

function svcHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };
}

async function resolveSubscriber(token: string): Promise<string | null> {
  const h = svcHeaders();
  if (!h) return null;
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/dc_sessions?token=eq.${encodeURIComponent(token)}&select=subscriber_id,expires_at`,
    { headers: h, cache: 'no-store' }
  );
  if (!r.ok) return null;
  const rows = await r.json().catch(() => null);
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return null;
  if (row.expires_at && new Date(row.expires_at) < new Date()) return null;
  return row.subscriber_id ?? null;
}

/** The 400 a blocked join returns. `teamCap` is on the wire so the client can
 *  say the season's number instead of guessing 5. */
function teamLimitResponse(rules: TeamRules): Response {
  return Response.json(
    {
      error: TEAM_LIMIT_CODE,
      message: teamLimitMessage(rules.maxTeamsPerPlayer),
      teamCap: rules.maxTeamsPerPlayer,
    },
    { status: 400 }
  );
}

/** Distinct CONFIRMED members each of `teamIds` holds in this season.
 *
 *  COUNT(DISTINCT subscriber_id), never a row count: `team_memberships` is
 *  season-keyed and one person can own several rows (CC-LO-TEAM-COUNTS-1.0).
 *  Reuses the League Office path so the cap and the console agree on who counts
 *  (left_at IS NULL, pending bucketed separately, no `active` filter).
 */
async function confirmedMemberCounts(
  h: Record<string, string>,
  seasonId: string,
  teamIds: string[]
): Promise<(teamId: string) => number> {
  if (teamIds.length === 0) return () => 0;
  const inList = teamIds.map(encodeURIComponent).join(',');
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/${memberCountsPath(seasonId)}&team_id=in.(${inList})`,
    { headers: h, cache: 'no-store' }
  ).catch(() => null);
  const rows = r && r.ok ? await r.json().catch(() => []) : [];
  return tallyMemberCounts(Array.isArray(rows) ? rows : []).members;
}

export async function GET(request: Request) {
  const h = svcHeaders();
  if (!h) return Response.json({ error: 'not_configured' }, { status: 500 });

  const { searchParams } = new URL(request.url);
  const scope = searchParams.get('scope');
  const q = searchParams.get('q') ?? '';
  const token = searchParams.get('token') ?? '';

  if (scope === 'my') {
    if (!token) return Response.json({ error: 'missing_token' }, { status: 401 });
    const subscriberId = await resolveSubscriber(token);
    if (!subscriberId) return Response.json({ error: 'invalid_session' }, { status: 401 });

    // THIS subscriber's season (CC-LO-CONCURRENT-SEASONS-1.0).
    const seasonId = (await resolveSeasonFor(h, subscriberId))?.id ?? null;
    if (!seasonId) return Response.json({ memberships: [] });

    // The cap travels with the payload the account screen and the picker
    // already fetch, so no surface has to hardcode 5 to render its copy.
    const myRules = await teamRulesFor(h, seasonId);

    const memR = await fetch(
      `${SUPABASE_URL}/rest/v1/team_memberships?subscriber_id=eq.${subscriberId}&season_id=eq.${seasonId}&select=team_id,pending,teams(id,name)`,
      { headers: h, cache: 'no-store' }
    );
    const memberships: Array<{ team_id: string; pending: boolean; teams?: { id: string; name: string } }> =
      memR.ok ? await memR.json().catch(() => []) : [];
    const teams = memberships.map(m => ({
      team_id: m.team_id,
      team_name: m.teams?.name ?? '',
      pending: m.pending,
    }));
    return Response.json({
      teams,
      season_id: seasonId,
      teamCap: myRules.maxTeamsPerPlayer,
      maxTeamSize: myRules.maxTeamSize,
    });
  }

  // Search teams by name (default)
  const filter = q
    ? `&name=ilike.*${encodeURIComponent(q)}*`
    : '';
  const teamsR = await fetch(
    `${SUPABASE_URL}/rest/v1/teams?select=id,name&order=name.asc&limit=50${filter}`,
    { headers: h, cache: 'no-store' }
  );
  const teams = teamsR.ok ? await teamsR.json().catch(() => []) : [];

  // OTPGate's team step runs before the player holds anything, so it reads this
  // branch anonymously: resolve the DEFAULT season's cap (CC-LO-CONCURRENT-
  // SEASONS-1.0 — `resolveSeasonFor(h, null)`, never a status=active pick).
  //
  // Only on the UNFILTERED listing. This branch is unauthenticated and both
  // pickers re-query it on every keystroke; two extra round-trips per
  // character would be a poor trade for a number that cannot change mid-search.
  // Every caller loads the unfiltered list first, so the cap always arrives,
  // and a client that somehow does not get it keeps its previous value.
  if (q) return Response.json({ teams });

  const searchSeasonId = (await resolveSeasonFor(h, null))?.id ?? null;
  const searchRules = await teamRulesFor(h, searchSeasonId);
  return Response.json({
    teams,
    teamCap: searchRules.maxTeamsPerPlayer,
    maxTeamSize: searchRules.maxTeamSize,
  });
}

export async function POST(request: Request) {
  const h = svcHeaders();
  if (!h) return Response.json({ error: 'not_configured' }, { status: 500 });

  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return Response.json({ error: 'invalid_body' }, { status: 400 }); }

  const token = typeof body.token === 'string' ? body.token.trim() : '';
  const action = typeof body.action === 'string' ? body.action : 'upsert';
  const seasonId = typeof body.season_id === 'string' ? body.season_id : null;

  if (!token) return Response.json({ error: 'missing_token' }, { status: 401 });

  // ── Join a team via a durable invite token (team page "Invite / Share") ──────
  // Resolves the joiner's season itself (the invite link carries no season_id) and
  // adds an immediate, non-pending membership, honouring the season's configured
  // team cap and maximum team size and the season lock. Idempotent:
  // already-a-member is a success no-op.
  if (action === 'join_by_token') {
    const joinToken = typeof body.join_token === 'string' ? body.join_token.trim() : '';
    if (!joinToken) return Response.json({ error: 'missing_join_token' }, { status: 400 });

    const subscriberId = await resolveSubscriber(token);
    if (!subscriberId) return Response.json({ error: 'invalid_session' }, { status: 401 });

    // The joiner's season (CC-LO-CONCURRENT-SEASONS-1.0). The invite link
    // carries no season_id; the joiner's own in-scope membership (or the
    // platform default season) decides which season the join lands in.
    const season = await resolveSeasonFor(h, subscriberId);
    if (!season) return Response.json({ error: 'no_active_season' }, { status: 404 });
    if (season.locked_at && new Date() > new Date(season.locked_at)) {
      return Response.json({ error: 'season_locked' }, { status: 403 });
    }
    // NOTE: the roster guard is deliberately NOT here. It needs to know whether
    // this is the player's FIRST team this season (which is always allowed), and
    // that is only known after the membership fetch below.

    // Resolve the team by its invite token
    const teamR = await fetch(
      `${SUPABASE_URL}/rest/v1/teams?join_token=eq.${encodeURIComponent(joinToken)}&select=id,name&limit=1`,
      { headers: h, cache: 'no-store' }
    );
    const teamRows = teamR.ok ? await teamR.json().catch(() => []) : [];
    const team = Array.isArray(teamRows) ? teamRows[0] : null;
    if (!team) return Response.json({ error: 'invalid_invite' }, { status: 404 });

    // Current memberships — cap + already-member check
    const curR = await fetch(
      `${SUPABASE_URL}/rest/v1/team_memberships?subscriber_id=eq.${subscriberId}&season_id=eq.${season.id}&select=team_id`,
      { headers: h, cache: 'no-store' }
    );
    const curRows: Array<{ team_id: string }> = curR.ok ? await curR.json().catch(() => []) : [];
    if (curRows.some(r => r.team_id === team.id)) {
      return Response.json({ ok: true, team_id: team.id, team_name: team.name, already_member: true });
    }
    // The season's own cap, not a constant (CC-DC-TEAM-CAP-FROM-CONFIG-1.0).
    const inviteTeamRules = await teamRulesFor(h, season.id);
    const heldHere = new Set(curRows.map(r => r.team_id)).size;
    if (!canJoinAnotherTeam(heldHere, inviteTeamRules)) {
      return teamLimitResponse(inviteTeamRules);
    }

    // And the team's own size limit. Distinct confirmed members in THIS season.
    if (inviteTeamRules.maxTeamSize != null) {
      const counts = await confirmedMemberCounts(h, season.id, [team.id]);
      if (isTeamFull(counts(team.id), inviteTeamRules)) {
        return Response.json(
          {
            error: TEAM_FULL_CODE,
            message: teamFullMessage(inviteTeamRules.maxTeamSize),
            maxTeamSize: inviteTeamRules.maxTeamSize,
          },
          { status: 400 }
        );
      }
    }

    // Freeze → config lock → late-join / switch flags → windows, in that
    // precedence (see canMoveRoster). A player holding no team yet is joining
    // for the first time, so `allow_late_join` is what governs them — an invite
    // should never be dead on arrival for a newcomer the season still wants.
    const inviteRules = await fetchSeasonRules(h, season.id);
    const blocked = rosterMoveGuard(season, {
      isFirstJoin: curRows.length === 0,
      rules: inviteRules,
    });
    if (blocked) return blocked;

    const insR = await fetch(`${SUPABASE_URL}/rest/v1/team_memberships`, {
      method: 'POST',
      headers: { ...h, Prefer: 'return=minimal' },
      body: JSON.stringify([{ subscriber_id: subscriberId, team_id: team.id, season_id: season.id, pending: false }]),
    });
    if (!insR.ok) {
      const err = await insR.text();
      console.error('team_memberships join_by_token failed', err);
      return Response.json({ error: 'join_failed' }, { status: 500 });
    }
    return Response.json({ ok: true, team_id: team.id, team_name: team.name });
  }

  if (!seasonId) return Response.json({ error: 'missing_season_id' }, { status: 400 });

  const subscriberId = await resolveSubscriber(token);
  if (!subscriberId) return Response.json({ error: 'invalid_session' }, { status: 401 });

  // Fetch season details (needed for both actions)
  const seasonR = await fetch(
    `${SUPABASE_URL}/rest/v1/seasons?id=eq.${seasonId}` +
      `&select=${SEASON_PLAYOFF_COLUMNS},free_agency_start&limit=1`,
    { headers: h, cache: 'no-store' }
  );
  const seasonRows = await seasonR.json().catch(() => null);
  const season = Array.isArray(seasonRows) ? seasonRows[0] : null;
  if (!season) return Response.json({ error: 'season_not_found' }, { status: 404 });

  const isLocked = season.locked_at && new Date() > new Date(season.locked_at);
  if (isLocked) return Response.json({ error: 'season_locked' }, { status: 403 });

  // The player's current membership set, read ONCE here because both remaining
  // actions need it: `create` (to check the cap and whether this is a first
  // join) and the upsert (to diff desired against current).
  const heldR = await fetch(
    `${SUPABASE_URL}/rest/v1/team_memberships?subscriber_id=eq.${subscriberId}&season_id=eq.${seasonId}&select=team_id`,
    { headers: h, cache: 'no-store' }
  );
  const heldRows: Array<{ team_id: string }> = heldR.ok ? await heldR.json().catch(() => []) : [];
  const heldTeamIds = Array.from(new Set(heldRows.map(r => r.team_id)));

  // The League Office knobs in force right now. Resolved once and passed to
  // every guard below so two writes in one request cannot see different rules.
  const rules = await fetchSeasonRules(h, seasonId);

  // The roster SIZE knobs, from the same effective config
  // (CC-DC-TEAM-CAP-FROM-CONFIG-1.0). Resolved once here for the same reason
  // `rules` is: two writes in one request must not see different caps.
  const teamRules = await teamRulesFor(h, seasonId);

  // Playoff freeze THEN trading windows — covers BOTH remaining actions below
  // (`create`, which self-joins the new team, and the default membership upsert,
  // which is how a player joins AND leaves from the pickers). Placed once here
  // so neither path can be added to later without inheriting the guard.
  //
  // `create` is a first join only when the player holds nothing yet. The UPSERT
  // is the one exception to "guard once here": its exemption depends on the
  // diff (a no-op save must never 403, and a first join through the picker is
  // allowed), so it re-guards itself immediately after computing that diff.
  // Every other action — now and later — is gated here.
  if (action !== 'upsert') {
    const frozenGuard = rosterMoveGuard(season, {
      isFirstJoin: heldTeamIds.length === 0 && action === 'create',
      rules,
    });
    if (frozenGuard) return frozenGuard;
  }
  // Joins are immediate — the Free Agency deferral (pending) has been retired.
  // Players may hold up to `teamRules.maxTeamsPerPlayer` teams and edits take
  // effect right away.
  const pending = false;

  // ── Create a new team and auto-join it ──────────────────────────────────────
  if (action === 'create') {
    const teamName = typeof body.team_name === 'string' ? body.team_name.trim() : '';
    if (!teamName || teamName.length < 2 || teamName.length > 80) {
      return Response.json({ error: 'invalid_team_name' }, { status: 400 });
    }

    // Guard membership cap — reuses the set already read above (one read, not
    // two) and the season's configured cap, not a constant.
    if (!canJoinAnotherTeam(heldTeamIds.length, teamRules)) {
      return teamLimitResponse(teamRules);
    }
    // No max_team_size check here: a team that does not exist yet has no
    // members, so creating one and self-joining can never overfill it.

    // Fetch subscriber email for created_by_email (required field on teams table)
    const subEmailR = await fetch(
      `${SUPABASE_URL}/rest/v1/dc_subscribers?id=eq.${subscriberId}&select=email`,
      { headers: h, cache: 'no-store' }
    );
    const subEmailRows = subEmailR.ok ? await subEmailR.json().catch(() => null) : null;
    const createdByEmail: string = (Array.isArray(subEmailRows) ? subEmailRows[0]?.email : null) ?? '';
    if (!createdByEmail) return Response.json({ error: 'subscriber_not_found' }, { status: 400 });

    // Generate a unique code slug from the team name
    const toCode = (name: string, suffix?: string) => {
      const base = name.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20);
      return suffix ? `${base}-${suffix}` : base;
    };

    // Part B: the season label + group hierarchy columns are retired. New teams
    // land in the INDEPENDENT league's GENERAL conference (resolved by code —
    // never a hardcoded uuid); the team_memberships insert below then auto-fills
    // team_conference_memberships via the DB trigger.
    const confR = await fetch(
      `${SUPABASE_URL}/rest/v1/conferences?code=eq.GENERAL&select=id,league_id,leagues!inner(code)&leagues.code=eq.INDEPENDENT&limit=1`,
      { headers: h, cache: 'no-store' }
    );
    const confRows = confR.ok ? await confR.json().catch(() => []) : [];
    const homeConf = Array.isArray(confRows) ? confRows[0] : null;

    const teamPayload = (code: string) => ({
      name: teamName,
      code,
      created_by_email: createdByEmail,
      // Team Captain MVP: the creating subscriber is automatically captain.
      captain_id: subscriberId,
      league_id: homeConf?.league_id ?? null,
      conference_id: homeConf?.id ?? null,
    });

    // Try insert; retry once with a suffix if the code slug collides
    let code = toCode(teamName);
    let createR = await fetch(`${SUPABASE_URL}/rest/v1/teams`, {
      method: 'POST',
      headers: { ...h, Prefer: 'return=representation' },
      body: JSON.stringify(teamPayload(code)),
    });
    if (!createR.ok) {
      const errText = await createR.text();
      if (errText.includes('23505') || errText.includes('unique')) {
        // Code collision — retry with a 4-digit suffix
        code = toCode(teamName, String(Date.now()).slice(-4));
        createR = await fetch(`${SUPABASE_URL}/rest/v1/teams`, {
          method: 'POST',
          headers: { ...h, Prefer: 'return=representation' },
          body: JSON.stringify(teamPayload(code)),
        });
      }
      if (!createR.ok) {
        const err = await createR.text();
        console.error('team create failed', err);
        return Response.json({ error: 'create_failed' }, { status: 500 });
      }
    }
    const created = await createR.json().catch(() => null);
    const newTeamId: string | null =
      Array.isArray(created) ? (created[0]?.id ?? null) : ((created as Record<string, unknown>)?.id as string ?? null);
    if (!newTeamId) return Response.json({ error: 'create_failed' }, { status: 500 });

    // Join the new team
    const memInsR = await fetch(`${SUPABASE_URL}/rest/v1/team_memberships`, {
      method: 'POST',
      headers: { ...h, Prefer: 'return=minimal' },
      body: JSON.stringify([{ subscriber_id: subscriberId, team_id: newTeamId, season_id: seasonId, pending }]),
    });
    if (!memInsR.ok) {
      const err = await memInsR.text();
      console.error('team_memberships create-join failed', err);
      return Response.json({ error: 'join_failed' }, { status: 500 });
    }

    return Response.json({ ok: true, team_id: newTeamId, team_name: teamName, pending });
  }

  // ── Upsert: reconcile the player's membership set for this season ────────────
  // `team_ids` is the FULL desired set. We diff it against ALL current memberships
  // (regardless of `pending`), because the unique key is
  // (subscriber_id, team_id, season_id, pending) — a team can have one row per
  // pending value. The previous implementation deleted/re-inserted only rows
  // matching the *current* pending flag, which had two bugs:
  //   1. a confirmed (pending=false) membership could never be removed during
  //      Free Agency (current pending=true) — "Leave team" silently did nothing;
  //   2. kept teams were blindly re-inserted under the current pending value,
  //      creating a second row and duplicate entries in the UI.
  // Diffing fixes both: drop teams that left (every row, any pending), add only
  // genuinely new teams, and never touch the rows of kept teams.
  const desired = Array.from(
    new Set(
      (Array.isArray(body.team_ids) ? body.team_ids : []).filter(
        (x): x is string => typeof x === 'string' && x.length > 0
      )
    )
  );

  // Reuses the set fetched above — one read, not two.
  const currentTeamIds = heldTeamIds;

  // The cap, applied to the WHOLE desired set rather than by silently truncating
  // it — the previous code sliced the set to a fixed five, which dropped teams
  // the player had asked for and still returned 200.
  // Grandfathered: a player already above a lowered cap may save
  // — to leave a team, or to re-confirm unchanged — but may never grow. See
  // `isTeamSetAllowed`.
  if (!isTeamSetAllowed(desired.length, currentTeamIds.length, teamRules)) {
    return teamLimitResponse(teamRules);
  }

  const toRemove = currentTeamIds.filter(tid => !desired.includes(tid));
  const toAdd = desired.filter(tid => !currentTeamIds.includes(tid));

  // Playoff freeze THEN trading windows, on the DIFF:
  //   - a no-op save (nothing added, nothing removed) is never blocked — the
  //     picker posts the full desired set on every save, so a player merely
  //     re-confirming their roster outside a window must not get a 403;
  //   - holding nothing and only adding is a FIRST JOIN and is exempt;
  //   - anything else — adding a second team, or leaving one — is a move.
  if (toRemove.length > 0 || toAdd.length > 0) {
    const moveBlocked = rosterMoveGuard(season, {
      isFirstJoin: currentTeamIds.length === 0 && toRemove.length === 0,
      rules,
    });
    if (moveBlocked) return moveBlocked;
  }

  // Size limit, on the teams being ADDED only. A team the player is already on
  // is never re-checked: an over-size team must not trap its own members.
  if (teamRules.maxTeamSize != null && toAdd.length > 0) {
    const counts = await confirmedMemberCounts(h, seasonId, toAdd);
    const full = toAdd.find(tid => isTeamFull(counts(tid), teamRules));
    if (full) {
      return Response.json(
        {
          error: TEAM_FULL_CODE,
          message: teamFullMessage(teamRules.maxTeamSize),
          maxTeamSize: teamRules.maxTeamSize,
          team_id: full,
        },
        { status: 400 }
      );
    }
  }

  // Remove dropped teams — every row for that team, regardless of pending.
  if (toRemove.length > 0) {
    const inList = toRemove.map(encodeURIComponent).join(',');
    await fetch(
      `${SUPABASE_URL}/rest/v1/team_memberships?subscriber_id=eq.${subscriberId}&season_id=eq.${seasonId}&team_id=in.(${inList})`,
      { method: 'DELETE', headers: h }
    ).catch(() => {});
  }

  // Add newly-desired teams with the current pending flag (skips teams already
  // present under either pending value, so no duplicate row is created).
  if (toAdd.length > 0) {
    const rows = toAdd.map((tid: string) => ({
      subscriber_id: subscriberId,
      team_id: tid,
      season_id: seasonId,
      pending,
    }));
    const insR = await fetch(`${SUPABASE_URL}/rest/v1/team_memberships`, {
      method: 'POST',
      headers: { ...h, Prefer: 'return=minimal' },
      body: JSON.stringify(rows),
    });
    if (!insR.ok) {
      const err = await insR.text();
      console.error('team_memberships insert failed', err);
      return Response.json({ error: 'insert_failed' }, { status: 500 });
    }
  }

  // Heal any legacy rows still flagged pending (from the retired Free Agency
  // deferral) so kept teams become active — every membership is immediate now.
  await fetch(
    `${SUPABASE_URL}/rest/v1/team_memberships?subscriber_id=eq.${subscriberId}&season_id=eq.${seasonId}&pending=eq.true`,
    { method: 'PATCH', headers: h, body: JSON.stringify({ pending: false }) }
  ).catch(() => {});

  // Return normalized team list so the client can update without a re-fetch
  const afterR = await fetch(
    `${SUPABASE_URL}/rest/v1/team_memberships?subscriber_id=eq.${subscriberId}&season_id=eq.${seasonId}&select=team_id,pending,teams(id,name)`,
    { headers: h, cache: 'no-store' }
  );
  const after: Array<{ team_id: string; pending: boolean; teams?: { id: string; name: string } }> =
    afterR.ok ? await afterR.json().catch(() => []) : [];
  const teams = after.map(m => ({
    team_id: m.team_id,
    team_name: m.teams?.name ?? '',
    pending: m.pending,
  }));
  return Response.json({
    ok: true,
    pending,
    teams,
    teamCap: teamRules.maxTeamsPerPlayer,
    maxTeamSize: teamRules.maxTeamSize,
  });
}
