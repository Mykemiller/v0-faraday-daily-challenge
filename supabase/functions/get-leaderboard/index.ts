import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Leaderboard V2 §8 — period-scoped Global board.
// GET ?scope=global&period=daily|season&token=<session?>&limit=50
// Ranks from dc_completions aggregates (never lifetime mw_balance): daily via the
// additive cache with live fallback (§5.5); season via the drop-2 oracle (§5.4).
// Currency is "signals" at the API boundary; DB columns stay mw_* (1 signal == 1 mw).
// Emails are never emitted — real handle, else a masked handle.

const DC_TZ = "America/Chicago";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
function centralDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: DC_TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}
function maskHandle(email: string): string {
  const local = (email || "").split("@")[0] || "player";
  if (local.length <= 2) return local[0] + "•••";
  return local.slice(0, 2) + "•••" + local.slice(-1);
}
// §3: percentile = 1 - (rank-1)/total_players, as an integer 0..100 (higher = better).
// Guards N = 0/1/2 so there's no NaN/Inf. null when the player has no rank in the period.
function percentileOf(rank: number | null, total: number | null): number | null {
  if (rank == null || !total || total < 1) return null;
  if (total === 1) return 100;
  return Math.round((1 - (rank - 1) / total) * 100);
}

type RankRow = { rank: number | null; subscriber_id: string; signals: number; play_streak: number; full_set_streak: number };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  try {
    const url = new URL(req.url);
    const scope = (url.searchParams.get("scope") || "global").toLowerCase();
    const period = (url.searchParams.get("period") || "daily").toLowerCase() === "season" ? "season" : "daily";
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 100);
    const sessionToken = url.searchParams.get("token");

    // Team scope is served by get-team-leaderboard (Phase 3). Keep the contract
    // explicit rather than silently returning the global board.
    if (scope === "team") {
      return json({ error: "Use get-team-leaderboard for team scope" }, 400);
    }

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Resolve the caller (optional — reads are not gated).
    let myId: string | null = null;
    let myEmail: string | null = null;
    if (sessionToken) {
      const { data: session } = await sb
        .from("dc_sessions").select("subscriber_id, expires_at")
        .eq("token", sessionToken).maybeSingle();
      if (session && new Date(session.expires_at) >= new Date()) {
        myId = session.subscriber_id;
        const { data: sub } = await sb.from("dc_subscribers").select("email").eq("id", myId).maybeSingle();
        myEmail = (sub?.email as string) ?? null;
      }
    }

    const today = centralDate(new Date());

    // Resolve the active season for the season period.
    let season: { id: string; name: string; starts_on: string; ends_on: string } | null = null;
    if (period === "season") {
      const { data: s } = await sb
        .from("seasons").select("id, name, starts_on, ends_on")
        .eq("status", "active").lte("starts_on", today).gte("ends_on", today)
        .order("starts_on", { ascending: false }).limit(1).maybeSingle();
      season = s ?? null;
    }

    // ---- Board rows (period-scoped), read-through cache w/ live fallback. ----
    let board: RankRow[] = [];
    let totalPlayers = 0;
    if (period === "daily") {
      const { count: cacheCount } = await sb
        .from("dc_period_aggregates").select("*", { count: "exact", head: true })
        .eq("period", "daily").eq("period_key", today);
      if (cacheCount && cacheCount > 0) {
        const { data } = await sb.rpc("fn_leaderboard_daily_cached", { p_day: today, p_limit: limit });
        board = (data ?? []) as RankRow[];
      } else {
        const { data } = await sb.rpc("fn_leaderboard_daily", { p_day: today, p_limit: limit });
        board = (data ?? []) as RankRow[];
        if (board.length > 0) await sb.rpc("fn_backfill_daily_cache", { p_day: today }); // backfill on miss
      }
      // Distinct-player count via the player-rank fn (nil uuid = no match, real total).
      const { data: tp } = await sb.rpc("fn_player_rank_daily", {
        p_day: today, p_subscriber: "00000000-0000-0000-0000-000000000000",
      });
      totalPlayers = tp?.[0]?.total_players ?? 0;
    } else if (season) {
      const { data } = await sb.rpc("fn_leaderboard_season", { p_season: season.id, p_limit: limit });
      board = (data ?? []) as RankRow[];
      const { data: tp } = await sb.rpc("fn_player_rank_season", {
        p_season: season.id, p_subscriber: "00000000-0000-0000-0000-000000000000",
      });
      totalPlayers = tp?.[0]?.total_players ?? 0;
    }

    // ---- Handles for the board's subscribers (never emit raw email). ----
    const ids = board.map((r) => r.subscriber_id);
    const handleById = new Map<string, string>();
    if (ids.length > 0) {
      const { data: subs } = await sb
        .from("dc_subscribers").select("id, handle, email").in("id", ids);
      for (const s of subs ?? []) {
        handleById.set(s.id as string, (s.handle as string) || maskHandle(s.email as string));
      }
    }

    // ---- Movement vs. the most recent prior snapshot (§5.3). '—' when none. ----
    const movementById = new Map<string, number>();
    {
      const { data: priorDayRow } = await sb
        .from("dc_rank_snapshots").select("snapshot_day")
        .eq("scope", "global").eq("period", period).lt("snapshot_day", today)
        .order("snapshot_day", { ascending: false }).limit(1).maybeSingle();
      const priorDay = priorDayRow?.snapshot_day as string | undefined;
      if (priorDay) {
        const { data: snaps } = await sb
          .from("dc_rank_snapshots").select("subscriber_id, rank")
          .eq("scope", "global").eq("period", period).eq("snapshot_day", priorDay);
        for (const s of snaps ?? []) movementById.set(s.subscriber_id as string, s.rank as number);
      }
    }
    const movementFor = (subId: string, currentRank: number | null): number | null => {
      const prior = movementById.get(subId);
      if (prior == null || currentRank == null) return null;
      return prior - currentRank; // positive = moved up
    };

    const leaderboard = board.map((r) => ({
      rank: r.rank,
      handle: handleById.get(r.subscriber_id) ?? "player",
      signals: Number(r.signals) || 0,
      playStreak: r.play_streak ?? 0,
      fullSetStreak: r.full_set_streak ?? 0,
      movement: movementFor(r.subscriber_id, r.rank),
      isYou: myId != null && r.subscriber_id === myId,
    }));

    // ---- "You" row — present even outside the top N (§3). ----
    let you: null | {
      rank: number | null; percentile: number | null; signals: number;
      playStreak: number; fullSetStreak: number; movement: number | null; handle: string;
    } = null;
    if (myId) {
      let pr: { rank: number | null; signals: number; total_players: number } | null = null;
      if (period === "daily") {
        const { data } = await sb.rpc("fn_player_rank_daily", { p_day: today, p_subscriber: myId });
        pr = data?.[0] ?? null;
      } else if (season) {
        const { data } = await sb.rpc("fn_player_rank_season", { p_season: season.id, p_subscriber: myId });
        pr = data?.[0] ?? null;
      }
      const { data: meRow } = await sb
        .from("dc_subscribers").select("handle, email, play_streak, full_set_streak")
        .eq("id", myId).maybeSingle();
      if (meRow) {
        const rank = pr?.rank ?? null;
        you = {
          rank,
          percentile: percentileOf(rank, pr?.total_players ?? totalPlayers),
          signals: Number(pr?.signals ?? 0),
          playStreak: (meRow.play_streak as number) ?? 0,
          fullSetStreak: (meRow.full_set_streak as number) ?? 0,
          movement: movementFor(myId, rank),
          handle: (meRow.handle as string) || maskHandle(meRow.email as string),
        };
        if (pr?.total_players) totalPlayers = pr.total_players;
      }
    }

    // The caller's groups, for the scope selector (My Team(s) / My Company).
    let myGroups: Array<Record<string, unknown>> = [];
    if (myEmail) {
      const { data: groups } = await sb.rpc("team_get_my_teams", { p_email: myEmail });
      myGroups = (groups ?? []).map((g: Record<string, unknown>) => ({
        code: g.code, name: g.name, groupType: g.group_type,
        parentCode: g.parent_code, memberCount: g.members,
      }));
    }

    return json({
      scope: "global",
      period,
      seasonName: season?.name,
      dayLabel: period === "daily" ? "Today" : undefined,
      you,
      leaderboard,
      totalPlayers,
      count: leaderboard.length,
      myGroups,
    });
  } catch (e) {
    console.error("Unhandled error:", e);
    return json({ error: "Server error" }, 500);
  }
});
