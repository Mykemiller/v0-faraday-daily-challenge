// faraday-crawl-healthcheck — post-crawl zero-artifact alert (FAR-253 / Stream A)
// Supabase Edge Function — POST /functions/v1/faraday-crawl-healthcheck
//
// PURPOSE
//   Fires one hour after the 07:00 UTC `faraday-crawl-daily` run (pg_cron at
//   08:00 UTC). If the `artifacts` table received ZERO new rows in the trailing
//   WINDOW_HOURS (default 2h — covers the 07:00 crawl), it emails Myke an
//   actionable alert. When fresh rows landed it is a silent no-op.
//
//   This is intentionally narrower and faster than the two existing monitors:
//     - faraday-daily-ops (13:00 UTC, 36h staleness) — daily digest, too coarse
//       and too late to catch a same-morning crawl failure.
//     - faraday-watchdog (every 6h, 36h staleness) — an auto-recovery ACTUATOR
//       that re-fires the routine; it never alerts a human.
//   None of them page Myke the morning a crawl produces 0 artifacts. This does.
//
//   The alert surfaces the most recent crawl failure reasons from
//   automation_health_log so the cause (e.g. an Anthropic credit-balance 400,
//   the 2026-06-25 outage) is visible in the email body without log-diving.
//
// AUTH (mirrors faraday-crawl / faraday-watchdog): verify_jwt=false; accepts the
//   service-role key OR the internal CRON_TOKEN. The daily cron sends the
//   CRON_TOKEN (not a JWT), so verify_jwt MUST stay false (a true setting 401s
//   the cron at the gateway — the same trap that bit faraday-crawl v2).
//
// NOTE: never writes to automation_health_log — that table feeds the staleness
//   signal this check reads. Audit/visibility comes from the email + JSON return.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CRON_TOKEN = "fcron_9mK3pX7qR2vN8wYz4tB6sL1dH5jG0aE";
const WINDOW_HOURS = Number(Deno.env.get("CRAWL_HEALTHCHECK_WINDOW_HOURS") ?? "2");
const TO = "mykemiller@gmail.com";
const FROM = "Faraday Ops <ops@faraday-intelligence.ai>";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// ── Pure helpers (exported for unit tests) ──────────────────────────────────────

// A single trailing-window count of 0 means the crawl produced nothing → alert.
export function shouldAlert(recentCount: number): boolean {
  return recentCount === 0;
}

// Collapse raw health-log error blobs into a small set of distinct, human-readable
// reasons. Errors are either strings or {kind,reason,...} objects (see faraday-crawl).
export function summarizeFailures(rows: Array<{ notes?: string | null; errors?: unknown }>): string[] {
  const seen = new Set<string>();
  for (const r of rows) {
    const errs = Array.isArray(r.errors) ? r.errors : r.errors != null ? [r.errors] : [];
    for (const e of errs) {
      let reason = "";
      if (typeof e === "string") reason = e;
      else if (e && typeof e === "object") {
        const o = e as Record<string, unknown>;
        reason = String(o.reason ?? o.message ?? JSON.stringify(o));
      } else reason = String(e);
      reason = reason.replace(/\s+/g, " ").trim().slice(0, 220);
      if (reason) seen.add(reason);
    }
    if (errs.length === 0 && r.notes) {
      const n = r.notes.replace(/\s+/g, " ").trim().slice(0, 220);
      if (n) seen.add(n);
    }
    if (seen.size >= 5) break;
  }
  return Array.from(seen).slice(0, 5);
}

