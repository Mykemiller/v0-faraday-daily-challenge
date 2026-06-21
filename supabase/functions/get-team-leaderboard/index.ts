import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// GET /get-team-leaderboard?season=&limit=&token=
// Public read of the seasonal team standings (public.team_leaderboard). When a
// valid session token is supplied, also returns the caller's team and its rank
// so the lobby can highlight "your team". Mirrors the service-role + custom-auth
// style of the sibling daily-challenge functions (verify_jwt disabled).

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  try {
    const url = new URL(req.url);
    const season = url.searchParams.get("season");
    const limitRaw = Number(url.searchParams.get("limit") ?? "20");
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 20;
    const token = url.searchParams.get("token");

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: board, error: boardErr } = await sb.rpc("team_leaderboard", {
      p_season: season || null,
      p_limit: limit,
    });
    if (boardErr) { console.error(boardErr); return json({ error: "Leaderboard query failed" }, 500); }

    let myTeam: Record<string, unknown> | null = null;
    if (token) {
      const { data: session } = await sb
        .from("dc_sessions")
        .select("subscriber_id, expires_at")
        .eq("token", token)
        .maybeSingle();
      if (session && new Date(session.expires_at) >= new Date()) {
        const { data: sub } = await sb
          .from("dc_subscribers")
          .select("email")
          .eq("id", session.subscriber_id)
          .maybeSingle();
        if (sub?.email) {
          const { data: mt } = await sb.rpc("team_get_my_team", { p_email: sub.email });
          myTeam = (Array.isArray(mt) && mt[0]) || null;
          if (myTeam) {
            const row = (board ?? []).find(
              (r: { team_id: string }) => r.team_id === (myTeam as { team_id: string }).team_id,
            );
            myTeam.rank = row ? (row as { rank: number }).rank : null;
          }
        }
      }
    }

    return json({ season: season || null, leaderboard: board ?? [], myTeam });
  } catch (e) {
    console.error("Unhandled error:", e);
    return json({ error: "Server error" }, 500);
  }
});
