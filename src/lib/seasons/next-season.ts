// CC-DC-LOBBY-EMPTY-STATE-1.0 (D8) — "what comes next" for an empty lobby.
//
// When `resolveSeasonFor` returns null there is nothing to serve today, and the
// lobby now says so (B4) instead of rendering seven mock tiles. "No challenge
// today." on its own is honest but useless, so /api/challenge/today also ships
// the next season's name and start date, and the empty-state card reads
// "Football Season starts November 2, 2026."
//
// ── Why `status=eq.upcoming` and never the other one ────────────────────────
// Seasons overlap (CC-LO-SEASONS-OVERLAP-1.0), so "the active season" is not a
// thing a read may pick — `npm run test:season-resolve` fails the build on that
// predicate anywhere under src/. This module only ever asks for seasons that
// have NOT started (`starts_on > today`), which is exactly the set whose status
// is `upcoming`, so the forbidden predicate never comes up.
//
// ── Why `today` is a parameter ──────────────────────────────────────────────
// The CT serve day has exactly ONE owner: `todayCT()` in lib/seasons/golive.ts
// (CC-DC-SEASON-GOLIVE-1.0). The caller passes its result in rather than this
// module importing it, which keeps this file free of top-level imports so
// `node --test` can load it directly — the same contract golive.ts honors and
// for the same reason.
//
// Fail-soft everywhere: every failure path returns null, and null simply means
// the empty-state card omits the "starts …" line. The lobby must never
// hard-fail on a nice-to-have.

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://ycadmmngkdhvpcsrcuaq.supabase.co";

/** What the API ships to the client. `starts_on` is a YYYY-MM-DD calendar date
 *  (no instant, no timezone — the client formats it as written). */
export type NextSeason = { name: string | null; starts_on: string };

export type UpcomingSeasonRow = { id: string; name?: string | null; starts_on?: string | null };
export type SeasonScopeRow = {
  season_id?: string | null;
  scope_type?: string | null;
  is_excluded?: boolean | null;
};

/** How many future seasons we look at before giving up on finding a
 *  platform-scoped one. Prod has had at most a handful of future seasons at a
 *  time; this is a cap, not a page. */
export const CANDIDATE_LIMIT = 20;

/** THE PostgREST filter for "seasons that have not started yet, soonest
 *  first". Exported so the test asserts the exact predicate rather than
 *  re-deriving it. */
export function upcomingSeasonsFilter(today: string): string {
  return (
    `seasons?select=id,name,starts_on` +
    `&status=eq.upcoming` +
    `&starts_on=gt.${encodeURIComponent(today)}` +
    `&order=starts_on.asc&limit=${CANDIDATE_LIMIT}`
  );
}

/** The scope rules for a set of candidate seasons, in one read. */
export function seasonScopesFilter(ids: readonly string[]): string {
  const list = ids.map((id) => `"${id}"`).join(",");
  return `season_scopes?season_id=in.(${list})&select=season_id,scope_type,is_excluded`;
}

/**
 * Is this season's scope the whole platform? Pure.
 *
 * CC-LO-SEASON-SCOPE-1.0 D4: **no include rows ⇒ the whole platform**, and an
 * explicit non-excluded `platform` include row means the same thing. Exclusions
 * do not change the answer — "everyone except Acme" is still a season the whole
 * platform can see announced.
 *
 * This is NOT scope resolution. Resolving scope to a TEAM LIST in TypeScript is
 * forbidden (`fn_season_scope_teams` owns that, and the old
 * `resolveScopeTeamCount` is gone for disagreeing with it). This reads the
 * include MODE off the saved rules to decide whether a season is announceable
 * to everyone — the same two lines `summarizeScopes` already uses for the
 * League Office "All Leagues" label.
 */
export function isPlatformScoped(rows: readonly SeasonScopeRow[] | null | undefined): boolean {
  const included = (rows ?? []).filter((r) => r && r.is_excluded !== true);
  if (included.length === 0) return true;
  return included.some((r) => r.scope_type === "platform");
}

/**
 * The earliest platform-scoped candidate. Pure — the whole decision, so the
 * test never touches PostgREST.
 *
 * Candidates are re-sorted here rather than trusted: `order=starts_on.asc`
 * already asks for it, but the pick must not depend on the server honoring it.
 */
export function pickNextSeason(
  candidates: readonly UpcomingSeasonRow[] | null | undefined,
  scopes: readonly SeasonScopeRow[] | null | undefined
): NextSeason | null {
  const byId = new Map<string, SeasonScopeRow[]>();
  for (const r of scopes ?? []) {
    const id = r?.season_id;
    if (typeof id !== "string" || !id) continue;
    const list = byId.get(id);
    if (list) list.push(r);
    else byId.set(id, [r]);
  }

  const ordered = (candidates ?? [])
    .filter(
      (c): c is UpcomingSeasonRow & { id: string; starts_on: string } =>
        !!c && typeof c.id === "string" && typeof c.starts_on === "string" && !!c.starts_on
    )
    .sort((a, b) => a.starts_on.localeCompare(b.starts_on));

  for (const c of ordered) {
    if (!isPlatformScoped(byId.get(c.id))) continue;
    const name = typeof c.name === "string" && c.name.trim() ? c.name.trim() : null;
    return { name, starts_on: c.starts_on };
  }
  return null;
}

/**
 * The next platform-scoped season after `today` (a CT YYYY-MM-DD from
 * `todayCT()`), or null.
 *
 * `headers` are service-role PostgREST headers — `seasons` and `season_scopes`
 * are not read with the anon key anywhere else either. Two reads, not one
 * embedded read: the embed would depend on a PostgREST-visible FK between
 * `season_scopes` and `seasons`, and a missing relationship there would 400 and
 * silently blank the line.
 *
 * Never throws. Returns null on a missing key, a non-2xx, a malformed body, or
 * a thrown fetch — including a failed SCOPE read, which is deliberate: an
 * unverified season is not announced rather than announced to the wrong people.
 */
export async function fetchNextSeason(
  headers: Record<string, string> | null | undefined,
  today: string | null | undefined
): Promise<NextSeason | null> {
  if (!headers || !today) return null;
  try {
    const seasonsRes = await fetch(`${SUPABASE_URL}/rest/v1/${upcomingSeasonsFilter(today)}`, {
      headers,
      cache: "no-store",
    });
    if (!seasonsRes.ok) return null;
    const candidates = await seasonsRes.json().catch(() => null);
    if (!Array.isArray(candidates) || candidates.length === 0) return null;

    const ids = candidates
      .map((c) => (c && typeof c.id === "string" ? c.id : null))
      .filter((id): id is string => !!id);
    if (ids.length === 0) return null;

    const scopesRes = await fetch(`${SUPABASE_URL}/rest/v1/${seasonScopesFilter(ids)}`, {
      headers,
      cache: "no-store",
    });
    if (!scopesRes.ok) return null;
    const scopes = await scopesRes.json().catch(() => null);
    if (!Array.isArray(scopes)) return null;

    return pickNextSeason(candidates as UpcomingSeasonRow[], scopes as SeasonScopeRow[]);
  } catch {
    return null;
  }
}
