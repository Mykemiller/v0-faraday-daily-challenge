// Authoritative score-write path for the Daily Challenge.
//   POST /api/score { token, gameType, score, publicId?, result?, scoringVersion?, hintsUsed? }
//
// Responsibilities:
//   1. Validate session via service role.
//   2. Check dc_daily_attempts — return existing result if already played today.
//   3. Call the complete-puzzle edge function to handle streak/badge logic.
//   4. Insert dc_daily_attempts (attempt lock).
//   5. Upsert leaderboard_daily (increment running daily score total).
//   6. Return full result including runningDailyTotal.
//
// Server-only. Never trusts the client for score math. Requires env:
//   SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL (falls back to project URL).
//
// CC-LO-CONFIG-ENFORCEMENT-STATUS-1.0 (D7) — SEASON SCORING, EVERY WRITE.
//
// The score this route writes is ALWAYS recomputed here, from rules it
// resolves itself:
//
//   final = seasonScore({ rawScore: score, rules, hintsUsed })
//   rules = resolveGameScoringRules(<the subscriber's season>, gameType)
//         = { pointsMax: season_games.points_override ?? 150,
//             hintPenaltyPct: hints_enabled ? season_config.hint_penalty_pct : 0 }
//
// `score` from the body is the RAW 0..150 roll-up the client has always sent.
// The body carries no rules and none would be read if it did.
//
// NO VERSION BRANCH. An earlier revision scaled only when the body carried
// `scoringVersion: 2`, so a browser on a cached bundle kept writing unscaled
// scores. Myke ruled 2026-10-06 that leaderboard consistency wins: a table
// whose rows mean different things depending on which bundle each player had
// cached is worse than a stale client briefly SHOWING a smaller number than
// was stored. The stale client's display self-heals on reload; a mixed
// leaderboard does not.
//
// `scoringVersion` is still accepted and still echoed back, because it tells
// us the caller is hint-aware. It decides nothing. `hintsUsed` stays opt-in
// data: absent ⇒ 0 ⇒ no penalty. A client that did not report hints is not
// charged for hints it might have taken.
//
// SAFETY: no client, stale or crafted, can write more than the configured
// ceiling. `clamp(raw,0,150) × pointsMax/150` is at most `pointsMax` because
// the clamp caps the raw at 150 first — a streak multiplier already folded
// into `score` by calcScore, or an invented 10^9, both clamp to 150 — and the
// hint factor is in [0,1], so the product is in [0, pointsMax].
//
// NOTHING IS RESCORED. This route only ever writes the completion in front of
// it. Scores stored before this deploy keep the number they were written
// with; there is no backfill here and there must not be one.

import { resolveSeasonFor } from "@/lib/seasons/resolve";
// CC-LO-CONFIG-ENFORCEMENT-STATUS-1.0 (D7) — season scoring. `seasonScore` is
// the SAME pure module the client renders with, so the number on the score
// card and the number in the database agree by construction. The RULES it is
// fed are resolved here, by this route, from the subscriber's own season —
// the request body carries no rules and none would be read if it did.
import { seasonScore } from "@/lib/scoring/season-scoring.js";
import { resolveGameScoringRules } from "@/lib/scoring/season-rules-server";
import { chicagoDay } from "@/lib/dc-day.js";

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://ycadmmngkdhvpcsrcuaq.supabase.co";
const EDGE_FN_BASE = `${SUPABASE_URL}/functions/v1`;

// FIX B2 — ONE definition of the Central serve day, shared with the client.
// The hint budget the penalty is computed from is keyed on this same day in
// the browser (src/lib/dc-day.js), so the two cannot drift: a session at
// 7:01pm CT used to read the NEXT UTC day's budget and evade the penalty.
function centralDate(d: Date): string {
  return chicagoDay(d);
}

type Svc = { base: string; headers: Record<string, string> };

function svc(): Svc | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return {
    base: `${SUPABASE_URL}/rest/v1`,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
  };
}

