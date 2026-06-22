import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Sender moved to the Resend-verified faraday-intelligence.ai domain (DKIM via
// resend._domainkey + amazonses SPF on send.faraday-intelligence.ai). The old
// challenge@faradaydailychallenge.com apex 301-redirects and its SPF does not
// authorize Resend's amazonses path — magic links from it risk spam-filing.
const FROM_EMAIL = "challenge@faraday-intelligence.ai";
const MAGIC_LINK_BASE = "https://www.faraday-intelligence.ai/auth";

// Leaderboard V2 §5.1: same format the dc_subscribers_handle_format CHECK enforces.
const HANDLE_RE = /^[a-z0-9_]{3,20}$/;

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

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

function emailBody(link: string): string {
  return `<!DOCTYPE html><html><body style="font-family:'IBM Plex Serif',Georgia,serif;background:#0D110E;color:#E8E4DE;padding:40px;max-width:560px;margin:0 auto;">
  <div style="text-align:center;margin-bottom:32px;"><div style="font-size:14px;color:#C4922A;letter-spacing:0.12em;text-transform:uppercase;">FARADAY DAILY CHALLENGE</div></div>
  <h1 style="font-size:24px;color:#F8F5F0;font-weight:700;">Your magic link</h1>
  <p style="font-size:14px;line-height:1.7;margin-bottom:28px;">Click below to activate your profile. This link works once and expires in 15 minutes.</p>
  <a href="${link}" style="display:inline-block;background:#C4922A;color:#141210;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:600;">ACTIVATE MY PROFILE →</a>
  <p style="font-size:11px;color:#6B6560;margin-top:40px;">If you didn't request this, ignore this email.</p>
</body></html>`;
}

// Newsletter subscribe — ONLY called when the player explicitly opted in
// (Leaderboard V2 §6 consent fix). Best-effort: never throws, bounded so it
// can't hang the user-facing response. Returns the beehiiv subscription id or null.
async function subscribeToBeehiiv(
  email: string,
  source: string | undefined,
): Promise<string | null> {
  const BEEHIIV_API_KEY = Deno.env.get("BEEHIIV_API_KEY");
  const BEEHIIV_PUBLICATION_ID = Deno.env.get("BEEHIIV_PUBLICATION_ID");
  if (!BEEHIIV_API_KEY || !BEEHIIV_PUBLICATION_ID) {
    console.warn(
      "Beehiiv not configured (BEEHIIV_API_KEY / BEEHIIV_PUBLICATION_ID missing) - skipping newsletter subscribe",
    );
    return null;
  }
  try {
    const res = await fetchWithTimeout(
      `https://api.beehiiv.com/v2/publications/${BEEHIIV_PUBLICATION_ID}/subscriptions`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${BEEHIIV_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          reactivate_existing: true,
          send_welcome_email: false,
          utm_source: "faraday_daily_challenge",
          utm_medium: source || "magic_link_register",
          referring_site: "faraday-intelligence.ai",
        }),
      },
      5000,
    );
    if (!res.ok) {
      console.error("Beehiiv subscribe failed:", res.status, await res.text());
      return null;
    }
    const body = await res.json();
    return body?.data?.id ?? null;
  } catch (e) {
    console.error("Beehiiv subscribe error:", e);
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const { email, source, timezone, handle, newsletter_opt_in } = await req.json();
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    if (!normalizedEmail || !normalizedEmail.includes("@") || normalizedEmail.length > 256) {
      return json({ error: "Invalid email" }, 400);
    }

    // Leaderboard V2 §6: handle is captured here and bound server-side on verify
    // (review #5). Validate format up-front so a malformed handle is rejected
    // before the email is sent; null means "claim later".
    let chosenHandle: string | null = null;
    if (handle != null && handle !== "") {
      const h = typeof handle === "string" ? handle.trim().toLowerCase() : "";
      if (!HANDLE_RE.test(h)) {
        return json({ error: "Invalid handle", code: "invalid_handle" }, 400);
      }
      chosenHandle = h;
    }

    // Consent is captured at request time. Default DENY: only an explicit `true`
    // opts the player into the newsletter (Leaderboard V2 §6 / §13.3).
    const wantsNewsletter = newsletter_opt_in === true;

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      console.error("RESEND_API_KEY secret is not set");
      return json({ error: "Email service not configured" }, 500);
    }

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: subscriber, error: subErr } = await sb
      .from("dc_subscribers")
      .upsert(
        {
          email: normalizedEmail,
          source,
          timezone: timezone || "UTC",
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: "email" },
      )
      .select()
      .single();

    if (subErr || !subscriber) {
      console.error("Upsert subscriber failed:", subErr);
      return json({ error: "Could not register" }, 500);
    }

    const token =
      crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const { error: linkErr } = await sb
      .from("dc_magic_links")
      // handle rides on the link row so verify-magic-link can bind it after the
      // email round-trip — client memory is unreliable across mobile webviews.
      .insert({ token, email: normalizedEmail, expires_at: expiresAt, source, handle: chosenHandle });

    if (linkErr) {
      console.error("Insert magic link failed:", linkErr);
      return json({ error: "Could not create link" }, 500);
    }

    const magicLink = `${MAGIC_LINK_BASE}?token=${token}`;
    let resendRes: Response;
    try {
      resendRes = await fetchWithTimeout("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: `Faraday Daily Challenge <${FROM_EMAIL}>`,
          to: normalizedEmail,
          subject: "Your Faraday magic link",
          html: emailBody(magicLink),
        }),
      }, 10000);
    } catch (e) {
      console.error("Resend request errored:", e);
      return json({ error: "Email send failed" }, 500);
    }

    if (!resendRes.ok) {
      const resendBody = await resendRes.text();
      console.error("Resend send failed:", resendRes.status, resendBody);
      return json({ error: "Email send failed" }, 500);
    }

    // Newsletter is opt-in ONLY (Leaderboard V2 §6). Bounded + never throws, so a
    // Beehiiv outage can't block or delay magic-link login.
    if (wantsNewsletter) {
      const beehiivId = await subscribeToBeehiiv(normalizedEmail, source);
      if (beehiivId) {
        const { error: bhErr } = await sb
          .from("dc_subscribers")
          .update({ beehiiv_subscriber_id: beehiivId })
          .eq("id", subscriber.id);
        if (bhErr) console.error("Store beehiiv id failed:", bhErr);
      }
    }

    return json({ ok: true, subscriberId: subscriber.id });
  } catch (e) {
    console.error("Unhandled error:", e);
    return json({ error: "Server error" }, 500);
  }
});
