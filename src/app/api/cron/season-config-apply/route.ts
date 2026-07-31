// GET /api/cron/season-config-apply — hourly at :05 (vercel.json).
//
// Calls season_config_apply_due(), which flips every `scheduled` config whose
// effective_from has arrived to `active` and supersedes the incumbent, in ONE
// transaction. This is what makes effective dating real rather than decorative
// (spec §5) — without it a scheduled version would sit there forever.
//
// Idempotent: the RPC selects only rows still in `scheduled` with a due date, so
// a re-run (or the :05 firing twice) finds nothing and returns 0.
//
// Auth: CRON_SECRET Bearer, same pattern as the other cron routes.
// Audit: a row is written ONLY when something actually flipped — logging 24
// no-op rows a day would bury the entries a commissioner needs to read.

import { svc } from "@/lib/league-office/service";
import { rpc } from "@/lib/league-office/seasons";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`)
    return new Response("Unauthorized", { status: 401 });

  const s = svc();
  if (!s)
    return Response.json(
      { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY not set" },
      { status: 500 }
    );

  const r = await rpc<number>(s, "season_config_apply_due", {});
  if (!r.ok) {
    console.error("[season-config-apply] failed:", r.message);
    return Response.json({ ok: false, error: r.message }, { status: 500 });
  }

  const applied = Number(r.data) || 0;
  console.log(`[season-config-apply] applied=${applied}`);

  if (applied > 0) {
    await fetch(`${SUPABASE_URL}/rest/v1/lo_audit_log`, {
      method: "POST",
      headers: { ...s.headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        staff_email: "system@league-office.local",
        domain: "seasons",
        action: "config.apply_due",
        reason: `Scheduled effective date reached — ${applied} config version${applied === 1 ? "" : "s"} applied automatically.`,
        target_type: "season_config",
        target_id: null,
        before: null,
        after: { applied },
        reversible: false,
      }),
      cache: "no-store",
    }).catch(() => null);
  }

  return Response.json({ ok: true, applied });
}

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://ycadmmngkdhvpcsrcuaq.supabase.co";
