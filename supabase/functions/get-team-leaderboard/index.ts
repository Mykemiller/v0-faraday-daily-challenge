import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// get-team-leaderboard — two shapes (Leaderboard V2 §7.4):
//  • NEW (teamCode given): group-scoped board — the group's members ranked by
//    PERIOD Signals, plus the group bar (member count, team-vs-team within the
//    company, company-vs-company). period=daily|season.
//  • LEGACY (no teamCode): the original season team standings (ranked by lifetime
//    mw_total) used by the DC lobby — preserved for backward compatibility.
// Currency is "signals" at the boundary; emails are never emitted.

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
    const teamCode = url.searchParams.get("teamCode");
    const token = url.searchParams.get("token");

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Resolve the caller (optional).
    let myId: string | null = null;
    let myEmail: string | null = null;
    if (token) {
      const { data: session } = await sb
        .from("dc_sessions").select("subscriber_id, expires_at")
        .eq("token", token).maybeSingle();
      if (session && new Date(session.expires_at) >= new Date()) {
        myId = session.subscriber_id;
        const { data: sub } = await sb.from("dc_subscribers").select("email").eq("id", myId).maybeSingle();
        myEmail = (sub?.email as string) ?? null;
      }
    }

    // ---------- LEGACY shape (no teamCode): season team standings ----------
    if (!teamCode) {
      const season = url.searchParams.get("season");
      const limitRaw = Number(url.searchParams.get("limit") ?? "20");
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 20;
      const { data: board, error } = await sb.rpc("team_leaderboard", { p_season: season || null, p_limit: limit });
      if (error) { console.error(error); return json({ error: "Leaderboard query failed" }, 500); }
      let myTeam: Record<string, unknown> | null = null;
      if (myEmail) {
        const { data: mt } = await sb.rpc("team_get_my_teams", { p_email: myEmail });
        myTeam = (Array.isArray(mt) && mt[0]) || null;
        if (myTeam) {
          const row = (board ?? []).find((r: { team_id: string }) => r.team_id === (myTeam as { team_id: string }).team_id);
          (myTeam as { rank?: number | null }).rank = row ? (row as { rank: number }).rank : null;
        }
      }
      return json({ season: season || null, leaderboard: board ?? [], myTeam });
    }

    // ---------- NEW shape (teamCode): hierarchy-aware group board ----------
    const period = (url.searchParams.get("period") || "daily").toLowerCase() === "season" ? "season" : "daily";
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 100);

    const { data: group } = await sb
      .from("teams").select("id, code, name, group_type, parent_id")
      .eq("code", teamCode).maybeSingle();
    if (!group) return json({ error: "Group not found" }, 404);

    const today = centralDate(new Date());
    let season: { id: string; name: string } | null = null;
    if (period === "season") {
      const { data: s } = await sb
        .from("seasons").select("id, name").eq("status", "active")
        .lte("starts_on", today).gte("ends_on", today)
        .order("starts_on", { ascending: false }).limit(1).maybeSingle();
      season = s ?? null;
    }
    const seasonId = season?.id ?? null;

    // Member board + member count.
    const { data: boardData } = await sb.rpc("fn_group_member_board", {
      p_group: group.id, p_period: period, p_day: today, p_season: seasonId, p_limit: limit,
    });
    const board = (boardData ?? []) as RankRow[];
    const { data: emails } = await sb.rpc("fn_group_member_emails", { p_group: group.id });
    const memberCount = (emails ?? []).length;

    // Handles (never raw email).
    const handleById = new Map<string, string>();
    const ids = board.map((r) => r.subscriber_id);
    if (ids.length) {
      const { data: subs } = await sb.from("dc_subscribers").select("id, handle, email").in("id", ids);
      for (const s of subs ?? []) handleById.set(s.id as string, (s.handle as string) || maskHandle(s.email as string));
    }

    // Parent company (for a team) + standings.
    let parentCode: string | null = null;
    let parentName: string | null = null;
    let teamVsTeam: { rank: number; of: number } | null = null;
    const companyId: string | null =
      group.group_type === "company" ? group.id : (group.parent_id as string | null);
    if (group.group_type === "team" && group.parent_id) {
      const { data: parent } = await sb.from("teams").select("code, name").eq("id", group.parent_id).maybeSingle();
      parentCode = (parent?.code as string) ?? null;
      parentName = (parent?.name as string) ?? null;
      const { data: sib } = await sb.rpc("fn_company_team_standings", {
        p_company: group.parent_id, p_period: period, p_day: today, p_season: seasonId,
      });
      const mine = (sib ?? []).find((r: { code: string }) => r.code === group.code);
      if (mine) teamVsTeam = { rank: Number((mine as { rank: number }).rank), of: (sib ?? []).length };
    }

    let companyVsCompany: { rank: number; of: number; beatsPct: number } | null = null;
    if (companyId) {
      const { data: co } = await sb.rpc("fn_company_standings", {
        p_period: period, p_day: today, p_season: seasonId,
      });
      const mine = (co ?? []).find((r: { company_id: string }) => r.company_id === companyId);
      if (mine) {
        const of = (co ?? []).length;
        const rank = Number((mine as { rank: number }).rank);
        companyVsCompany = { rank, of, beatsPct: of > 0 ? Math.round(((of - rank) / of) * 100) : 0 };
      }
    }

    const leaderboard = board.map((r) => ({
      rank: r.rank,
      handle: handleById.get(r.subscriber_id) ?? "player",
      signals: Number(r.signals) || 0,
      playStreak: r.play_streak ?? 0,
      fullSetStreak: r.full_set_streak ?? 0,
      movement: null, // team-scope snapshots land in Phase 4
      isYou: myId != null && r.subscriber_id === myId,
    }));

    let you: null | Record<string, unknown> = null;
    const myRow = board.find((r) => r.subscriber_id === myId);
    if (myRow) {
      you = {
        rank: myRow.rank,
        percentile: percentileOf(myRow.rank, memberCount),
        signals: Number(myRow.signals) || 0,
        playStreak: myRow.play_streak ?? 0,
        fullSetStreak: myRow.full_set_streak ?? 0,
        movement: null,
        handle: handleById.get(myRow.subscriber_id) ?? "you",
      };
    }

    return json({
      scope: "team",
      teamCode: group.code,
      period,
      seasonName: season?.name,
      dayLabel: period === "daily" ? "Today" : undefined,
      group: {
        code: group.code,
        name: group.name,
        groupType: group.group_type,
        parentCode,
        parentName,
        memberCount,
        teamVsTeam,
        companyVsCompany,
      },
      you,
      leaderboard,
      totalPlayers: memberCount,
      count: leaderboard.length,
    });
  } catch (e) {
    console.error("Unhandled error:", e);
    return json({ error: "Server error" }, 500);
  }
});