export function buildAlertEmail(args: {
  windowHours: number;
  lastArtifactAt: string | null;
  failureReasons: string[];
  now: string;
}): { subject: string; html: string } {
  const { windowHours, lastArtifactAt, failureReasons, now } = args;
  const subject = `🚨 Faraday crawl — 0 new artifacts in last ${windowHours}h`;
  const reasonsHtml = failureReasons.length
    ? `<ul style="margin:8px 0 0;padding-left:18px;color:#5A4A2A;">${failureReasons
        .map((r) => `<li style="margin:4px 0;font-family:monospace;font-size:12px;">${escapeHtml(r)}</li>`)
        .join("")}</ul>`
    : `<p style="color:#5A4A2A;margin:8px 0 0;">No failure rows were logged in the window — the crawl cron may not have fired at all. Check pg_cron <code>faraday-crawl-daily</code> and the edge function logs.</p>`;

  const html = `<!DOCTYPE html><html><body style="font-family:Georgia,serif;background:#F8F5F0;color:#141210;padding:32px;max-width:600px;margin:0 auto;">
  <div style="font-size:12px;color:#C4922A;letter-spacing:0.12em;text-transform:uppercase;">FARADAY INTELLIGENCE · CRAWL HEALTH-CHECK</div>
  <h1 style="font-size:22px;margin:8px 0 4px;">🚨 Crawl produced 0 artifacts</h1>
  <p style="font-size:12px;color:#6B6560;margin:0 0 8px;">Checked at ${now} · trailing window ${windowHours}h (08:00 UTC, 1h after the 07:00 crawl)</p>
  <div style="background:#FBEEE0;border-left:3px solid #C4922A;padding:12px 16px;margin:16px 0;border-radius:4px;">
    <strong style="color:#8A5A00;">No new rows in the artifacts table in the last ${windowHours}h.</strong>
    <p style="margin:8px 0 0;color:#5A4A2A;">Last artifact discovered: <strong>${lastArtifactAt ?? "never"}</strong>.
    The Enrichment → IDF → JPS pipeline is blocked until the crawl resumes.</p>
  </div>
  <h2 style="font-size:14px;text-transform:uppercase;letter-spacing:0.08em;color:#6B6560;margin:24px 0 8px;">Most recent crawl failures</h2>
  ${reasonsHtml}
  <p style="font-size:11px;color:#9B958E;margin-top:32px;">Automated by faraday-crawl-healthcheck · Supabase pg_cron · ${now}</p>
</body></html>`;

  return { subject, html };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── Handler ─────────────────────────────────────────────────────────────────────
serve(async (req: Request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const provided = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (provided !== serviceKey && provided !== CRON_TOKEN) return json({ error: "Unauthorized" }, 401);

  const sb = createClient(supabaseUrl, serviceKey);
  const now = new Date().toISOString();
  const cutoff = new Date(Date.now() - WINDOW_HOURS * 3600_000).toISOString();

  // Count artifacts discovered in the trailing window.
  const { count, error: countErr } = await sb
    .from("artifacts")
    .select("artifact_id", { count: "exact", head: true })
    .gte("discovered_at", cutoff);
  if (countErr) return json({ error: "artifact count failed", detail: countErr.message }, 500);

  const recentCount = count ?? 0;

  if (!shouldAlert(recentCount)) {
    return json({ ok: true, alert: false, window_hours: WINDOW_HOURS, artifacts_in_window: recentCount });
  }

  // 0 artifacts → gather context for an actionable alert.
  const { data: lastRow } = await sb
    .from("artifacts").select("discovered_at")
    .order("discovered_at", { ascending: false }).limit(1).maybeSingle();
  const lastArtifactAt = lastRow?.discovered_at ?? null;

  const { data: failRows } = await sb
    .from("automation_health_log")
    .select("notes,errors")
    .eq("success", false)
    .gte("run_started_at", cutoff)
    .order("run_started_at", { ascending: false })
    .limit(40);
  const failureReasons = summarizeFailures(failRows ?? []);

  const { subject, html } = buildAlertEmail({ windowHours: WINDOW_HOURS, lastArtifactAt, failureReasons, now });

  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  if (!RESEND_API_KEY) {
    // Surface the alert even if email transport is unconfigured — never silent.
    console.error("faraday-crawl-healthcheck ALERT (RESEND_API_KEY unset):", subject, failureReasons);
    return json({ ok: false, alert: true, sent: false, reason: "RESEND_API_KEY not set",
      window_hours: WINDOW_HOURS, last_artifact_at: lastArtifactAt, failure_reasons: failureReasons }, 500);
  }

  const resendRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: TO, subject, html }),
  });
  if (!resendRes.ok) {
    const body = (await resendRes.text()).slice(0, 500);
    console.error("faraday-crawl-healthcheck Resend send failed:", resendRes.status, body);
    return json({ ok: false, alert: true, sent: false, status: resendRes.status, body }, 502);
  }

  const sent = await resendRes.json();
  return json({ ok: true, alert: true, sent: true, id: sent?.id, subject,
    window_hours: WINDOW_HOURS, last_artifact_at: lastArtifactAt, failure_reasons: failureReasons });
});
