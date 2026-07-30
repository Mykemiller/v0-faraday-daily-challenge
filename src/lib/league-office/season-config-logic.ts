// League Office — Season Config: PURE decision logic (no I/O, no React).
//
// Everything here is a total function over plain data so it can be unit-tested
// under `node --test` AND re-used verbatim by the client editor (live totals,
// normalize buttons, the unsaved-changes indicator) and by the server writers
// (concurrency fingerprint, payload sanitation). The rule of the module: it may
// decide, it may never fetch.
//
// Tests: `npm run test:season-config`.

// ── states ───────────────────────────────────────────────────────────────────

export const CONFIG_STATES = ["draft", "scheduled", "active", "superseded", "cancelled"] as const;
export type ConfigState = (typeof CONFIG_STATES)[number];

export const SCOPE_TYPES = ["platform", "league", "conference"] as const;
export type ScopeType = (typeof SCOPE_TYPES)[number];

export const DIFFICULTY_BANDS = ["foundational", "practitioner", "expert"] as const;
export type DifficultyBand = (typeof DIFFICULTY_BANDS)[number];

export const DIFFICULTY_CURVES = ["flat", "ramp", "wave", "custom"] as const;
export const TEAM_SCORE_METHODS = ["sum", "average", "top_n"] as const;
export const LEADERBOARD_VISIBILITIES = ["public", "league", "private"] as const;

/** The seven IDF 4.0 Theaters, as carried by `dc_daily_theme.theater_id`.
 *  Names are the public labels — never D-codes (repo-wide IDF rule). */
export const THEATERS: { id: string; name: string }[] = [
  { id: "T-001", name: "The Power Reckoning" },
  { id: "T-002", name: "The Thermal Reckoning" },
  { id: "T-003", name: "The Consent Crisis" },
  { id: "T-004", name: "The Capital Concentration" },
  { id: "T-005", name: "The Inference Economy" },
  { id: "T-006", name: "The Sovereign AI Race" },
  { id: "T-007", name: "The New Energy Stack" },
];

/** Only `draft` and `scheduled` may be written. `active` is deliberately
 *  read-only: the clone path is the ONLY way to change a live season, which is
 *  what makes the version history trustworthy. Enforced at the API layer too —
 *  this function is the single source of that rule. */
export function editability(state: string | null | undefined): {
  editable: boolean;
  reason: string | null;
} {
  switch (state) {
    case "draft":
      return { editable: true, reason: null };
    case "scheduled":
      return { editable: true, reason: null };
    case "active":
      return { editable: false, reason: "This version is live. Clone it to make changes." };
    case "superseded":
      return { editable: false, reason: "This version has been superseded — it is history." };
    case "cancelled":
      return { editable: false, reason: "This version was cancelled." };
    default:
      return { editable: false, reason: "Unknown config state." };
  }
}

// ── slugs ────────────────────────────────────────────────────────────────────

/** Season slug: lowercase, alphanumerics + single hyphens, trimmed. Mirrors the
 *  shape of the live slugs (e.g. `season-2-post-yotta`). */
