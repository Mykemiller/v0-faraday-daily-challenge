// League Office — Game Library pure logic (no I/O, no env, no Supabase).
//
// THE distinction this module exists to protect (D1):
//   • lifecycle_state is ONE state per game, on game_catalog.
//   • "assigned to a season" is a MANY-TO-MANY RELATIONSHIP in season_games.
// They are not alternatives. All 7 live games are simultaneously Live *and*
// assigned to 4 seasons; any model that makes "Assigned to a Season" a lifecycle
// state loses that. Assignment is therefore always DERIVED here, never stored as
// a state.
//
// Everything below is pure so it can be unit-tested without a database — the
// transition map in particular is the server-side gate, and a table nobody can
// exercise is a table nobody can trust.

export const LIFECYCLE_STATES = ["new_idea", "in_test", "live", "retired"] as const;
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

export function isLifecycleState(v: unknown): v is LifecycleState {
  return typeof v === "string" && (LIFECYCLE_STATES as readonly string[]).includes(v);
}

/** The states a game may be ASSIGNED to a season in — the same set
 *  `fn_season_games_assignable()` enforces in the database.
 *
 *  This is the ONLY correct assignability test. Matching is_active or is_beta
 *  instead is what shipped the CC-LO-SLATE-FILTER-1.0 bug: every catalog row is
 *  is_active, including the concepts that have no puzzle bank, so the slate
 *  offered 18 games and the DB refused all 18. */
export const ASSIGNABLE_LIFECYCLE_STATES = ["live", "in_test"] as const;

export const isAssignableGame = (g: { lifecycle_state?: string | null }): boolean =>
  (ASSIGNABLE_LIFECYCLE_STATES as readonly string[]).includes(String(g.lifecycle_state));

/** Human labels for the badge + the transition menu. */
export const LIFECYCLE_LABEL: Record<LifecycleState, string> = {
  new_idea: "New idea",
  in_test: "In test",
  live: "Live",
  retired: "Retired",
};

/** Maps onto the console's four-tone chip system. */
export const LIFECYCLE_TONE: Record<LifecycleState, "green" | "amber" | "red" | "gray"> = {
  new_idea: "gray",
  in_test: "amber",
  live: "green",
  retired: "red",
};

// ── the allowed-transition map (D-Phase 4) ───────────────────────────────────
// new_idea → in_test → live → retired, plus in_test → new_idea (send it back)
// and retired → live (bring it back). Everything else is rejected SERVER-SIDE.
// Note there is deliberately no new_idea → live: a concept must be exercised in
// test before it can claim a runtime_key.
const TRANSITIONS: Record<LifecycleState, readonly LifecycleState[]> = {
  new_idea: ["in_test"],
  in_test: ["live", "new_idea"],
  live: ["retired"],
  retired: ["live"],
};

export function allowedTransitions(from: LifecycleState): readonly LifecycleState[] {
  return TRANSITIONS[from] ?? [];
}

export function canTransition(from: LifecycleState, to: LifecycleState): boolean {
  return allowedTransitions(from).includes(to);
}

export type TransitionCheck = { ok: true } | { ok: false; message: string };

/** The full server-side gate for a lifecycle change. Order matters: shape errors
 *  before policy errors, so a malformed request never reports as a policy denial. */
export function checkTransition(input: {
  from: unknown;
  to: unknown;
  reason: unknown;
  runtimeKey?: string | null;
  /** count of season_games rows pointing at this game, any config state. */
  assignmentCount?: number;
}): TransitionCheck {
  const { from, to } = input;
  if (!isLifecycleState(from)) return { ok: false, message: "This game has an unrecognized lifecycle state." };
  if (!isLifecycleState(to)) return { ok: false, message: "That is not a lifecycle state." };

  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (!reason) return { ok: false, message: "A reason is required for every lifecycle change." };

  if (from === to) return { ok: false, message: `This game is already ${LIFECYCLE_LABEL[to]}.` };

  if (!canTransition(from, to))
    return {
      ok: false,
      message: `${LIFECYCLE_LABEL[from]} → ${LIFECYCLE_LABEL[to]} is not an allowed transition.`,
    };

  // A live game MUST carry the runtime key — it is the only thing tying the row
  // to what the serving path actually keys on. The DB CHECK enforces this too;
  // this returns the readable message instead of a constraint violation.
  if (to === "live" && !(input.runtimeKey ?? "").trim())
    return {
      ok: false,
      message: "Set the runtime key (the exact string the serving path uses) before taking this game live.",
    };

  // Retiring an assigned game would leave a season slate that the D9 trigger
  // refuses to re-save (saveConfigBundle replaces the whole slate by
  // DELETE + INSERT). Fail here with instructions rather than bricking the
  // season editor later.
  if (to === "retired" && (input.assignmentCount ?? 0) > 0)
    return {
      ok: false,
      message: `This game is still on ${input.assignmentCount} season configuration${
        (input.assignmentCount ?? 0) === 1 ? "" : "s"
      }. Unassign it before retiring.`,
    };

  return { ok: true };
}

