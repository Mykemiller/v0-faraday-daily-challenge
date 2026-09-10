// GET /api/challenge/today[?token=…]
//
// Returns today's puzzle set for the Daily Challenge lobby. The optional
// session token selects WHOSE puzzles: seasons are independent and may overlap
// (CC-LO-CONCURRENT-SEASONS-1.0), so the set is the caller's SEASON's Live rows
// — resolved once here via lib/seasons/resolve (their confirmed in-scope team
// membership; anonymous or team-less → the platform default season) and passed
// down to both the bank read and the slate. An invalid/expired token is treated
// as anonymous, never as an error: the lobby must never hard-fail.
//
// Returns:
//   { puzzles: { "Rackl": {...}, "Signal Drop": {...}, ... }, tip: {...} | null }
//
// `puzzles` is keyed by puzzle type and contains only the types that have a
// valid published puzzle in the Airtable Puzzle Bank. The component fills any
// missing type from its built-in mock data, so a partial (or empty) response
// still renders all 7 games.
//
// If Airtable is unreachable or misconfigured, we respond 200 with empty
// puzzles and tip:null rather than erroring — the lobby must never hard-fail.
//
// CACHING: this response is served `no-store`. It used to carry
// `public, s-maxage=3600, stale-while-revalidate=86400`, which publicly cached
// the payload at the edge/browser for up to ~25h. That was actively harmful:
// (1) the payload is answer-adjacent and rotates daily, and historically DID
// carry the Signal Drop answer, so a shared/public cache could serve a solved
// game's answer to other players and keep serving a stale set across the
// midnight rotation; (2) after a fix ships, stale-while-revalidate can keep
// serving the pre-fix (leaky) copy for a day. The Airtable read is still cached
// server-side for an hour (`next: { revalidate: 3600 }` in the puzzle-bank
// helper), so `no-store` costs a route execution, not an upstream fetch.

// DC_PUZZLE_SOURCE selects airtable (default) or supabase — see puzzle-bank.js.
import { getLivePuzzles, getTipOfTheDay } from "@/lib/puzzle-bank";
// Season slate enforcement (retires D4 — the slate used to be advisory). Applied
// to the RESULT of getLivePuzzles(), so it is backend-agnostic: it works
// identically on the Airtable and Supabase paths, and does not wait on the
// DC_PUZZLE_SOURCE cutover.
import { filterToSlate } from "@/lib/season-slate";
import { resolveSeasonSlate } from "@/lib/season-slate-server";
import { resolveSeasonFor } from "@/lib/seasons/resolve";

// Read live each request; do not statically prerender at build time.
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://ycadmmngkdhvpcsrcuaq.supabase.co";

function svcHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return { apikey: key, Authorization: `Bearer ${key}` };
}

// dc_sessions token → subscriber id, or null (missing, unknown, expired, or any
// read failure — all of which mean "serve as anonymous").
async function resolveSubscriberId(h, token) {
  if (!h || !token) return null;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/dc_sessions?token=eq.${encodeURIComponent(token)}&select=subscriber_id,expires_at&limit=1`,
      { headers: h, cache: "no-store" }
    );
    if (!r.ok) return null;
    const rows = await r.json().catch(() => null);
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row || (row.expires_at && new Date(row.expires_at) < new Date())) return null;
    return row.subscriber_id ?? null;
  } catch {
    return null;
  }
}

// CT calendar date (matches the sync's puzzle_date + the AUTO-128 rotator).
function centralDate(d) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

// Faraday's Take (FAR-389) + Faraday Signal (FAR-385): read today's per-puzzle
// editorial extras from dc_daily_page_content — the canonical day-content store
// (D12: dc_daily_page_content is THE read path so Airtable / dc_daily_signal
// are never in the hot path; the signal was matched + denormalized by the
// sync-day-content cron). Returns { [puzzleType]: { take, byline, signal } }.
// Fails soft to {} on any missing config / table / row so the lobby never
// hard-fails — the win screen then shows the explanation fallback (take) and
// no card (signal).
async function fetchTodaysTakes() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return {};
  try {
    const today = centralDate(new Date());
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/dc_daily_page_content?puzzle_date=eq.${today}&select=puzzles`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: "no-store" }
    );
    if (!res.ok) return {};
    const rows = await res.json().catch(() => null);
    const row = Array.isArray(rows) ? rows[0] : null;
    const puzzles = row && Array.isArray(row.puzzles) ? row.puzzles : [];
    const out = {};
    for (const p of puzzles) {
      if (!p || typeof p.puzzle_type !== "string") continue;
      const take =
        typeof p.faradays_take === "string" && p.faradays_take.trim()
          ? p.faradays_take.trim()
          : null; // no authored take → fall back to the explanation (D14)
      const byline =
        typeof p.take_byline === "string" && p.take_byline.trim()
          ? p.take_byline.trim()
          : null; // null → the component defaults the byline by game type (D13)

      // FAR-385: the sync-time match, already resolved to public fields.
      // tier "none" (or malformed data) → no signal key → no card, no frame.
      let signal = null;
      const tier = p.signal_match_tier;
      const s = p.signal;
      if (
        (tier === "matched" || tier === "lead") &&
        s && typeof s.headline === "string" && s.headline.trim() &&
        typeof s.body === "string" && s.body.trim()
      ) {
        signal = {
          tier,
          headline: s.headline.trim(),
          body: s.body.trim(),
          source_url: typeof s.source_url === "string" && s.source_url.trim() ? s.source_url.trim() : null,
          source_label: typeof s.source_label === "string" && s.source_label.trim() ? s.source_label.trim() : null,
          signal_date: typeof s.signal_date === "string" ? s.signal_date : null,
        };
      }

      if (!take && !signal) continue;
      out[p.puzzle_type] = { take, byline, signal };
    }
    return out;
  } catch {
    return {};
  }
}

