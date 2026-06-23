// ingest-email — Faraday email-ingestion parser (2026-06-23 hardening)
// Supabase Edge Function — POST /functions/v1/ingest-email
//
// Accepts forwarded emails from mykemiller@gmail.com → artifacts pipeline.
// The transport layer (Gmail filter → Cloudflare Worker or inbound-parse
// provider) is Myke-side; this function enforces auth + allowlist + dedup.
//
// PAYLOAD CONTRACT:
//   POST { "secret": "<shared>", "from": "<original sender>", "subject": "...",
//          "text": "...", "html": "...", "received_at": "<iso>",
//          "message_id": "<gmail msg id>", "urls": ["..."] }
//
// SECURITY:
//   - secret: compared constant-time against ingest_config.secret (id=1).
//   - from: must equal mykemiller@gmail.com (case-insensitive exact).
//   - Rejected senders → 403; bad secret → 401; no artifact written.
//
// DEDUP: content_hash = sha256(message_id) if present, else sha256(subject+"\n"+text).
//   Replaying the same message_id is idempotent (ON CONFLICT DO NOTHING).
//
// SOURCE TYPE: uses "web_news" pending governance approval to add "email" to
//   source_type_enum (migration proposed in PR description — see TODO below).
//
// AUTO-ID: uses "TBD_AUTO_ID" pending Myke's approval of the next free slot.
//   Proposed: AUTO-049. Update ALLOWED_AUTO_ID constant once approved.
//   crawler_id is stable now: "ingest-email_v1.0".
//
// verify_jwt = false — custom shared-secret auth.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// TODO(governance): replace with approved AUTO-ID (proposed: AUTO-049)
const PENDING_AUTO_ID = "AUTO-TBD";
const CRAWLER_ID = "ingest-email_v1.0";
const ALLOWED_FROM = "mykemiller@gmail.com";
// TODO(governance): replace with "email" once ALTER TYPE source_type_enum ADD VALUE 'email' migration is applied
const SOURCE_TYPE = "web_news";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// Constant-time compare — avoids trivial timing attacks on the secret
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// Normalize an email address: strip display name, lowercase.
// "Myke Miller <mykemiller@gmail.com>" → "mykemiller@gmail.com"
export function normalizeEmail(raw: string): string {
  const m = raw.match(/<([^>]+)>/);
  return (m ? m[1] : raw).trim().toLowerCase();
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // --- Parse request body ---
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));

  // --- Auth: secret in body, constant-time compare ---
  const presented = str(body.secret);
  const { data: cfg, error: cfgErr } = await sb
    .from("ingest_config").select("secret").eq("id", 1).single();
  if (cfgErr || !cfg?.secret) {
    console.error("ingest_config read failed:", cfgErr);
    return json({ error: "Server not configured" }, 500);
  }
  if (!presented || !safeEqual(presented, cfg.secret)) {
    return json({ error: "Unauthorized" }, 401);
  }

  // --- Sender allowlist: verified original sender must be mykemiller@gmail.com ---
  const fromRaw = str(body.from);
  const fromNorm = normalizeEmail(fromRaw);
  if (fromNorm !== ALLOWED_FROM) {
    console.warn("ingest-email: rejected sender", fromRaw);
    return json({ error: "Sender not allowed", from: fromNorm }, 403);
  }

  // --- Build content_hash and source_url ---
  const messageId = str(body.message_id);
  const subject = str(body.subject);
  const text = str(body.text);
  const html = str(body.html);
  const receivedAt = str(body.received_at) || new Date().toISOString();
  const urls: string[] = Array.isArray(body.urls)
    ? body.urls.filter((u): u is string => typeof u === "string")
    : [];

  const hashBasis = messageId || (subject + "\n" + text);
  const contentHash = await sha256Hex(hashBasis);
  const sourceUrl = messageId ? `gmail:${messageId}` : `gmail:sha256:${contentHash}`;

  // raw_content: text body; fall back to html; final fall back to subject
  const rawContent = text || html || subject || "(empty)";

  // Compose crawl_metadata with all available signal
  const crawlMetadata: Record<string, unknown> = {
    source_channel: "email",
    message_id: messageId || null,
    from: fromRaw,
    subject,
    received_at: receivedAt,
    urls,
  };

  // --- Insert artifact (idempotent on content_hash conflict) ---
  const runStarted = new Date().toISOString();
  const { data: insertData, error: insertErr } = await sb
    .from("artifacts")
    .upsert({
      crawler_id: CRAWLER_ID,
      auto_id: PENDING_AUTO_ID,
      source_type: SOURCE_TYPE,
      source_url: sourceUrl,
      raw_content: rawContent,
      content_hash: contentHash,
      signal_envelope: { subject, from: fromRaw, received_at: receivedAt, urls },
      crawl_metadata: crawlMetadata,
      enrich_status: "pending",
      enrich_queued_at: runStarted,
      discovered_at: runStarted,
      published_at: receivedAt,
      airtable_synced: false,
    }, { onConflict: "content_hash", ignoreDuplicates: true })
    .select("artifact_id, enrich_status")
    .single();

  if (insertErr) {
    console.error("ingest-email: artifact insert failed:", insertErr);
    // Log health failure
    await sb.from("automation_health_log").insert({
      auto_id: PENDING_AUTO_ID, crawler_id: CRAWLER_ID,
      run_started_at: runStarted, run_completed_at: new Date().toISOString(),
      artifacts_found: 1, artifacts_new: 0, artifacts_duped: 0,
      success: false, errors: [insertErr.message], notes: "ingest-email: artifact insert failed",
    });
    return json({ error: "Ingest failed", detail: insertErr.message }, 500);
  }

  const inserted = insertData != null;
  const artifactId = insertData?.artifact_id ?? null;

  // --- Health log ---
  await sb.from("automation_health_log").insert({
    auto_id: PENDING_AUTO_ID, crawler_id: CRAWLER_ID,
    run_started_at: runStarted, run_completed_at: new Date().toISOString(),
    artifacts_found: 1,
    artifacts_new: inserted ? 1 : 0,
    artifacts_duped: inserted ? 0 : 1,
    success: true, errors: [],
    notes: inserted
      ? `ingest-email: inserted artifact_id=${artifactId}; subject="${subject.slice(0, 80)}"`
      : `ingest-email: duplicate skipped; content_hash=${contentHash}`,
  });

  return json({ ok: true, inserted, artifact_id: artifactId, content_hash: contentHash });
});
