// CC-DC-SEASON-GOLIVE-1.0 — the ONE module that owns "make today correct".
//
// Before this module, two nightly jobs were the only writers of the two
// transitions that decide whether anything serves today:
//
//   upcoming → active     only fn_leaderboard_rollover(), pg_cron 05:00/06:00 UTC
//   Published → Live      only /api/cron/rotate, behind a CT-midnight guard
//
// So a season created at noon inside its own window served nothing until the
// next morning (FDY-43 B1), puzzles approved at 21:43 for today never went
// Live (B2), and dc_daily_page_content for today — already mirrored at 05:10
// from an empty Live set — was never refreshed (B6). This module performs all
// three transitions on demand, from the three moments a commissioner's action
// can make today's answer change, plus an hourly backstop cron.
//
// PROMOTE-ONLY. Nothing here ever demotes or closes a season: closing is
// fn_leaderboard_rollover()'s job because it also archives the leaderboard
// results, and duplicating that here would lose them. `statusForWindow` can
// REPORT "closed"; `activateDueSeasons` only ever writes `active`.
//
// Deliberately free of top-level runtime imports. Two reasons:
//   1. `node --test src/lib/seasons/golive.test.ts` can load it directly, the
//      same contract every other node-tested module in this repo honors.
//   2. The two heavy dependencies — the source-agnostic puzzle-bank facade and
//      the day-content sync — are resolved at CALL time via dynamic import and
//      can be injected, so the tests never touch Supabase, Airtable or the
//      Anthropic API.
//
// The puzzle-bank facade (`@/lib/puzzle-bank`) is the only rotation entry
// point used here. Never call fn_dc_rotate_live_set directly: the facade is
// what keeps DC_PUZZLE_SOURCE a one-env-var cutover.

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://ycadmmngkdhvpcsrcuaq.supabase.co";

/** Structurally identical to league-office `Svc` — declared locally so this
 *  module stays import-free (see the header). Any `Svc` is assignable. */
export type GoLiveSvc = { base: string; headers: Record<string, string> };

export type SeasonStatus = "upcoming" | "active" | "closed";

const LOG = "[season-golive]";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ── the CT day ───────────────────────────────────────────────────────────────

/** Current date (YYYY-MM-DD) and hour in America/Chicago, DST-aware. THE
 *  serve-day boundary for the whole app: /api/cron/rotate and
 *  /api/cron/sync-day-content both import this rather than keeping their own
 *  copy, so the rotator, the sync and the go-live path can never disagree
 *  about which day it is. */
export function chicagoNow(now?: Date): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now ?? new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
  };
}

/** Today's serve day in America/Chicago, as YYYY-MM-DD. */
export function todayCT(now?: Date): string {
  return chicagoNow(now).date;
}

// ── the rule (pure) ──────────────────────────────────────────────────────────

/**
 * The status a season's window implies for `today`. Pure — no I/O, no clock.
 *
 * `currentStatus` only ever makes the answer MORE conservative: a season that
 * is already closed stays closed, because closing archived its leaderboard and
 * reopening it is not a thing this module is allowed to do. Everything else is
 * decided by the window alone.
 */
export function statusForWindow(
  startsOn: string | null | undefined,
  endsOn: string | null | undefined,
  today: string | null | undefined,
  currentStatus?: string | null
): SeasonStatus {
  if (currentStatus === "closed") return "closed";
  if (!startsOn || !endsOn || !today) return "upcoming";
  if (today < startsOn) return "upcoming";
  if (today > endsOn) return "closed";
  return "active";
}

/**
 * D5: approving a set of go-live dates — does anything need to go live RIGHT
 * NOW, and if not, which day does this season first serve?
 *
 * Pure, so the gate that decides whether approveSeasonPuzzles triggers a
 * go-live is testable without touching Supabase. `firstServeDay` is the
 * earliest approved date still ahead of today, falling back to the earliest
 * date overall (a backfill approval has no future date).
 */
export function approvalGoLivePlan(
  dates: readonly string[],
  today: string
): { goLive: true } | { goLive: false; firstServeDay: string | null } {
  if (dates.includes(today)) return { goLive: true };
  const sorted = [...dates].sort();
  return { goLive: false, firstServeDay: sorted.find((d) => d > today) ?? sorted[0] ?? null };
}

// ── B1: upcoming → active ────────────────────────────────────────────────────

/** THE PostgREST filter for "upcoming seasons whose window contains today".
 *  Exported so the test can assert the exact predicate rather than re-deriving
 *  it. `status=eq.upcoming` is deliberately the only status this module filters
 *  on — a `status=eq.active` read would be picking "the active season", which
 *  overlapping seasons made meaningless (CC-LO-CONCURRENT-SEASONS-1.0). */