async function resolveSubscriber(s: Svc, token: string): Promise<string | null> {
  const r = await fetch(
    `${s.base}/dc_sessions?token=eq.${encodeURIComponent(token)}&select=subscriber_id,expires_at`,
    { headers: s.headers, cache: "no-store" }
  );
  if (!r.ok) return null;
  const rows = await r.json().catch(() => null);
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return null;
  if (row.expires_at && new Date(row.expires_at) < new Date()) return null;
  return row.subscriber_id ?? null;
}

export async function POST(request: Request) {
  const s = svc();
  if (!s)
    return Response.json({ error: "Score service not configured" }, { status: 500 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token.trim() : "";
  const gameType = typeof body.gameType === "string" ? body.gameType.trim() : "";
  const score =
    typeof body.score === "number" && body.score >= 0 ? Math.round(body.score) : null;

  if (!token) return Response.json({ error: "Missing session" }, { status: 401 });
  if (!gameType) return Response.json({ error: "Missing gameType" }, { status: 400 });
  if (score === null)
    return Response.json({ error: "Invalid score" }, { status: 400 });

  const result = body.result === "lose" ? "lose" : "win";
  const publicId =
    typeof body.publicId === "string" && body.publicId.trim() ? body.publicId.trim() : null;
  // Hint tier (0..3, FAR-198/FAR-287), forwarded verbatim to complete-puzzle,
  // which normalizes and writes dc_completions.hints_used.
  //
  // NO LONGER ANALYTICS-ONLY. As of CC-LO-CONFIG-ENFORCEMENT-STATUS-1.0 this
  // is the hint penalty's input — the one thing about scoring this route takes
  // from the caller. Clamped 0..3 inside seasonScore. Opt-in by design: absent
  // means 0 means no penalty, because a client that did not report hints must
  // not be charged for hints it might have taken.
  // Under scoringVersion 2 it is ALSO the hint penalty's input — still the only
  // thing about scoring this route takes from the caller, and still clamped to
  // 0..3 by seasonScore. There is no server-side record of hints spent to check
  // it against (the budget lives in the player's localStorage), so a client that
  // under-reports pays no penalty; that is unchanged from today, where the field
  // is written to dc_completions.hints_used verbatim.
  const hintsUsed = typeof body.hintsUsed === "number" ? body.hintsUsed : null;
  // Vestigial for the scaling decision (every write is scaled). Kept because
  // it still distinguishes a hint-aware client from a cached one, and echoed
  // back so a caller can tell which contract the server understood.
  const clientScoringVersion = body.scoringVersion === 2 ? 2 : null;
  // FAR-388: elapsed solve time in seconds (client-timed). Forwarded verbatim to
  // complete-puzzle, which normalizes (clamps/caps) and writes
  // dc_completions.solve_seconds. Analytics/presentation only — never score math.
  const solveSeconds = typeof body.solveSeconds === "number" ? body.solveSeconds : null;

  const subscriberId = await resolveSubscriber(s, token);
  if (!subscriberId)
    return Response.json({ error: "Invalid or expired session" }, { status: 401 });

  const playDate = centralDate(new Date());

  // ONE season resolution per request, memoized. The legacy path still calls
  // it at exactly the point it always did (the locked_at check below) and
  // still calls it once; scoringVersion 2 pulls it forward and reuses the same
  // answer, so the two paths can never disagree about whose season this is.
  let seasonResolved = false;
  let seasonCache: Awaited<ReturnType<typeof resolveSeasonFor>> = null;
  const scorerSeason = async () => {
    if (!seasonResolved) {
      seasonCache = await resolveSeasonFor(s.headers, subscriberId);
      seasonResolved = true;
    }
    return seasonCache;
  };

  // Check for existing attempt — idempotent: second attempt returns the prior result.
  const existingR = await fetch(
    `${s.base}/dc_daily_attempts?subscriber_id=eq.${subscriberId}&game_type=eq.${encodeURIComponent(gameType)}&play_date=eq.${playDate}&select=result,score`,
    { headers: s.headers, cache: "no-store" }
  );
  if (existingR.ok) {
    const rows = await existingR.json().catch(() => []);
    if (Array.isArray(rows) && rows[0]) {
      // Return the daily total so the win screen can still show it.
      const dailyTotal = await getDailyTotal(s, subscriberId, playDate);
      return Response.json({
        ok: true,
        alreadyPlayed: true,
        existingResult: rows[0],
        runningDailyTotal: dailyTotal,
        playStreak: null,
      });
    }
  }

  // The score that will be WRITTEN — resolved after the idempotency check, so
  // a replay costs no extra reads. The client's number is demoted to the raw
  // input it always was (an accuracy/speed/streak roll-up capped at 150); the
  // season's ceiling and hint penalty are applied on top of it by the same
  // pure function the score card renders with. Unconditional: see the version
  // note in the header.
  const scorerRules = await resolveGameScoringRules(
    (await scorerSeason())?.id ?? null,
    gameType,
    s.headers
  );
  const finalScore = seasonScore({ rawScore: score, rules: scorerRules, hintsUsed: hintsUsed ?? 0 });

  // Delegate streak/badge logic to the existing complete-puzzle edge function.
  let completionResult: Record<string, unknown> = {};
  try {
    const cpRes = await fetch(`${EDGE_FN_BASE}/complete-puzzle`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
      },
      body: JSON.stringify({
        sessionToken: token,
        puzzleType: gameType,
        // dc_completions.score. Under v2 this is the season's score, which is
        // why the ceiling shows up in history and in every leaderboard read
        // derived from it — and why a completion written BEFORE this deploy
        // keeps the number it was written with. Nothing backfills.
        score: finalScore,
        ...(publicId ? { publicId } : {}),
        ...(hintsUsed !== null ? { hintsUsed } : {}),
        ...(solveSeconds !== null ? { solveSeconds } : {}),
      }),
    });
    if (cpRes.ok) {
      completionResult = (await cpRes.json()) ?? {};
    }
  } catch {
    // Non-fatal: continue to lock the attempt and update leaderboard.
  }

  // Check season locked_at — reject score writes after the season locks. THE
  // SCORER's season (CC-LO-CONCURRENT-SEASONS-1.0), not "the" active one.
  const activeSeason = await scorerSeason();
  if (activeSeason?.locked_at && new Date() > new Date(activeSeason.locked_at)) {
    return Response.json({ error: "Season is locked — no more scores accepted" }, { status: 403 });
  }

  // Lock the attempt.
  await fetch(`${s.base}/dc_daily_attempts`, {
    method: "POST",
    headers: { ...s.headers, Prefer: "return=minimal,resolution=ignore-duplicates" },
    body: JSON.stringify({
      subscriber_id: subscriberId,
      game_type: gameType,
      play_date: playDate,
      result,
      score: finalScore,
    }),
  }).catch(() => {});

  // Write score_event (source of truth for season/team leaderboards). Part C:
  // season attribution is DERIVED at read time from played_at + memberships —
  // the row carries no season id (legacy_season_id stays NULL on new rows), and
  // the write is unconditional (C2): a play outside any season window simply
  // counts toward no season.
  await fetch(`${s.base}/score_events`, {
    method: "POST",
    headers: { ...s.headers, Prefer: "return=minimal" },
    body: JSON.stringify({
      subscriber_id: subscriberId,
      game_id: gameType,
      points: finalScore,
      played_at: new Date().toISOString(),
    }),
  }).catch(() => {});

  // Upsert leaderboard_daily: increment running daily score + games_played.
  // Read-then-write is safe here because dc_daily_attempts already prevents
  // double-completion for the same (subscriber, gameType, date).
  await upsertLeaderboardDaily(s, subscriberId, playDate, finalScore, completionResult.playStreak as number ?? 0);

  const runningDailyTotal = await getDailyTotal(s, subscriberId, playDate);

  // FAR-393: Intelligence Readiness rewards. When the play streak crosses a
  // wallet-granting milestone (5 or 10 days), grant Faraday tokens SERVER-SIDE.
  // The RPC re-verifies the streak against dc_subscribers (it never trusts this
  // value), enforces the no-backfill epoch + abuse caps, and is idempotent per
  // window — so a duplicate/late call cannot double-grant. The 3-day tier is
  // cosmetic (client-only) and is intentionally not granted here.
  const playStreakNum =
    typeof completionResult.playStreak === "number" ? completionResult.playStreak : null;
  let readinessReward: Record<string, unknown> | null = null;
  if (playStreakNum === 5 || playStreakNum === 10) {
    readinessReward = await grantReadinessReward(s, subscriberId, playStreakNum);
  }

  return Response.json({
    ok: true,
    alreadyPlayed: false,
    // What was actually written. A client that computed a different number
    // should trust this one; the lobby reconciles its optimistic record to it.
    finalScore,
    // What the SERVER applied, and what the CALLER claimed. Always 2 and
    // always scaled, whatever the caller said.
    scoringVersion: 2,
    clientScoringVersion,
    runningDailyTotal,
    playStreak: completionResult.playStreak ?? null,
    fullSetJustCompleted: completionResult.fullSetJustCompleted ?? false,
    // Non-null only when a milestone token grant actually fired this completion.
    readinessReward: readinessReward?.ok ? readinessReward : null,
  });
}