export function slugify(input: string): string {
  return (input || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

// ── percentages ──────────────────────────────────────────────────────────────

/** Round to 2dp without float drift (0.1+0.2 style). */
export function round2(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

export function sumPct(values: Array<number | null | undefined>): number {
  return round2(values.reduce<number>((a, v) => a + (Number(v) || 0), 0));
}

/** Is the running total exactly 100? Uses a 0.01 tolerance because the inputs
 *  are 2dp numerics — 99.999999 must not read as "not 100". */
export function isHundred(total: number): boolean {
  return Math.abs(total - 100) < 0.005;
}

/** Proportionally rescale to exactly 100, absorbing all rounding drift into the
 *  largest element so the set ALWAYS sums to 100.00 — never 99.99. An all-zero
 *  (or empty-of-signal) set falls back to an even split, which is the only
 *  sensible reading of "normalize nothing". */
export function normalizeTo100(values: number[]): number[] {
  if (!values.length) return [];
  const total = values.reduce((a, v) => a + (Number(v) || 0), 0);
  if (total <= 0) return evenSplit(values.length);

  const scaled = values.map((v) => round2(((Number(v) || 0) * 100) / total));
  return absorbDrift(scaled);
}

/** n equal shares that sum to exactly 100. */
export function evenSplit(n: number): number[] {
  if (n <= 0) return [];
  const base = round2(100 / n);
  return absorbDrift(new Array(n).fill(base));
}

/** Push the residual onto the largest element (it is the least visually
 *  disturbed by a 0.01 nudge, and can absorb it without going negative). */
function absorbDrift(values: number[]): number[] {
  const out = values.slice();
  const drift = round2(100 - out.reduce((a, v) => a + v, 0));
  if (drift === 0) return out;
  let idx = 0;
  for (let i = 1; i < out.length; i++) if (out[i] > out[idx]) idx = i;
  out[idx] = round2(out[idx] + drift);
  return out;
}

/** The 30/50/20 house default for the difficulty bands. */
export function defaultDifficultyMix(): { difficulty_band: DifficultyBand; target_pct: number }[] {
  return [
    { difficulty_band: "foundational", target_pct: 30 },
    { difficulty_band: "practitioner", target_pct: 50 },
    { difficulty_band: "expert", target_pct: 20 },
  ];
}

/** An even split across the seven Theaters — the defaults-path theme mix. */
export function defaultThemeMix(): { theater_id: string; target_pct: number }[] {
  const pcts = evenSplit(THEATERS.length);
  return THEATERS.map((t, i) => ({ theater_id: t.id, target_pct: pcts[i] }));
}

// ── day masks ────────────────────────────────────────────────────────────────

/** ISO day numbers: 1=Mon … 7=Sun (matches the `_int2` arrays in the schema). */
export const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];

export function normalizeDayMask(mask: unknown): number[] {
  if (!Array.isArray(mask)) return ALL_DAYS.slice();
  const set = new Set<number>();
  for (const d of mask) {
    const n = Number(d);
    if (Number.isInteger(n) && n >= 1 && n <= 7) set.add(n);
  }
  return [...set].sort((a, b) => a - b);
}

export function dayMaskLabel(mask: number[] | null | undefined): string {
  const days = normalizeDayMask(mask ?? ALL_DAYS);
  if (!days.length) return "Never";
  if (days.length === 7) return "Every day";
  if (days.join(",") === "1,2,3,4,5") return "Weekdays";
  if (days.join(",") === "6,7") return "Weekends";
  return days.map((d) => DAY_LABELS[d - 1]).join(" · ");
}

// ── season window ────────────────────────────────────────────────────────────

/** Whole days inclusive between two ISO dates, plus how many of them fall on a
 *  play day. Pure date math on the ISO string (parsed at UTC noon so a DST shift
 *  can never round a day off). */
export function windowSummary(
  startsOn: string,
  endsOn: string,
  playDays: number[] = ALL_DAYS
): { days: number; playDays: number } | null {
  const a = parseIsoDate(startsOn);
  const b = parseIsoDate(endsOn);
  if (!a || !b || b < a) return null;

  const mask = new Set(normalizeDayMask(playDays));
  const days = Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
  let play = 0;
  for (let i = 0; i < days; i++) {
    const d = new Date(a.getTime() + i * 86400000);
    const iso = d.getUTCDay() === 0 ? 7 : d.getUTCDay(); // JS Sun=0 → ISO 7
    if (mask.has(iso)) play++;
  }
  return { days, playDays: play };
}

function parseIsoDate(s: string | null | undefined): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  const d = new Date(s.slice(0, 10) + "T12:00:00Z");
  return Number.isNaN(d.getTime()) ? null : d;
}

/** `seasons.free_agency_start` and `free_agency_notice_start` are
 *  **GENERATED ALWAYS** columns — `ends_on - 3` and `ends_on - 7`. Postgres
 *  rejects ANY value written to them, including NULL (`428C9`), so they must
 *  never appear in an INSERT or PATCH body. Mirrored here for DISPLAY only, so
 *  the wizard can show what the dates will be instead of pretending they are
 *  editable. If the generation expression ever changes, change it here too. */
export const FREE_AGENCY_OFFSET_DAYS = 3;
export const FREE_AGENCY_NOTICE_OFFSET_DAYS = 7;

export function derivedFreeAgency(endsOn: string | null | undefined): {
  start: string | null;
  notice: string | null;
} {
  const end = parseIsoDate(endsOn);
  if (!end) return { start: null, notice: null };
  const shift = (days: number) =>
    new Date(end.getTime() - days * 86400000).toISOString().slice(0, 10);
  return {
    start: shift(FREE_AGENCY_OFFSET_DAYS),
    notice: shift(FREE_AGENCY_NOTICE_OFFSET_DAYS),
  };
}

export type SeasonRange = { id?: string; name: string; starts_on: string; ends_on: string };

/** `seasons_no_overlap` is an EXCLUDE constraint over
 *  `daterange(starts_on, ends_on, '[]')` — seasons may not overlap, inclusive of
 *  both endpoints. Checked here so the wizard can warn at the Window step and
 *  name the clashing season, rather than failing at submit with a raw 23P01. */
export function findOverlappingSeason(
  startsOn: string | null | undefined,
  endsOn: string | null | undefined,
  existing: SeasonRange[],
  ignoreId?: string
): SeasonRange | null {
  const a = parseIsoDate(startsOn);
  const b = parseIsoDate(endsOn);
  if (!a || !b) return null;

  for (const s of existing) {
    if (ignoreId && s.id === ignoreId) continue;
    const c = parseIsoDate(s.starts_on);
    const d = parseIsoDate(s.ends_on);
    if (!c || !d) continue;
    // inclusive-inclusive overlap
    if (a <= d && b >= c) return s;
  }
  return null;
}

export type WindowInput = {
  starts_on?: string | null;
  ends_on?: string | null;
  free_agency_start?: string | null;
  free_agency_notice_start?: string | null;
};

/** Client-and-server-shared validation for the wizard's Window step. Returns
 *  human sentences (they are rendered verbatim), empty array = valid. */
export function validateWindow(w: WindowInput): string[] {
  const errs: string[] = [];
  const start = parseIsoDate(w.starts_on);
  const end = parseIsoDate(w.ends_on);

  if (!start) errs.push("A start date is required.");
  if (!end) errs.push("An end date is required.");
  if (start && end && end <= start) errs.push("The end date must be after the start date.");

  const inWindow = (d: Date | null, label: string) => {
    if (!d || !start || !end) return;
    if (d < start || d > end) errs.push(`${label} falls outside the season window.`);
  };
  inWindow(parseIsoDate(w.free_agency_start), "Free agency start");
  inWindow(parseIsoDate(w.free_agency_notice_start), "Free agency notice");

  const fa = parseIsoDate(w.free_agency_start);
  const notice = parseIsoDate(w.free_agency_notice_start);
  if (fa && notice && notice > fa)
    errs.push("The free agency notice must come on or before free agency opens.");

  return errs;
}

// ── difficulty curve preview ─────────────────────────────────────────────────

/** Normalized 0..1 sample points for the inline sparkline. Presentation only —
 *  no scoring or selection logic reads this. */
export function curvePoints(curve: string, n = 24): number[] {
  const count = Math.max(2, Math.min(200, Math.floor(n)));
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    switch (curve) {
      case "ramp":
        out.push(t);
        break;
      case "wave":
        out.push(0.5 - Math.cos(t * Math.PI * 2) / 2);
        break;
      case "custom":
        out.push(0.5);
        break;
      case "flat":
      default:
        out.push(0.5);
        break;
    }
  }
  return out.map((v) => round2(Math.max(0, Math.min(1, v))));
}