export function dueSeasonsFilter(today: string): string {
  return `seasons?status=eq.upcoming&starts_on=lte.${today}&ends_on=gte.${today}`;
}

export type ActivatedSeason = {
  id: string;
  name: string | null;
  starts_on: string | null;
  ends_on: string | null;
};

/**
 * Flips every upcoming season whose window contains `today` to active and
 * returns the rows it flipped. ONE writer of the rule: createSeason still
 * inserts `upcoming` and lets this decide, so there is exactly one place that
 * knows a window containing today means "serving".
 *
 * Idempotent by construction — the filter excludes anything already active, so
 * the second run matches nothing and returns [].
 *
 * Throws on a transport/PostgREST failure; `goLiveToday` captures it.
 */
export async function activateDueSeasons(
  s: GoLiveSvc,
  today: string
): Promise<ActivatedSeason[]> {
  const url = `${SUPABASE_URL}/rest/v1/${dueSeasonsFilter(
    today
  )}&select=id,name,starts_on,ends_on`;
  const r = await fetch(url, {
    method: "PATCH",
    headers: { ...s.headers, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ status: "active" }),
    cache: "no-store",
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`seasons activate failed (${r.status}): ${body.slice(0, 300)}`);
  }
  const rows = await r.json().catch(() => null);
  if (!Array.isArray(rows)) return [];
  return rows.filter((row) => row && typeof row.id === "string") as ActivatedSeason[];
}

// ── small PostgREST helpers (local, so the module keeps no imports) ──────────

async function rows(s: GoLiveSvc, path: string): Promise<unknown[]> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: s.headers,
    cache: "no-store",
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`read ${path.split("?")[0]} failed (${r.status}): ${body.slice(0, 200)}`);
  }
  const j = await r.json().catch(() => null);
  return Array.isArray(j) ? j : [];
}

/** Any staging row in `state` for `date`? Selects `puzzle_type` only — never a
 *  content, hint or answer_key column. */
async function hasBankRows(s: GoLiveSvc, state: "Published" | "Live", date: string): Promise<boolean> {
  const got = await rows(
    s,
    `dc_puzzle_bank_staging?published=eq.${state}&go_live_date=eq.${date}&select=puzzle_type&limit=1`
  );
  return got.length > 0;
}

/** How many puzzles today's dc_daily_page_content row describes, or null when
 *  the row does not exist. Reads `about_content->games` — one entry per puzzle,
 *  carrying type/name/topic only — so the check never pulls puzzle content.
 *  A row whose shape cannot be read counts as empty: re-syncing a day is
 *  idempotent, silently serving an empty day is not. */
async function dayContentPuzzleCount(s: GoLiveSvc, date: string): Promise<number | null> {
  const got = await rows(
    s,
    `dc_daily_page_content?puzzle_date=eq.${date}&select=about_content->games&limit=1`
  );
  if (!got.length) return null;
  const games = (got[0] as { games?: unknown })?.games;
  return Array.isArray(games) ? games.length : 0;
}

/** One lo_audit_log row per auto-activated season, same shape and domain as
 *  season-write.ts's writeAudit. Fail-soft: a missing audit row must never
 *  stop a season going live. */
