// Subscriber state hydration endpoint — replaces the missing get-subscriber-state
// edge function. Called on mount to hydrate streak/MW/today's completions.
//   GET /api/subscriber-state?token=<session>
// Returns: { email, handle, playStreak, fullSetStreak, mwBalance, active,
//            tier, joined_at, todayCompletions }
// Server-only. Requires env: SUPABASE_SERVICE_ROLE_KEY.

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://ycadmmngkdhvpcsrcuaq.supabase.co";

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
    },
  };
}

export async function GET(request: Request) {
  const s = svc();
  if (!s)
    return Response.json({ error: "Service not configured" }, { status: 500 });

  const token = new URL(request.url).searchParams.get("token");
  if (!token)
    return Response.json({ error: "Missing session" }, { status: 401 });

  // Resolve session → subscriber_id.
  const sessR = await fetch(
    `${s.base}/dc_sessions?token=eq.${encodeURIComponent(token)}&select=subscriber_id,expires_at`,
    { headers: s.headers, cache: "no-store" }
  );
  if (!sessR.ok)
    return Response.json({ error: "Session lookup failed" }, { status: 500 });
  const sessRows = await sessR.json().catch(() => null);
  const sess = Array.isArray(sessRows) ? sessRows[0] : null;
  if (!sess)
    return Response.json({ error: "Invalid session" }, { status: 401 });
  if (new Date(sess.expires_at) < new Date())
    return Response.json({ error: "Session expired" }, { status: 401 });

  const subscriberId: string = sess.subscriber_id;

  // Subscriber row — streak, MW, email, active, joined_at.
  const subR = await fetch(
    `${s.base}/dc_subscribers?id=eq.${subscriberId}&select=email,handle,play_streak,full_set_streak,mw_balance,active,created_at`,
    { headers: s.headers, cache: "no-store" }
  );
  if (!subR.ok)
    return Response.json({ error: "Subscriber lookup failed" }, { status: 500 });
  const subRows = await subR.json().catch(() => null);
  const sub = Array.isArray(subRows) ? subRows[0] : null;
  if (!sub)
    return Response.json({ error: "Subscriber not found" }, { status: 404 });

  // Tier — look up in the subscribers table by email; fall back to "free"
  // because dc_subscribers does not carry a tier column (FAR-212).
  let tier = "free";
  if (sub.email) {
    const tierR = await fetch(
      `${s.base}/subscribers?email=eq.${encodeURIComponent(sub.email)}&select=tier`,
      { headers: s.headers, cache: "no-store" }
    );
    if (tierR.ok) {
      const tierRows = await tierR.json().catch(() => null);
      const tierRow = Array.isArray(tierRows) ? tierRows[0] : null;
      if (tierRow?.tier) tier = tierRow.tier;
    }
  }

  // Today's completions from dc_daily_attempts — the authoritative attempt-lock
  // table (FAR-209). Switching from dc_completions so GameTile dimming reflects
  // the same gate that /api/score enforces server-side.
  const today = centralDate(new Date());
  const attR = await fetch(
    `${s.base}/dc_daily_attempts?subscriber_id=eq.${subscriberId}&play_date=eq.${today}&select=game_type,score,created_at`,
    { headers: s.headers, cache: "no-store" }
  );
  const attRows = attR.ok ? await attR.json().catch(() => []) : [];

  const todayCompletions: Record<string, { score: number; completedAt: string }> = {};
  if (Array.isArray(attRows)) {
    for (const row of attRows) {
      todayCompletions[row.game_type] = {
        score: row.score ?? 0,
        completedAt: row.created_at ?? today,
      };
    }
  }

  return Response.json({
    email: sub.email,
    handle: sub.handle ?? null,
    playStreak: sub.play_streak ?? 0,
    fullSetStreak: sub.full_set_streak ?? 0,
    mwBalance: sub.mw_balance ?? 0,
    active: sub.active !== false,
    tier,
    joined_at: sub.created_at ?? null,
    todayCompletions,
  });
}
