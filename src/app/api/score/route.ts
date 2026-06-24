// Authoritative score-write path for the Daily Challenge (go-live closeout).
//   POST /api/score { token, gameType, score, mwEarned, publicId?, result? }
//
// Responsibilities:
//   1. Validate session via service role.
//   2. Check dc_daily_attempts — return existing result if already played today.
//   3. Call the complete-puzzle edge function to handle streak/MW/badge logic.
//   4. Insert dc_daily_attempts (attempt lock).
//   5. Upsert leaderboard_daily (increment running daily score total).
//   6. Return full result including runningDailyTotal.
//
// Server-only. Never trusts the client for score math. Requires env:
//   SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL (falls back to project URL).

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://ycadmmngkdhvpcsrcuaq.supabase.co";
const EDGE_FN_BASE = `${SUPABASE_URL}/functions/v1`;

const DC_TZ = "America/Chicago";

function centralDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: DC_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
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
  const mwEarned =
    typeof body.mwEarned === "number" && body.mwEarned >= 0
      ? Math.round(body.mwEarned)
      : null;

  if (!token) return Response.json({ error: "Missing session" }, { status: 401 });
  if (!gameType) return Response.json({ error: "Missing gameType" }, { status: 400 });
  if (score === null)
    return Response.json({ error: "Invalid score" }, { status: 400 });
  if (mwEarned === null)
    return Response.json({ error: "Invalid mwEarned" }, { status: 400 });

  const result = body.result === "lose" ? "lose" : "win";
  const publicId =
    typeof body.publicId === "string" && body.publicId.trim() ? body.publicId.trim() : null;

  const subscriberId = await resolveSubscriber(s, token);
  if (!subscriberId)
    return Response.json({ error: "Invalid or expired session" }, { status: 401 });

  const playDate = centralDate(new Date());

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
        mwBalance: null,
      });
    }
  }

  // Delegate streak/MW/badge logic to the existing complete-puzzle edge function.
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
        score,
        mwEarned,
        ...(publicId ? { publicId } : {}),
      }),
    });
    if (cpRes.ok) {
      completionResult = (await cpRes.json()) ?? {};
    }
  } catch {
    // Non-fatal: continue to lock the attempt and update leaderboard.
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
      score,
    }),
  }).catch(() => {});

  // Upsert leaderboard_daily: increment running daily score + games_played.
  // Read-then-write is safe here because dc_daily_attempts already prevents
  // double-completion for the same (subscriber, gameType, date).
  await upsertLeaderboardDaily(s, subscriberId, playDate, score, completionResult.playStreak as number ?? 0);

  const runningDailyTotal = await getDailyTotal(s, subscriberId, playDate);

  return Response.json({
    ok: true,
    alreadyPlayed: false,
    runningDailyTotal,
    playStreak: completionResult.playStreak ?? null,
    mwBalance: completionResult.mwBalance ?? null,
    fullSetJustCompleted: completionResult.fullSetJustCompleted ?? false,
  });
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
