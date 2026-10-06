// CC-DC-LOBBY-EMPTY-STATE-1.0 (D9) — what the lobby shows when there is
// nothing to show.
//
// ── The bug this exists to make impossible (FDY-43/46 B4) ───────────────────
// Football Season sat at status `upcoming` with 595 `Published` rows and 0
// `Live` rows, so `resolveSeasonFor` returned null and /api/challenge/today
// returned exactly:
//
//   {"puzzles":{},"tip":null,"solveBands":{},"slate":null,"season":null}
//
// The lobby rendered a full, playable seven-game suite on top of that empty
// response — because `livePuzzles[activeGame] || MOCK_PUZZLES[activeGame]` had
// no environment guard. Players spent a day solving FIXTURES, scored nothing
// real, and the outage was invisible for 24 hours precisely BECAUSE the fake
// lobby looked healthy. A blank response must read as blank.
//
// So: **in production, mock puzzles are never served, for any reason.** Not on a
// failed fetch, not on a missing season, not for a single absent game. The only
// way a mock reaches a player is a non-production build, or an explicit
// `?mock=1` escape hatch, and even then every tile is labelled MOCK.
//
// ── Why a pure function ─────────────────────────────────────────────────────
// The rule is one `if` away from silently regressing inside a 3,450-line
// component, so the decision lives here, is a pure function of
// ({apiOk, data, isProd}) plus its two injected fixtures, and is pinned by
// `npm run test:lobby-model` — including the assertion that production never
// returns a mock puzzle. DailyChallenge.jsx computes the model once and
// branches on `mode`; it holds no copy of these rules.
//
// Deliberately free of top-level imports (same contract as
// lib/seasons/golive.ts) so `node --test` can load it directly. Consequences:
//   * the game ORDER is injected (`order`) — it comes from game_catalog via
//     useGameRegistry, never from a hardcoded list and never from the mock
//     fixture's keys (CC-DC-GAME-REGISTRY-1.0);
//   * MOCK_PUZZLES is injected (`mockPuzzles`), which is also what makes the
//     production guard testable from the outside;
//   * the slate fail-safes are restated below rather than imported from
//     lib/season-slate.ts — keep the two in step.
//
// To see the empty states in a browser, run a production build
// (`npx next build && npx next start`): outside production the mock fallback is
// on by default, which is the point of it.

/** `loading` = the fetch is still in flight. The other four are terminal. */
export type LobbyMode = "loading" | "error" | "no_season" | "no_puzzles" | "live";

export type LobbyGame = {
  /** game_catalog.runtime_key — "Rackl", "Signal Drop", … */
  key: string;
  /** The puzzle to play, or null when this season serves the game but today
   *  has no puzzle for it. */
  puzzle: unknown | null;
  /** false → render the tile DISABLED with `LOBBY_COPY.unavailable`. */
  available: boolean;
  /** true → `puzzle` is fixture content. NEVER true in production. */
  mock: boolean;
};

export type NextSeasonInfo = { name: string | null; starts_on: string | null };

export type LobbyModel = {
  mode: LobbyMode;
  /** Empty in every mode but `live`: "no game tiles" is literal. */
  games: LobbyGame[];
  nextSeason: NextSeasonInfo | null;
  /** Games actually playable today — THE denominator for "n/N puzzles today".
   *  Never the hardcoded 7: a five-game slate reads "n/5". */
  servedCount: number;
  headline: string | null;
  body: string | null;
  /** Only the error state offers a retry. */
  retry: boolean;
};

/** The /api/challenge/today body, as far as the lobby is concerned. The route
 *  ships `tip` and `solveBands` too; those are read elsewhere, hence the index
 *  signature rather than a narrower type that callers would have to cast past. */
export type TodayPayload = {
  puzzles?: Record<string, unknown> | null;
  slate?: string[] | null;
  season?: { id?: string | null; name?: string | null } | null;
  nextSeason?: { name?: string | null; starts_on?: string | null } | null;
  [extra: string]: unknown;
};

