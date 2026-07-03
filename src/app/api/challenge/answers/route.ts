// GET /api/challenge/answers — gated answers + live stats (FAR-287).
//   ?token=<dc_session>        subscriber session (optional for past days)
//   &date=YYYY-MM-DD           optional; defaults to today (CT); future → 400
//
// THE answer gate. A puzzle's answer/explanation is released only when:
//   • the requested day is over (date < today in America/Chicago), OR
//   • the authenticated subscriber has completed THAT puzzle on that date
//     (dc_completions row exists — dc_daily_attempts also locks it).
// Partial unlock is normal: 3 of 7 done → 3 answers, 4 locked cards.
// Anonymous visitors on the current day get locked cards only (local-only
// completions can't be verified server-side, and a client-asserted "I finished"
// would be spoofable).
//
// Live stats (completion rate, avg hints used) are computed FRESH from
// dc_daily_attempts / dc_completions on every request — never read from any
// cached/generated field (FAR-287 guardrail).

export const dynamic = "force-dynamic";

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://ycadmmngkdhvpcsrcuaq.supabase.co";

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

function centralDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
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

async function rows(s: Svc, pathAndQuery: string): Promise<unknown[]> {
  const r = await fetch(`${s.base}/${pathAndQuery}`, { headers: s.headers, cache: "no-store" });
  if (!r.ok) return [];
  const data = await r.json().catch(() => null);
  return Array.isArray(data) ? data : [];
}

export async function GET(request: Request) {
  const s = svc();
  if (!s) return Response.json({ error: "Answers service not configured" }, { status: 500 });

  const params = new URL(request.url).searchParams;
  const today = centralDate(new Date());
  const dateParam = params.get("date");
  const date =
    dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : today;
  if (date > today) {
    return Response.json({ error: "That day hasn't been played yet" }, { status: 400 });
  }
  const rolledOver = date < today;

  // Who's asking (optional — required only to unlock current-day answers).
  const token = (params.get("token") || "").trim();
  const subscriberId = token ? await resolveSubscriber(s, token) : null;
  if (token && !subscriberId && !rolledOver) {
    return Response.json({ error: "Invalid or expired session" }, { status: 401 });
  }

  // The synced day content — answers/explanations live here.
  const contentRows = await rows(
    s,
    `dc_daily_page_content?puzzle_date=eq.${date}&select=puzzle_date,domain_code,about_content,puzzles`
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const content = contentRows[0] as any;
  if (!content) {
    return Response.json({ available: false, puzzle_date: date, rolled_over: rolledOver });
  }

  // Live stats inputs (whole player base, that date) + this subscriber's state.
  const [allCompletions, allAttempts, mine, myAttempts, me] = await Promise.all([
    rows(s, `dc_completions?puzzle_date=eq.${date}&select=puzzle_type,hints_used`),
    rows(s, `dc_daily_attempts?play_date=eq.${date}&select=game_type`),
    subscriberId
      ? rows(s, `dc_completions?subscriber_id=eq.${subscriberId}&puzzle_date=eq.${date}&select=puzzle_type,score`)
      : Promise.resolve([]),
    subscriberId
      ? rows(s, `dc_daily_attempts?subscriber_id=eq.${subscriberId}&play_date=eq.${date}&select=game_type,result,score`)
      : Promise.resolve([]),
    subscriberId
      ? rows(s, `dc_subscribers?id=eq.${subscriberId}&select=play_streak`)
      : Promise.resolve([]),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const completedTypes = new Set((mine as any[]).map((c) => c.puzzle_type));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const myAttemptByType = new Map((myAttempts as any[]).map((a) => [a.game_type, a]));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const puzzles = (Array.isArray(content.puzzles) ? content.puzzles : []).map((p: any) => {
    const type = p.puzzle_type as string;
    const unlocked = rolledOver || completedTypes.has(type);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doneHere = (allCompletions as any[]).filter((c) => c.puzzle_type === type);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const attemptsHere = (allAttempts as any[]).filter((a) => a.game_type === type);
    const avgHints = doneHere.length
      ? doneHere.reduce((sum, c) => sum + (typeof c.hints_used === "number" ? c.hints_used : 0), 0) /
        doneHere.length
      : null;

    const myAttempt = myAttemptByType.get(type);
    // "Missed" = attempted but lost — the case that earns an Academy nudge.
    const missed = myAttempt ? myAttempt.result === "lose" : false;

    return {
      puzzle_type: type,
      public_id: p.public_id ?? null,
      puzzle_name: p.puzzle_name ?? null,
      topic: p.topic ?? null,
      domain_code: p.domain_code ?? null,
      unlocked,
      ...(unlocked
        ? { answer: p.answer ?? null, answer_explanation: p.answer_explanation ?? null }
        : {}),
      // Fresh every request — never persisted (FAR-287 guardrail).
      stats: {
        completions: doneHere.length,
        attempts: attemptsHere.length,
        completion_rate: attemptsHere.length
          ? Math.round((doneHere.length / attemptsHere.length) * 100)
          : null,
        avg_hints_used: avgHints === null ? null : Math.round(avgHints * 10) / 10,
      },
      missed,
      // Academy nudge for anything missed (FAR-21 reversal); also carried on
      // unlocked cards so the page can offer "go deeper" links.
      academy: p.academy ?? null,
    };
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const playStreak = (me as any[])[0]?.play_streak;

  return Response.json({
    available: true,
    puzzle_date: date,
    rolled_over: rolledOver,
    signed_in: !!subscriberId,
    domain_code: content.domain_code ?? null,
    puzzles,
    completed_count: rolledOver ? puzzles.length : completedTypes.size,
    play_streak: typeof playStreak === "number" ? playStreak : null,
  });
}