// ── concurrency fingerprint ──────────────────────────────────────────────────
//
// `season_config` carries created_at/applied_at but NO updated_at column, and
// the child rows (games, mixes) carry no timestamps at all — so a row-timestamp
// guard could not see a slate edit even in principle. Instead the editor round-
// trips a fingerprint over the config AND its children: any concurrent write by
// another commissioner changes it, and the save is rejected with 409. This is
// strictly stronger than an updated_at check (it covers the children) and needs
// no schema change.

/** Deterministic JSON: object keys sorted at every depth, so key order from
 *  PostgREST can never change the hash. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

/** FNV-1a (32-bit) over the canonical form, hex. Not a security primitive — it
 *  is a change detector, and a 32-bit space is ample for "did this row move
 *  between my load and my save". */
export function fingerprint(value: unknown): string {
  const str = canonicalJson(value);
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export type FingerprintInput = {
  config: Record<string, unknown>;
  games: Record<string, unknown>[];
  themeMix: Record<string, unknown>[];
  difficultyMix: Record<string, unknown>[];
};

/** The fingerprint the editor loads and echoes back on save. Children are sorted
 *  by a stable key first so PostgREST row order never shifts the hash. */
export function configFingerprint(input: FingerprintInput): string {
  const byId = (rows: Record<string, unknown>[], keys: string[]) =>
    rows
      .map((r) => pick(r, keys))
      .sort((a, b) => (canonicalJson(a) < canonicalJson(b) ? -1 : 1));

  return fingerprint({
    config: pick(input.config, CONFIG_FIELDS),
    games: byId(input.games, [
      "game_id", "is_enabled", "weight", "points_override", "difficulty_floor",
      "difficulty_ceiling", "appears_on_days", "starts_on", "ends_on", "sort_order", "notes",
    ]),
    theme: byId(input.themeMix, [
      "theater_id", "sector_code", "thread_code", "target_pct", "min_pct", "max_pct", "is_excluded", "notes",
    ]),
    difficulty: byId(input.difficultyMix, [
      "difficulty_band", "target_pct", "min_pct", "max_pct", "applies_to_game_id",
    ]),
  });
}

function pick(row: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = row[k] ?? null;
  return out;
}

// ── the writable config surface ──────────────────────────────────────────────

/** Every `season_config` column the editor may write. Anything outside this list
 *  (id, season_id, version, state, created_by, created_at, applied_at) is owned
 *  by the DB/RPCs and is dropped from an inbound PATCH — a client can never
 *  promote itself by setting `state`. */
export const CONFIG_FIELDS = [
  "effective_from", "effective_to", "label", "notes",
  "max_teams_per_subscriber", "min_team_size", "max_team_size",
  "allow_free_agency", "allow_late_join", "allow_mid_season_team_switch",
  "registration_opens_on", "registration_closes_on", "roster_lock_on",
  "games_per_day", "play_days_of_week",
  "hints_enabled", "max_hints_per_game", "hint_penalty_pct", "late_submission_grace_hours",
  "scoring_profile", "signals_per_correct", "streak_bonus_enabled", "drop_lowest_n_days",
  "team_score_method", "team_score_top_n",
  "difficulty_curve", "target_solve_rate_pct",
  "publish_leaderboard", "leaderboard_visibility", "publish_standings_at",
  "extras",
] as const;

const INT_FIELDS = new Set([
  "max_teams_per_subscriber", "min_team_size", "max_team_size", "games_per_day",
  "max_hints_per_game", "late_submission_grace_hours", "signals_per_correct",
  "drop_lowest_n_days", "team_score_top_n",
]);
const NUM_FIELDS = new Set(["hint_penalty_pct", "target_solve_rate_pct"]);
const BOOL_FIELDS = new Set([
  "allow_free_agency", "allow_late_join", "allow_mid_season_team_switch",
  "hints_enabled", "streak_bonus_enabled", "publish_leaderboard",
]);

/** Coerce + whitelist an inbound config patch. Unknown keys are dropped, not
 *  rejected, so a future column can't break an old client; typed keys are
 *  coerced so `"3"` from a number input lands as 3. */
export function sanitizeConfigPatch(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of CONFIG_FIELDS) {
    if (!(key in input)) continue;
    const raw = input[key];

    if (BOOL_FIELDS.has(key)) {
      out[key] = raw === true || raw === "true";
    } else if (INT_FIELDS.has(key)) {
      out[key] = raw === "" || raw === null || raw === undefined ? null : toInt(raw);
    } else if (NUM_FIELDS.has(key)) {
      out[key] = raw === "" || raw === null || raw === undefined ? null : round2(Number(raw) || 0);
    } else if (key === "play_days_of_week") {
      out[key] = normalizeDayMask(raw);
    } else if (key === "extras") {
      out[key] = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    } else {
      out[key] = raw === "" ? null : raw;
    }
  }

  // Enum guards — a bad value would be a 400 from Postgres anyway; catching it
  // here produces a readable message instead of a raw constraint violation.
  clampEnum(out, "difficulty_curve", DIFFICULTY_CURVES);
  clampEnum(out, "team_score_method", TEAM_SCORE_METHODS);
  clampEnum(out, "leaderboard_visibility", LEADERBOARD_VISIBILITIES);

  // NOT NULL columns must never be nulled by an empty form field.
  for (const [k, fallback] of Object.entries(NOT_NULL_FALLBACKS))
    if (k in out && (out[k] === null || out[k] === undefined)) out[k] = fallback;

  return out;
}