// ── season editability (mirrors the shipped season-config rule) ──────────────
// PR #120 made this the single source of truth for what may be written:
// draft/scheduled write in place; active is READ-ONLY and cloning is the only
// path; superseded/cancelled are history. D5's outcome (edit the active season →
// new version, prior superseded) is reached via clone + promote, NOT by
// inserting a second already-active row — that would trip
// season_config_one_active_uq.
export type ConfigState = "draft" | "scheduled" | "active" | "superseded" | "cancelled";

export type AssignPlan =
  | { kind: "in_place"; note: null }
  | { kind: "clone_and_promote"; note: string }
  | { kind: "refused"; note: string };

export function planAssignment(input: {
  configState: ConfigState | string | null | undefined;
  seasonStatus: string | null | undefined;
  seasonLocked: boolean;
}): AssignPlan {
  if (input.seasonLocked)
    return { kind: "refused", note: "This season is locked. Unlock it before changing its game slate." };

  if (input.seasonStatus === "closed")
    return { kind: "refused", note: "This season is closed — its configuration is history." };

  switch (input.configState) {
    case "draft":
    case "scheduled":
      return { kind: "in_place", note: null };
    case "active":
      return {
        kind: "clone_and_promote",
        note: "This season is live — the change lands as a new configuration version and supersedes the current one.",
      };
    case "superseded":
      return { kind: "refused", note: "This version has been superseded — it is history." };
    case "cancelled":
      return { kind: "refused", note: "This version was cancelled." };
    default:
      return { kind: "refused", note: "Unknown configuration state." };
  }
}

// ── derived assignment badge (D1) ────────────────────────────────────────────
export type SeasonAssignment = {
  seasonId: string;
  seasonName: string;
  seasonStatus: string;
  configState: ConfigState | string;
  enabled: boolean;
};

/** The badge is DERIVED from season_games every render — never stored, so it can
 *  never drift from the relationship it describes. Counts only enabled rows;
 *  a disabled row means "on the slate but switched off", which is not the same
 *  as being scheduled to appear. */
export function assignmentSummary(rows: SeasonAssignment[]): {
  count: number;
  label: string;
  seasons: string[];
} {
  const on = rows.filter((r) => r.enabled);
  const seasons = on.map((r) => r.seasonName);
  return {
    count: on.length,
    label: on.length === 0 ? "—" : `${on.length} season${on.length === 1 ? "" : "s"}`,
    seasons,
  };
}

/** Matrix cell state for the games × seasons view. */
export type MatrixCell = "enabled" | "disabled" | "unassigned";

export function matrixCell(row: SeasonAssignment | undefined): MatrixCell {
  if (!row) return "unassigned";
  return row.enabled ? "enabled" : "disabled";
}

// ── catalog metadata edit rules (Phase 4) ────────────────────────────────────
/** Fields a staff member may PATCH on game_catalog. Whitelist-only, so a client
 *  can never smuggle `lifecycle_state` (which must go through the transition
 *  gate) or `game_key` / `runtime_key` (frozen once live, D3) into an update. */
export const EDITABLE_CATALOG_FIELDS = [
  "display_name",
  "category",
  "description",
  "default_points",
  "supports_hints",
  "max_hints",
  "sort_order",
  "notes",
  "idea_source",
  "public_id_prefix",
] as const;

/** `runtime_key` joins this whitelist only while the game is NOT yet live —
 *  once live it is the serving join key and freezes (D3). `game_key` never
 *  becomes editable. */
export function editableFields(lifecycle: LifecycleState): readonly string[] {
  return lifecycle === "live"
    ? EDITABLE_CATALOG_FIELDS
    : [...EDITABLE_CATALOG_FIELDS, "runtime_key"];
}

export function sanitizeCatalogPatch(
  raw: unknown,
  lifecycle: LifecycleState
): Record<string, unknown> {
  if (!raw || typeof raw !== "object") return {};
  const allowed = new Set(editableFields(lifecycle));
  const src = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [k, v] of Object.entries(src)) {
    if (!allowed.has(k)) continue;
    if (v === undefined) continue;

    switch (k) {
      case "default_points":
      case "max_hints":
      case "sort_order": {
        const n = typeof v === "number" ? v : Number.parseInt(String(v), 10);
        if (!Number.isFinite(n)) continue;
        out[k] = Math.trunc(n);
        break;
      }
      case "supports_hints":
        out[k] = v === true || v === "true";
        break;
      default: {
        if (v === null) {
          out[k] = null;
          break;
        }
        const t = String(v).trim();
        out[k] = t === "" ? null : t;
      }
    }
  }

  // display_name is NOT NULL in the schema — never let a blank clear it.
  if ("display_name" in out && !out.display_name) delete out.display_name;
  return out;
}

/** game_key for a newly created game: snake_case, stable, unique. Derived once
 *  at creation and then frozen — nothing joins on it, but it is the catalog's
 *  stable identity across renames. */
export function toGameKey(displayName: string): string {
  return (displayName || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}