// FAR-388: per-game-type solve-time percentile bands (terciles) from
// dc_solve_time_bands, so the client's Market Reaction Speed band can score
// against real data once it accumulates. Returns { [gameType]: { p33Sec, p67Sec,
// sampleSize } }. Fails soft to {} — the band falls back to seed par times, so
// the lobby never hard-fails on this. Read server-side (service role) because the
// table is deny-all/service-role only (not exposed to PostgREST anon).
async function fetchSolveBands() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return {};
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/dc_solve_time_bands?select=game_type,p33_sec,p67_sec,sample_size`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: "no-store" }
    );
    if (!res.ok) return {};
    const rows = await res.json().catch(() => null);
    if (!Array.isArray(rows)) return {};
    const out = {};
    for (const r of rows) {
      if (!r || typeof r.game_type !== "string") continue;
      const p33 = Number(r.p33_sec);
      const p67 = Number(r.p67_sec);
      const n = Number(r.sample_size);
      if (!Number.isFinite(p33) || !Number.isFinite(p67) || !Number.isFinite(n)) continue;
      out[r.game_type] = { p33Sec: p33, p67Sec: p67, sampleSize: n };
    }
    return out;
  } catch {
    return {};
  }
}

export async function GET(request) {
  try {
    // Whose puzzles? Resolve the season ONCE, then fan out.
    const token = new URL(request.url).searchParams.get("token") ?? "";
    const h = svcHeaders();
    const subscriberId = await resolveSubscriberId(h, token);
    const season = await resolveSeasonFor(h, subscriberId);
    const seasonId = season?.id ?? null;

    const [livePuzzles, tip, takes, solveBands, slate] = await Promise.all([
      getLivePuzzles({ seasonId }),
      getTipOfTheDay(),
      fetchTodaysTakes(),
      fetchSolveBands(),
      resolveSeasonSlate(seasonId),
    ]);

    // Narrow to the season's enabled games. A null slate leaves the set
    // untouched — see season-slate.ts for the two fail-safes and why they are
    // load-bearing (3 of 6 prod seasons have no active config).
    const puzzles = filterToSlate(livePuzzles, slate);
    // Attach the take + signal to each puzzle by type (spoiler-safe: both are
    // rendered only on the completion screen, after the player has solved that
    // puzzle — and the signal carries no answer material by construction).
    for (const [type, entry] of Object.entries(takes)) {
      if (puzzles && puzzles[type]) {
        if (entry.take) {
          puzzles[type].faradays_take = entry.take;
          puzzles[type].take_byline = entry.byline;
        }
        if (entry.signal) puzzles[type].signal = entry.signal;
      }
    }
    // `slate` rides along so the lobby can render the season's games rather than
    // its hardcoded GAME_CONFIGS list — without it a disabled game keeps its
    // tile and falls through to mock data when tapped. null = show everything.
    // `season` names the season these puzzles belong to (null = platform rows
    // only). Informational — the client keys nothing off it yet.
    return Response.json(
      { puzzles, tip, solveBands, slate, season: season ? { id: season.id, name: season.name ?? null } : null },
      { headers: NO_STORE }
    );
  } catch (err) {
    console.error("[/api/challenge/today] falling back to empty set:", err);
    return Response.json({ puzzles: {}, tip: null, solveBands: {}, slate: null, season: null }, { headers: NO_STORE });
  }
}