export type LobbyInput = {
  /** null/undefined → still loading; false → the request failed; true → `data`
   *  is a 200 body (which may legitimately be empty). */
  apiOk?: boolean | null;
  data?: TodayPayload | null;
  /** `process.env.NODE_ENV === "production" && !mockOverride`. Defaults to
   *  TRUE when omitted — a caller that forgets gets the safe behaviour. */
  isProd?: boolean;
  /** Canonical lobby order, from the game registry. */
  order?: readonly string[] | null;
  /** MOCK_PUZZLES. Ignored entirely when `isProd`. */
  mockPuzzles?: Record<string, unknown> | null;
};

export const LOBBY_COPY = {
  loading: "Loading today's challenge…",
  error: "We couldn't load today's challenge.",
  retry: "Retry",
  noSeason: "No challenge today.",
  noPuzzles: "Today's puzzles aren't out yet — check back soon.",
  /** The disabled tile's badge, for a slate game with no puzzle today. */
  unavailable: "Unavailable today",
  /** Non-production tiles carry this so fixture content can never be mistaken
   *  for real content — the thing that hid B4 for a day. */
  mockBadge: "MOCK",
} as const;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * "2026-11-02" → "November 2, 2026". Pure string work on purpose: `new
 * Date("2026-11-02")` is parsed as UTC midnight and formats as November 1 for
 * every player west of Greenwich — including every player in CT, which is the
 * timezone the date was computed in.
 *
 * Returns null for anything that is not a YYYY-MM-DD calendar date.
 */
export function formatStartsOn(startsOn: string | null | undefined): string | null {
  if (typeof startsOn !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startsOn.trim());
  if (!m) return null;
  const month = MONTHS[Number(m[2]) - 1];
  const day = Number(m[3]);
  if (!month || day < 1 || day > 31) return null;
  return `${month} ${day}, ${Number(m[1])}`;
}

/** "Football Season starts November 2, 2026." — or null when there is no next
 *  season, or its date is unusable (never a half-sentence). */
export function nextSeasonLine(next: NextSeasonInfo | null | undefined): string | null {
  const when = formatStartsOn(next?.starts_on);
  if (!when) return null;
  const name = typeof next?.name === "string" && next.name.trim() ? next.name.trim() : null;
  return `${name ?? "The next season"} starts ${when}.`;
}

function normalizeNextSeason(raw: unknown): NextSeasonInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { name?: unknown; starts_on?: unknown };
  const starts_on = typeof r.starts_on === "string" && r.starts_on.trim() ? r.starts_on.trim() : null;
  const name = typeof r.name === "string" && r.name.trim() ? r.name.trim() : null;
  if (!starts_on && !name) return null;
  return { name, starts_on };
}

/**
 * The season's games, in lobby order.
 *
 * Mirrors `servedGameList` in lib/season-slate.ts, fail-safes included, and
 * they must stay in step:
 *   1. no slate (null/empty) → every game the registry knows about, which is
 *      the pre-D4-retirement behaviour;
 *   2. a slate that matches NO known game → the same, because that is a
 *      renamed runtime_key or an unrotated bank, not an instruction to serve
 *      nothing.
 *
 * Neither fail-safe can blank the lobby on its own: with a season present and
 * no puzzles the mode is `no_puzzles` regardless of how wide this list is.
 */
export function slateGames(
  order: readonly string[] | null | undefined,
  slate: readonly string[] | null | undefined
): string[] {
  const all = Array.isArray(order) ? order.filter((k): k is string => typeof k === "string" && !!k) : [];
  if (!Array.isArray(slate) || slate.length === 0) return all;
  const allow = new Set(slate);
  const inOrder = all.filter((k) => allow.has(k));
  return inOrder.length > 0 ? inOrder : all;
}

/** The keys the header menus and the in-game switcher may navigate to: the
 *  playable ones only, so neither can route a player into a game that has no
 *  puzzle today. */
export function servedKeys(model: LobbyModel | null | undefined): string[] {
  return (model?.games ?? []).filter((g) => g.available).map((g) => g.key);
}

