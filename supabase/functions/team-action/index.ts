import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// POST /team-action
//   { sessionToken, action: "create"|"join"|"leave", name?, code?, groupType?, parentCode? }
// Session-gated group membership (Leaderboard V2 §7.3). Multi-membership: a player
// can belong to several groups. The refactored RPCs handle hierarchy + transactional
// leave (last-member delete / creator rollover / company-creator no-cascade).
// "leave" now REQUIRES a code (which group). Returns the caller's refreshed groups.

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

// Domain (user-fixable) errors RAISEd by the RPCs -> 400; everything else 500.
const DOMAIN_ERR = /invalid team code|invalid parent code|group limit reached|not a member|must not have a parent|parent must be a company|required/i;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => null);
    const { sessionToken, action, name, code, groupType, parentCode } = body ?? {};
    if (typeof sessionToken !== "string" || !sessionToken) return json({ error: "Missing session" }, 401);
    if (!["create", "join", "leave"].includes(action)) return json({ error: "Invalid action" }, 400);

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: session, error: sessErr } = await sb
      .from("dc_sessions").select("subscriber_id, expires_at")
      .eq("token", sessionToken).maybeSingle();
    if (sessErr) { console.error(sessErr); return json({ error: "Session lookup failed" }, 500); }
    if (!session) return json({ error: "Invalid session" }, 401);
    if (new Date(session.expires_at) < new Date()) return json({ error: "Session expired" }, 401);

    const { data: sub, error: subErr } = await sb
      .from("dc_subscribers").select("email").eq("id", session.subscriber_id).maybeSingle();
    if (subErr || !sub?.email) { console.error(subErr); return json({ error: "Subscriber not found" }, 404); }
    const email = sub.email;

    let result;
    if (action === "create") {
      if (typeof name !== "string" || !name.trim()) return json({ error: "Group name is required" }, 400);
      const gt = ["company", "team", "custom"].includes(groupType) ? groupType : "custom";
      if (gt === "team" && (typeof parentCode !== "string" || !parentCode.trim())) {
        return json({ error: "A team requires a parent company code" }, 400);
      }
      result = await sb.rpc("team_create", {
        p_email: email,
        p_name: name.trim(),
        p_code: code?.trim() || null,
        p_group_type: gt,
        p_parent_code: parentCode?.trim() || null,
      });
    } else if (action === "join") {
      if (typeof code !== "string" || !code.trim()) return json({ error: "Group code is required" }, 400);
      result = await sb.rpc("team_join", { p_email: email, p_code: code.trim() });
    } else { // leave — now requires which group
      if (typeof code !== "string" || !code.trim()) return json({ error: "Group code is required" }, 400);
      result = await sb.rpc("team_leave", { p_email: email, p_code: code.trim() });
    }

    if (result.error) {
      const msg = result.error.message || "Group action failed";
      const status = DOMAIN_ERR.test(msg) ? 400 : 500;
      if (status === 500) console.error("team-action RPC error:", result.error);
      return json({ error: msg }, status);
    }

    // Return the caller's refreshed groups so the client can update in place.
    const { data: mine } = await sb.rpc("team_get_my_teams", { p_email: email });
    return json({ ok: true, action, myTeams: Array.isArray(mine) ? mine : [] });
  } catch (e) {
    console.error("Unhandled error:", e);
    return json({ error: "Server error" }, 500);
  }
});