async function auditAutoActivate(
  s: GoLiveSvc,
  season: ActivatedSeason,
  opts: { reason: string; actor?: string }
): Promise<void> {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/lo_audit_log`, {
      method: "POST",
      headers: { ...s.headers, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({
        domain: "seasons",
        staff_email: opts.actor || "system",
        action: "season.auto_activate",
        reason: opts.reason,
        target_type: "season",
        target_id: season.id,
        before: { status: "upcoming" },
        after: {
          status: "active",
          name: season.name,
          starts_on: season.starts_on,
          ends_on: season.ends_on,
        },
        reversible: false,
      }),
      cache: "no-store",
    });
  } catch (e) {
    console.error(`${LOG} audit row failed for ${season.id}:`, msg(e));
  }
}

// ── goLiveToday ──────────────────────────────────────────────────────────────

export type RotateResult = { promoted?: number; retired?: number; missingTypes?: string[] };
export type SyncResult = { ok: boolean; puzzleCount?: number; error?: string };

/** Injection seam for the two heavy dependencies plus the clock. Unset in
 *  production — the real modules are loaded lazily. */
export type GoLiveDeps = {
  rotateLiveSet?: (today: string) => Promise<RotateResult>;
  syncDayContent?: (date: string) => Promise<SyncResult>;
  now?: Date;
};

export type GoLiveResult = {
  today: string;
  /** ids of the seasons flipped upcoming → active by THIS call. */
  activated: string[];
  /** rows flipped Published → Live by THIS call. */
  promoted: number;
  /** did dc_daily_page_content get rewritten for today? */
  synced: boolean;
  /** every step that did nothing, and why — including every failure. */
  skipped: string[];
};

/**
 * Make today correct, in dependency order:
 *
 *   1. activate every upcoming season whose window contains today (B1), and
 *      audit each flip;
 *   2. if any staging row is Published for today, rotate the Live set through
 *      the puzzle-bank facade (B2);
 *   3. refresh dc_daily_page_content for today when the rotation promoted
 *      anything, OR when today has Live rows but the day-content row is
 *      missing or describes zero puzzles (B6).
 *
 * NEVER THROWS. Every failure lands in `skipped` and is logged under
 * `[season-golive]`, because every caller is a side effect of some other
 * successful action — a season create must not 500 because the rotation did,
 * and the hourly cron must still report what it managed to do.
 *
 * Idempotent: a second consecutive run returns activated=[], promoted=0 and
 * leaves dc_daily_page_content alone (step 1's filter excludes active seasons,
 * step 2 finds no Published rows once they are Live, step 3 sees a populated
 * day-content row).
 */
export async function goLiveToday(
  s: GoLiveSvc | null | undefined,
  opts: { reason: string; actor?: string; today?: string },
  deps: GoLiveDeps = {}
): Promise<GoLiveResult> {
  const today = opts.today || todayCT(deps.now);
  const out: GoLiveResult = { today, activated: [], promoted: 0, synced: false, skipped: [] };

  if (!s || !s.headers) {
    out.skipped.push("no-service-credentials");
    console.error(`${LOG}`, JSON.stringify({ reason: opts.reason, ...out }));
    return out;
  }

  // 1 ── B1: a season whose window contains today must be serving today.
  try {
    const activated = await activateDueSeasons(s, today);
    out.activated = activated.map((a) => a.id);
    if (!activated.length) out.skipped.push("no-seasons-due");
    for (const season of activated) await auditAutoActivate(s, season, opts);
  } catch (e) {
    out.skipped.push(`activate-failed: ${msg(e)}`);
  }

  // 2 ── B2: puzzles whose go_live_date is today must be Live today.
  try {
    if (!(await hasBankRows(s, "Published", today))) {
      out.skipped.push("no-published-rows-for-today");
    } else {
      const rotate: (today: string) => Promise<RotateResult> =
        deps.rotateLiveSet ?? (await import("@/lib/puzzle-bank")).rotateLiveSet;
      const r = await rotate(today);
      out.promoted = Number(r?.promoted) || 0;
      if (r?.missingTypes?.length)
        console.error(`${LOG} bank gap for ${today}: ${r.missingTypes.join(", ")}`);
    }
  } catch (e) {
    out.skipped.push(`rotate-failed: ${msg(e)}`);
  }

  // 3 ── B6: the day pages read dc_daily_page_content only, so a same-day
  //      go-live is invisible until that row is rebuilt.
  try {
    let needsSync = out.promoted > 0;
    let why = "rotation-promoted";
    if (!needsSync) {
      if (!(await hasBankRows(s, "Live", today))) {
        out.skipped.push("no-live-rows-for-today");
      } else {
        const count = await dayContentPuzzleCount(s, today);
        if (count === null) {
          needsSync = true;
          why = "day-content-row-missing";
        } else if (count === 0) {
          needsSync = true;
          why = "day-content-row-empty";
        } else {
          out.skipped.push(`day-content-already-current (${count})`);
        }
      }
    }
    if (needsSync) {
      // Annotated, not inferred: the real module returns the wider
      // SyncDayContentResult union and only the two fields below are read here.
      const sync: (date: string) => Promise<SyncResult> =
        deps.syncDayContent ?? (await import("@/lib/day-content-sync")).syncDayContent;
      const r = await sync(today);
      out.synced = r?.ok === true;
      if (!out.synced) out.skipped.push(`sync-failed: ${r?.error ?? "unknown"}`);
      else console.log(`${LOG} day content resynced for ${today} (${why})`);
    }
  } catch (e) {
    out.skipped.push(`sync-failed: ${msg(e)}`);
  }

  console.log(
    `${LOG}`,
    JSON.stringify({ reason: opts.reason, actor: opts.actor ?? null, ...out })
  );
  return out;
}

/** The service-role handle `goLiveToday` needs, built from env — for callers
 *  (the backstop cron) that have no League Office `Svc` of their own. Null when
 *  SUPABASE_SERVICE_ROLE_KEY is unset. */
export function goLiveSvc(): GoLiveSvc | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return {
    base: `${SUPABASE_URL}/rest/v1`,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  };
}
