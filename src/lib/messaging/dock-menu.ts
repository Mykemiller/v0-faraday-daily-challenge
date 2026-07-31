// Pure menu-item derivation for the masthead message dock (CC-DC-MSG-DOCK-1.0).
// No I/O, no next imports — unit-tested via `npm run test:messaging`.
//
// Inputs are exactly what the two dock resolvers return:
//   GET /api/messages?scope=captain      → { teams: DockTeam[] }
//   GET /api/messages?scope=commissioner → CommissionerInfo
// The derivation only decides what the MENU shows — every send is still
// authorized server-side; hiding or disabling an item is never enforcement.

/** One team the viewer belongs to this season, with fresh captain resolution. */
export interface DockTeam {
  team_id: string;
  team_name: string | null;
  /** True when the VIEWER is this team's captain. */
  is_captain: boolean;
  /** The team's current captain — null when captain_id is null or the viewer. */
  captain: { subscriber_id: string; handle: string } | null;
}

export interface CommissionerInfo {
  available: boolean;
  subscriber_id?: string;
  handle?: string;
  /** True when the viewer IS the commissioner. */
  is_self?: boolean;
}

/** Locked D2 copy for the disabled captain item. */
export const JOIN_A_TEAM_HINT = 'Join a team first.';

export type CaptainItem =
  | { state: 'hidden' }
  | { state: 'disabled'; hint: string }
  | { state: 'open'; team: DockTeam }
  | { state: 'picker'; teams: DockTeam[] };

export type MyTeamItem =
  | { state: 'hidden' }
  | { state: 'open'; team: DockTeam }
  | { state: 'picker'; teams: DockTeam[] };

export type CommissionerItem =
  | { state: 'hidden' }
  | { state: 'disabled' }
  | { state: 'open'; recipient: { subscriber_id: string; handle: string } };

export interface DockMenu {
  captain: CaptainItem;
  myTeam: MyTeamItem;
  /** "A Player" always renders — the dock itself only mounts when signed in. */
  player: { state: 'open' };
  commissioner: CommissionerItem;
}

/**
 * D2 — "Message my Captain".
 * - no teams → disabled with the locked hint
 * - viewer captains every team they're on → hidden (My Team covers it)
 * - no eligible team has a captain (captain_id null) → disabled with the hint
 * - exactly one eligible team → open that captain's DM directly
 * - several eligible teams → inline picker (captain-less entries render
 *   disabled inside the picker)
 */
export function deriveCaptainItem(teams: DockTeam[]): CaptainItem {
  if (teams.length === 0) return { state: 'disabled', hint: JOIN_A_TEAM_HINT };
  const eligible = teams.filter(t => !t.is_captain);
  if (eligible.length === 0) return { state: 'hidden' };
  if (!eligible.some(t => t.captain)) return { state: 'disabled', hint: JOIN_A_TEAM_HINT };
  if (eligible.length === 1) return { state: 'open', team: eligible[0] };
  return { state: 'picker', teams: eligible };
}

/**
 * D3 — "My Team" (broadcast channel; member read / captain compose).
 * - no teams → hidden (verified: non-member "My Team" is absent, not disabled)
 * - one team → open its channel; several → inline picker
 */
export function deriveMyTeamItem(teams: DockTeam[]): MyTeamItem {
  if (teams.length === 0) return { state: 'hidden' };
  if (teams.length === 1) return { state: 'open', team: teams[0] };
  return { state: 'picker', teams };
}

/**
 * D4 — "The Commissioner".
 * - resolver said unavailable (no subscriber row) → disabled
 * - the viewer IS the commissioner → hidden (never a self-DM entry)
 * - otherwise → open the standard direct thread
 */
export function deriveCommissionerItem(info: CommissionerInfo): CommissionerItem {
  if (!info.available || !info.subscriber_id) return { state: 'disabled' };
  if (info.is_self) return { state: 'hidden' };
  return {
    state: 'open',
    recipient: { subscriber_id: info.subscriber_id, handle: info.handle ?? 'anonymous' },
  };
}

export function deriveDockMenu(teams: DockTeam[], commissioner: CommissionerInfo): DockMenu {
  return {
    captain: deriveCaptainItem(teams),
    myTeam: deriveMyTeamItem(teams),
    player: { state: 'open' },
    commissioner: deriveCommissionerItem(commissioner),
  };
}