/** A tile-less state. The four empty modes differ only in their copy. */
function empty(
  mode: LobbyMode,
  extra?: {
    nextSeason?: NextSeasonInfo | null;
    headline?: string | null;
    body?: string | null;
    retry?: boolean;
  }
): LobbyModel {
  return {
    mode,
    games: [],
    servedCount: 0,
    nextSeason: extra?.nextSeason ?? null,
    headline: extra?.headline ?? null,
    body: extra?.body ?? null,
    retry: extra?.retry ?? false,
  };
}

/**
 * THE lobby state machine. Pure.
 *
 *   apiOk == null                      → loading
 *   apiOk === false                    → error      (no tiles, offer Retry)
 *   season null                        → no_season  (no tiles, no Start now)
 *   season present, nothing playable   → no_puzzles (no tiles)
 *   season present, something playable → live
 *
 * `error` and `loading` are decided BEFORE the environment is considered: they
 * describe the request, not the content, and a developer whose API is down
 * needs to see that rather than a fixture lobby. Outside production the mock
 * fallback then applies to all three CONTENT paths — a no-season lobby, a
 * no-puzzle lobby and an individual missing game all fill from the fixture and
 * every such tile is `mock: true`. Note the common dev case does not even reach
 * it: with no SUPABASE_SERVICE_ROLE_KEY the route still answers 200 with an
 * empty set, so `apiOk` is true.
 */
export function lobbyModel(input: LobbyInput | null | undefined): LobbyModel {
  const inp = input ?? {};
  const isProd = inp.isProd !== false;
  const mocks = isProd || !inp.mockPuzzles || typeof inp.mockPuzzles !== "object" ? null : inp.mockPuzzles;

  if (inp.apiOk === null || inp.apiOk === undefined) {
    return empty("loading", { headline: LOBBY_COPY.loading });
  }
  if (inp.apiOk === false) {
    return empty("error", { headline: LOBBY_COPY.error, retry: true });
  }

  const data: TodayPayload = inp.data && typeof inp.data === "object" ? inp.data : {};
  const nextSeason = normalizeNextSeason(data.nextSeason);
  const season = data.season && typeof data.season === "object" ? data.season : null;
  const puzzles: Record<string, unknown> =
    data.puzzles && typeof data.puzzles === "object" ? data.puzzles : {};
  const slate = Array.isArray(data.slate) ? data.slate : null;

  // A null season is the outage shape: there is nothing to serve, to anyone.
  if (!season) {
    if (!mocks) {
      return empty("no_season", {
        nextSeason,
        headline: LOBBY_COPY.noSeason,
        body: nextSeasonLine(nextSeason),
      });
    }
    // Non-production only — see the header.
    const games = slateGames(inp.order, slate)
      .filter((key) => !!mocks[key])
      .map((key) => ({ key, puzzle: mocks[key], available: true, mock: true }));
    if (games.length === 0) {
      return empty("no_season", {
        nextSeason,
        headline: LOBBY_COPY.noSeason,
        body: nextSeasonLine(nextSeason),
      });
    }
    return { mode: "live", games, nextSeason, servedCount: games.length, headline: null, body: null, retry: false };
  }

  const games: LobbyGame[] = slateGames(inp.order, slate).map((key) => {
    const live = Object.prototype.hasOwnProperty.call(puzzles, key) ? puzzles[key] : null;
    if (live) return { key, puzzle: live, available: true, mock: false };
    const mock = mocks && mocks[key] ? mocks[key] : null;
    if (mock) return { key, puzzle: mock, available: true, mock: true };
    // In the season but not in today's set: the tile is shown DISABLED rather
    // than hidden — the season does serve this game, just not today.
    return { key, puzzle: null, available: false, mock: false };
  });

  const servedCount = games.filter((g) => g.available).length;
  if (servedCount === 0) {
    return empty("no_puzzles", { nextSeason, headline: LOBBY_COPY.noPuzzles });
  }

  return { mode: "live", games, nextSeason, servedCount, headline: null, body: null, retry: false };
}
