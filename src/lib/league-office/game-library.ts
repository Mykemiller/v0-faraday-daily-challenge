// League Office — Game Library readers (server-only).
//
// Same contract as data.ts / seasons.ts: every export takes an already-verified
// Svc (see requireStaff) and returns plain, typed, view-ready objects. Reads are
// live (no-store) against ycadmmngkdhvpcsrcuaq via the service role.
//
// Schema note (verified live 2026-07-30 — do not "fix" from memory):
//   game_catalog.lifecycle_state — ONE state per game (D1).
//   season_games                 — the many-to-many assignment relationship, FK
//                                  game_catalog. Assignment is DERIVED for
//                                  display; it is never a lifecycle state.
//   game_catalog.runtime_key     — the free-text string the SERVING path keys on
//                                  ("Signal Drop"), which is what
//                                  dc_puzzle_bank_staging.puzzle_type holds.
//                                  game_key ("signal_drop") joins to nothing.

import { q, type Svc } from "./service";
import {
  assignmentSummary,
  type ConfigState,
  type LifecycleState,
  type SeasonAssignment,
} from "./game-library-logic";
import { type AuditRow } from "./write";

// ── row types ────────────────────────────────────────────────────────────────

export type GameRow = {
  id: string;
  game_key: string;
  display_name: string;
  short_code: string | null;
  description: string | null;
  category: string | null;
  is_active: boolean;
  is_beta: boolean;
  default_points: number;
  supports_hints: boolean;
  max_hints: number;
  min_difficulty: string | null;
  max_difficulty: string | null;
  sort_order: number;
  launched_on: string | null;
  retired_on: string | null;
  lifecycle_state: LifecycleState;
  runtime_key: string | null;
  public_id_prefix: string | null;
  idea_source: string | null;
  notes: string | null;
  metadata: Record<string, unknown> | null;
};

type SeasonGameRow = {
  id: string;
  season_config_id: string;
  game_id: string;
  is_enabled: boolean;
  sort_order: number | null;
};

type SeasonRow = { id: string; name: string; status: string; starts_on: string | null; locked_at: string | null };
type ConfigRow = { id: string; season_id: string; version: number; state: ConfigState };

// ── the view model ───────────────────────────────────────────────────────────

export type GameLibraryEntry = {
  game: GameRow;
  assignments: SeasonAssignment[];
  /** derived, never stored (D1) */
  assigned: { count: number; label: string; seasons: string[] };
  /** rows in dc_puzzle_bank_staging whose puzzle_type === runtime_key */
  bankDepth: number;
};

export type SeasonColumn = {
  seasonId: string;
  name: string;
  status: string;
  locked: boolean;
  configId: string | null;
  configState: ConfigState | null;
  /** closed / superseded / cancelled / locked → the matrix renders it locked */
  readOnly: boolean;
};

export type GameLibrary = {
  entries: GameLibraryEntry[];
  seasons: SeasonColumn[];
  counts: Record<LifecycleState, number>;
  /** true when the bank-depth column could not be computed (missing table/perm) */
  bankDepthUnavailable: boolean;
};

/** Pick the config a season is CURRENTLY represented by, matching the season
 *  console's precedence: active first, then scheduled, then the newest draft.
 *  Ordering by the enum in PostgREST would put `draft` first and show a stale
 *  draft as the season's slate — so the pick happens here, in JS. */
function pickConfig(configs: ConfigRow[]): ConfigRow | null {
  if (!configs.length) return null;
  const byRank = (c: ConfigRow) =>
    c.state === "active" ? 0 : c.state === "scheduled" ? 1 : c.state === "draft" ? 2 : 3;
  return [...configs].sort((a, b) => byRank(a) - byRank(b) || b.version - a.version)[0] ?? null;
}

const READ_ONLY_CONFIG: ConfigState[] = ["superseded", "cancelled"];