const NOT_NULL_FALLBACKS: Record<string, unknown> = {
  max_teams_per_subscriber: 1,
  min_team_size: 1,
  max_hints_per_game: 3,
  hint_penalty_pct: 25,
  late_submission_grace_hours: 0,
  signals_per_correct: 1,
  drop_lowest_n_days: 0,
};

function clampEnum(obj: Record<string, unknown>, key: string, allowed: readonly string[]) {
  if (key in obj && !allowed.includes(String(obj[key]))) delete obj[key];
}

function toInt(v: unknown): number | null {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? n : null;
}

// ── cross-field validation (mirrors season_config_validate, pre-flight) ──────

export type Finding = { severity: "error" | "warning"; code: string; message: string };

/** Client-side mirror of the DB validator so the footer can show a live count
 *  without a round trip. The DB function stays THE authority (promote re-runs
 *  it server-side and blocks on errors) — this is an early warning, not a gate. */
export function localFindings(input: {
  games: { is_enabled: boolean }[];
  themeMix: { target_pct: number; is_excluded?: boolean }[];
  difficultyMix: { target_pct: number; applies_to_game_id?: string | null }[];
  gamesPerDay: number | null;
  teamScoreMethod: string;
  teamScoreTopN: number | null;
}): Finding[] {
  const out: Finding[] = [];
  const enabled = input.games.filter((g) => g.is_enabled).length;

  if (enabled === 0)
    out.push({ severity: "error", code: "no_games_enabled", message: "No games are enabled for this season." });

  if (input.gamesPerDay != null && input.gamesPerDay > enabled)
    out.push({
      severity: "error",
      code: "games_per_day_exceeds_slate",
      message: `Games per day (${input.gamesPerDay}) exceeds the ${enabled} enabled game${enabled === 1 ? "" : "s"}.`,
    });

  if (input.teamScoreMethod === "top_n" && !input.teamScoreTopN)
    out.push({ severity: "error", code: "top_n_missing", message: "Team scoring is top-N but no N is set." });

  const theme = sumPct(input.themeMix.filter((r) => !r.is_excluded).map((r) => r.target_pct));
  if (input.themeMix.length && !isHundred(theme))
    out.push({ severity: "warning", code: "theme_mix_not_100", message: `Theme mix totals ${theme}% (expected 100%).` });

  const diff = sumPct(input.difficultyMix.filter((r) => !r.applies_to_game_id).map((r) => r.target_pct));
  if (input.difficultyMix.length && !isHundred(diff))
    out.push({ severity: "warning", code: "difficulty_mix_not_100", message: `Difficulty mix totals ${diff}% (expected 100%).` });

  return out;
}

