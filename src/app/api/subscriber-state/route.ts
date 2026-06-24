// Subscriber state hydration endpoint — replaces the missing get-subscriber-state
// edge function. Called on mount to hydrate streak/MW/today's completions.
//   GET /api/subscriber-state?token=<session>
// Returns: { email, playStreak, fullSetStreak, mwBalance, todayCompletions }
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

  // Subscriber row — streak, MW, email, active.
  const subR = await fetch(
    `${s.base}/dc_subscribers?id=eq.${subscriberId}&select=email,handle,play_streak,full_set_streak,mw_balance,active`,
    { headers: s.headers, cache: "no-store" }
  );
  if (!subR.ok)
    return Response.json({ error: "Subscriber lookup failed" }, { status: 500 });
  const subRows = await subR.json().catch(() => null);
  const sub = Array.isArray(subRows) ? subRows[0] : null;
  if (!sub)
    return Response.json({ error: "Subscriber not found" }, { status: 404 });

  // Today's completions from dc_completions.
  const today = centralDate(new Date());
  const compR = await fetch(
    `${s.base}/dc_completions?subscriber_id=eq.${subscriberId}&puzzle_date=eq.${today}&select=puzzle_type,score,created_at`,
    { headers: s.headers, cache: "no-store" }
  );
  const compRows = compR.ok ? await compR.json().catch(() => []) : [];

  const todayCompletions: Record<string, { score: number; completedAt: string }> = {};
  if (Array.isArray(compRows)) {
    for (const row of compRows) {
      todayCompletions[row.puzzle_type] = {
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
    todayCompletions,
  });
}