export async function loadGameLibrary(s: Svc): Promise<GameLibrary> {
  const [games, seasons, configs] = await Promise.all([
    q<GameRow>(s, `game_catalog?select=*&order=sort_order.asc`),
    q<SeasonRow>(s, `seasons?select=id,name,status,starts_on,locked_at&order=starts_on.asc`),
    q<ConfigRow>(s, `season_config?select=id,season_id,version,state&order=version.asc`),
  ]);

  const configBySeason = new Map<string, ConfigRow[]>();
  for (const c of configs) {
    const list = configBySeason.get(c.season_id) ?? [];
    list.push(c);
    configBySeason.set(c.season_id, list);
  }

  const columns: SeasonColumn[] = seasons.map((season) => {
    const cfg = pickConfig(configBySeason.get(season.id) ?? []);
    return {
      seasonId: season.id,
      name: season.name,
      status: season.status,
      locked: !!season.locked_at,
      configId: cfg?.id ?? null,
      configState: cfg?.state ?? null,
      readOnly:
        !!season.locked_at ||
        season.status === "closed" ||
        (!!cfg && READ_ONLY_CONFIG.includes(cfg.state)) ||
        !cfg,
    };
  });

  // Only the configs actually represented in the matrix need their slates read.
  const focusIds = columns.map((c) => c.configId).filter((id): id is string => !!id);
  const slates = focusIds.length
    ? await q<SeasonGameRow>(
        s,
        `season_games?season_config_id=in.(${focusIds.join(",")})&select=id,season_config_id,game_id,is_enabled,sort_order`
      )
    : [];

  const columnByConfig = new Map(columns.filter((c) => c.configId).map((c) => [c.configId as string, c]));
  const byGame = new Map<string, SeasonAssignment[]>();
  for (const row of slates) {
    const col = columnByConfig.get(row.season_config_id);
    if (!col) continue;
    const list = byGame.get(row.game_id) ?? [];
    list.push({
      seasonId: col.seasonId,
      seasonName: col.name,
      seasonStatus: col.status,
      configState: col.configState ?? "draft",
      enabled: row.is_enabled,
    });
    byGame.set(row.game_id, list);
  }

  const depth = await loadBankDepth(s);

  const entries: GameLibraryEntry[] = games.map((game) => {
    const assignments = byGame.get(game.id) ?? [];
    return {
      game,
      assignments,
      assigned: assignmentSummary(assignments),
      bankDepth: game.runtime_key ? (depth.counts.get(game.runtime_key) ?? 0) : 0,
    };
  });

  const counts = { new_idea: 0, in_test: 0, live: 0, retired: 0 } as Record<LifecycleState, number>;
  for (const g of games) if (g.lifecycle_state in counts) counts[g.lifecycle_state] += 1;

  return { entries, seasons: columns, counts, bankDepthUnavailable: depth.unavailable };
}

/** Puzzle-bank depth, counted by the RUNTIME key — the whole point of D3. A
 *  game with no runtime_key (every new_idea) has no bank by definition.
 *
 *  NOTE (2026-07-30): dc_puzzle_bank_staging currently holds exactly 1 row per
 *  type — the PR #115 pilot import. The 373-row Airtable backfill has not run,
 *  so a depth of 1 across the live games is accurate, not a bug. */
async function loadBankDepth(
  s: Svc
): Promise<{ counts: Map<string, number>; unavailable: boolean }> {
  const rows = await q<{ puzzle_type: string | null }>(
    s,
    `dc_puzzle_bank_staging?select=puzzle_type`
  );
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (!r.puzzle_type) continue;
    counts.set(r.puzzle_type, (counts.get(r.puzzle_type) ?? 0) + 1);
  }
  // q() swallows failures into [] — an empty map is indistinguishable from an
  // empty table, so say so rather than rendering a confident "0".
  return { counts, unavailable: rows.length === 0 };
}

/** The drawer shows "recent lo_audit_log entries for that target_id". Fetching
 *  per-game on open would be a request per drawer; the whole domain is small
 *  (single digits today), so read it once and group. */
export async function loadAuditByGame(s: Svc): Promise<Map<string, AuditRow[]>> {
  const rows = await q<AuditRow>(
    s,
    `lo_audit_log?domain=eq.game_library&select=*&order=at.desc&limit=400`
  );
  const byGame = new Map<string, AuditRow[]>();
  for (const r of rows) {
    if (!r.target_id) continue;
    const list = byGame.get(r.target_id) ?? [];
    if (list.length < 25) list.push(r);
    byGame.set(r.target_id, list);
  }
  return byGame;
}