export function summarizeFindings(findings: Finding[]): string {
  const e = findings.filter((f) => f.severity === "error").length;
  const w = findings.filter((f) => f.severity === "warning").length;
  return `${w} warning${w === 1 ? "" : "s"} · ${e} error${e === 1 ? "" : "s"}`;
}

// ── version diff ─────────────────────────────────────────────────────────────

export type DiffRow = { field: string; before: unknown; after: unknown };

/** Field-by-field diff over the writable surface, CHANGED FIELDS ONLY. Used by
 *  the detail page's version compare and by the promote confirm dialog. */
export function diffConfigs(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null
): DiffRow[] {
  if (!after) return [];
  const rows: DiffRow[] = [];
  for (const field of CONFIG_FIELDS) {
    const a = before ? before[field] ?? null : null;
    const b = after[field] ?? null;
    if (canonicalJson(a) !== canonicalJson(b)) rows.push({ field, before: a, after: b });
  }
  return rows;
}

/** "max_teams_per_subscriber" → "Max teams per subscriber". */
export function fieldLabel(field: string): string {
  const s = field.replace(/_/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "On" : "Off";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
  if (typeof v === "object") return canonicalJson(v);
  return String(v);
}

// ── effective dating ─────────────────────────────────────────────────────────

/** What the promote button should say and do. `season_config_promote` decides
 *  the resulting state by comparing effective_from to now(); this mirrors that
 *  rule so the button never promises the wrong outcome. */
export function promoteIntent(effectiveFrom: string | null | undefined, now = new Date()): {
  action: "promote" | "schedule";
  label: string;
  resultingState: "active" | "scheduled";
} {
  const d = effectiveFrom ? new Date(effectiveFrom) : null;
  const future = !!d && !Number.isNaN(d.getTime()) && d.getTime() > now.getTime();
  return future
    ? { action: "schedule", label: "Schedule", resultingState: "scheduled" }
    : { action: "promote", label: "Promote now", resultingState: "active" };
}

// ── max_teams_per_subscriber guardrail ───────────────────────────────────────

/** How many subscribers already hold more memberships than a proposed new cap.
 *  Memberships are NEVER auto-removed — the commissioner is warned and decides.
 *  Input is the raw membership rows for the season. */
export function countOverCap(
  memberships: { subscriber_id: string }[],
  newCap: number
): { over: number; worst: number } {
  const counts = new Map<string, number>();
  for (const m of memberships) counts.set(m.subscriber_id, (counts.get(m.subscriber_id) ?? 0) + 1);
  let over = 0;
  let worst = 0;
  for (const n of counts.values()) {
    if (n > newCap) over++;
    if (n > worst) worst = n;
  }
  return { over, worst };
}
