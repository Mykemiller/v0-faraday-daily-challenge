import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    const { token } = await req.json();
    if (typeof token !== "string" || !token) return json({ error: "Missing token" }, 400);

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: link, error: linkErr } = await sb
      .from("dc_magic_links")
      .select("*")
      .eq("token", token)
      .maybeSingle();

    if (linkErr) {
      console.error("Magic link lookup failed:", linkErr);
      return json({ error: "Lookup failed" }, 500);
    }
    if (!link) return json({ error: "Invalid token" }, 400);
    if (link.consumed_at) return json({ error: "Link already used" }, 400);
    if (new Date(link.expires_at) < new Date()) return json({ error: "Link expired" }, 400);

    await sb
      .from("dc_magic_links")
      .update({ consumed_at: new Date().toISOString() })
      .eq("token", token);

    const { data: sub, error: subErr } = await sb
      .from("dc_subscribers")
      .select("*")
      .eq("email", link.email)
      .maybeSingle();

    if (subErr || !sub) {
      console.error("Subscriber lookup failed:", subErr);
      return json({ error: "Subscriber not found" }, 404);
    }

    // Leaderboard V2 §6 (reviews #3 + #5): bind the handle chosen at register
    // time, server-side, now that the email round-trip is complete. Only bind if
    // the subscriber hasn't already claimed one. A concurrent claim of the same
    // handle trips the UNIQUE constraint (23505) -> clean 409 handle_taken. We
    // still mint the session (the link was valid) so the UI can re-prompt for a
    // new handle WITHOUT losing the login.
    let handleBound = false;
    let handleTaken = false;
    const desiredHandle = link.handle as string | null;
    if (desiredHandle && !sub.handle) {
      const { error: hErr } = await sb
        .from("dc_subscribers")
        .update({ handle: desiredHandle })
        .eq("id", sub.id)
        .is("handle", null);
      if (hErr) {
        if ((hErr as { code?: string }).code === "23505") {
          handleTaken = true; // someone else holds this handle
        } else {
          console.error("Handle bind failed:", hErr);
        }
      } else {
        handleBound = true;
      }
    }

    const sessionToken =
      crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    const expiresAt = new Date(Date.now() + 30 * 86400000).toISOString();
    const { error: sessErr } = await sb
      .from("dc_sessions")
      .insert({ token: sessionToken, subscriber_id: sub.id, expires_at: expiresAt });

    if (sessErr) {
      console.error("Session creation failed:", sessErr);
      return json({ error: "Session creation failed" }, 500);
    }

    const effectiveHandle = handleBound ? desiredHandle : (sub.handle ?? null);
    const payload = {
      ok: !handleTaken,
      sessionToken,
      handleTaken,
      subscriber: {
        email: sub.email,
        handle: effectiveHandle,
        playStreak: sub.play_streak,
        fullSetStreak: sub.full_set_streak,
        mwBalance: sub.mw_balance,
      },
    };

    // 409 signals "pick another handle" but still carries the session token, so
    // the client stays logged in and re-prompts (Leaderboard V2 §6).
    if (handleTaken) {
      return json({ ...payload, error: "handle_taken" }, 409);
    }
    return json(payload);
  } catch (e) {
    console.error("Unhandled error:", e);
    return json({ error: "Server error" }, 500);
  }
});
