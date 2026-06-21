import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// POST /team-action  { sessionToken, action: "create"|"join"|"leave", name?, code? }
// Session-gated team membership for the per-player system. The caller is
// identified by their verified session token (dc_sessions -> dc_subscribers),
// so a player can only act as themselves. Wraps the teams_v1 RPCs
// (team_create / team_join / team_leave). Their RAISEd domain errors
// ("member already on a team", "invalid team code") are surfaced as 400s.

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => null);
    const { sessionToken, action, name, code } = body ?? {};
    if (typeof sessionToken !== "string" || !sessionToken) return json({ error: "Missing session" }, 401);
    if (!["create", "join", "leave"].includes(action)) return json({ error: "Invalid action" }, 400);

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: session, error: sessErr } = await sb
      .from("dc_sessions")
      .select("subscriber_id, expires_at")
      .eq("token", sessionToken)
      .maybeSingle();
    if (sessErr) { console.error(sessErr); return json({ error: "Session lookup failed" }, 500); }
    if (!session) return json({ error: "Invalid session" }, 401);
    if (new Date(session.expires_at) < new Date()) return json({ error: "Session expired" }, 401);

    const { data: sub, error: subErr } = await sb
      .from("dc_subscribers")
      .select("email")
      .eq("id", session.subscriber_id)
      .maybeSingle();
    if (subErr || !sub?.email) { console.error(subErr); return json({ error: "Subscriber not found" }, 404); }
    const email = sub.email;

    let result;
    if (action === "create") {
      if (typeof name !== "string" || !name.trim()) return json({ error: "Team name is required" }, 400);
      result = await sb.rpc("team_create", { p_email: email, p_name: name.trim(), p_code: code || null });
    } else if (action === "join") {
      if (typeof code !== "string" || !code.trim()) return json({ error: "Team code is required" }, 400);
      result = await sb.rpc("team_join", { p_email: email, p_code: code.trim() });
    } else {
      result = await sb.rpc("team_leave", { p_email: email });
    }

    if (result.error) {
      // teams_v1 RPCs RAISE on domain violations (already on a team, bad code).
      const msg = result.error.message || "Team action failed";
      const status = /already on a team|invalid team code|required/i.test(msg) ? 400 : 500;
      if (status === 500) console.error("team-action RPC error:", result.error);
      return json({ error: msg }, status);
    }

    // Return the caller's refreshed team view so the client can update in place.
    const { data: mt } = await sb.rpc("team_get_my_team", { p_email: email });
    return json({ ok: true, action, myTeam: (Array.isArray(mt) && mt[0]) || null });
  } catch (e) {
    console.error("Unhandled error:", e);
    return json({ error: "Server error" }, 500);
  }
});
