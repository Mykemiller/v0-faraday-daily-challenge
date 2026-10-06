// THE Daily Challenge day, client-side. Plain JS, pure, no imports.
//
// CC-LO-CONFIG-ENFORCEMENT-STATUS-1.0 FIX B2. The FAR-198 hint budget was
// keyed on `new Date().toISOString().slice(0,10)` — a UTC date, computed ONCE
// at module load. The server stamps completions with a Central date. In CDT
// those disagree for five hours every evening, because UTC midnight is 7pm CT:
//
//   · a session at 7:01pm CT read the NEXT day's budget key — the budget reset
//     and `hintsUsed` reported 0, so the hint penalty was evaded
//   · the next morning read that same key back and charged the player for
//     hints they had taken the previous evening
//
// That was harmless while `hintsUsed` was analytics. It is score math now
// (season_config.hint_penalty_pct), so the client's day and the server's day
// have to be the same day, and a tab left open overnight has to roll over.
//
// Hence: SAME `Intl.DateTimeFormat` formulation as the server's `centralDate`
// (en-CA gives YYYY-MM-DD directly), and a FUNCTION rather than a constant.
// /api/score and /api/challenge/today both delegate to `chicagoDay` too, so
// there is exactly one definition of the boundary and the two cannot drift.
//
// Tests: `npm run test:season-scoring`.

const DC_TZ = "America/Chicago";

/** The Daily Challenge serve day (YYYY-MM-DD) in America/Chicago, DST-aware.
 *  Pass `now` to test; default is the moment of the call, never module load. */
export function chicagoDay(now) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: DC_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now instanceof Date ? now : new Date());
}

/** The FAR-198 per-game daily hint budget key. The SHAPE is unchanged —
 *  `faraday_hints_<day>_<gameType>`, still shared by the in-game HintControl
 *  and the /challenge/hints page — only the day is now Central rather than
 *  UTC. In-flight budgets that straddle the cutover read as reset once, which
 *  is strictly better than charging the wrong day. */
export function hintBudgetKey(gameType, now) {
  return `faraday_hints_${chicagoDay(now)}_${gameType}`;
}

/** The budget, clamped to the 0..3 the penalty is defined over. Shared so the
 *  score card, the POST body and the hints page cannot read it three
 *  different ways. Storage disabled / unparseable ⇒ 0. */
export function readHintBudget(gameType, max = 3, now) {
  try {
    const v = parseInt(localStorage.getItem(hintBudgetKey(gameType, now)) || "0", 10);
    return Number.isNaN(v) ? 0 : Math.max(0, Math.min(max, v));
  } catch {
    return 0;
  }
}