// FAR-393: the ONLY client-reachable trigger of a streak-reward grant, and it is
// still fully server-verified — this route holds the service role, and the RPC
// re-checks the streak in the DB before crediting the single Faraday wallet
// (live_agent_token_ledger.bonus_balance). Never grants from a client-reported streak.
async function grantReadinessReward(
  s: Svc,
  subscriberId: string,
  threshold: number
): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetch(`${s.base}/rpc/dc_grant_readiness_reward`, {
      method: "POST",
      headers: s.headers,
      body: JSON.stringify({ p_subscriber: subscriberId, p_threshold: threshold }),
    });
    if (!r.ok) return null;
    const out = await r.json().catch(() => null);
    return out && typeof out === "object" ? (out as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function upsertLeaderboardDaily(
  s: Svc,
  subscriberId: string,
  playDate: string,
  addScore: number,
  streak: number
): Promise<void> {
  // Read-then-write. Safe because dc_daily_attempts prevents double-completion.
  const r = await fetch(
    `${s.base}/leaderboard_daily?subscriber_id=eq.${subscriberId}&play_date=eq.${playDate}&select=score,games_played`,
    { headers: s.headers, cache: "no-store" }
  );
  const rows = r.ok ? await r.json().catch(() => null) : null;
  const row = Array.isArray(rows) ? rows[0] : null;

  if (!row) {
    // Insert new row.
    await fetch(`${s.base}/leaderboard_daily`, {
      method: "POST",
      headers: { ...s.headers, Prefer: "return=minimal" },
      body: JSON.stringify({
        subscriber_id: subscriberId,
        play_date: playDate,
        score: addScore,
        games_played: 1,
        streak,
        updated_at: new Date().toISOString(),
      }),
    }).catch(() => {});
  } else {
    // Increment existing row.
    await fetch(
      `${s.base}/leaderboard_daily?subscriber_id=eq.${subscriberId}&play_date=eq.${playDate}`,
      {
        method: "PATCH",
        headers: s.headers,
        body: JSON.stringify({
          score: row.score + addScore,
          games_played: row.games_played + 1,
          streak,
          updated_at: new Date().toISOString(),
        }),
      }
    ).catch(() => {});
  }
}

async function getDailyTotal(
  s: Svc,
  subscriberId: string,
  playDate: string
): Promise<number> {
  const r = await fetch(
    `${s.base}/leaderboard_daily?subscriber_id=eq.${subscriberId}&play_date=eq.${playDate}&select=score`,
    { headers: s.headers, cache: "no-store" }
  );
  if (!r.ok) return 0;
  const rows = await r.json().catch(() => null);
  const row = Array.isArray(rows) ? rows[0] : null;
  return typeof row?.score === "number" ? row.score : 0;
}
