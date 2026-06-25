// TODO: REMOVE BEFORE PRODUCTION — temporary admin testing utility

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://ycadmmngkdhvpcsrcuaq.supabase.co";

function svcHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Prefer: "return=minimal",
  };
}

export async function POST() {
  const headers = svcHeaders();
  if (!headers) {
    return Response.json({ error: "Admin service not configured" }, { status: 500 });
  }

  const base = `${SUPABASE_URL}/rest/v1`;

  // Zero leaderboard_daily.score (today scores)
  const dailyRes = await fetch(`${base}/leaderboard_daily`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ score: 0, games_played: 0 }),
  });

  // Zero dc_period_aggregates.signals (season scores)
  const seasonRes = await fetch(`${base}/dc_period_aggregates`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ signals: 0 }),
  });

  if (!dailyRes.ok || !seasonRes.ok) {
    return Response.json(
      { error: "Reset failed", daily: dailyRes.status, season: seasonRes.status },
      { status: 500 }
    );
  }

  return Response.json({ ok: true });
}
