// ingest-email — Faraday email ingestion (unified transport, 2026-06-23)
// Supabase Edge Function — POST /functions/v1/ingest-email
//
// ONE endpoint, TWO inbound channels, both via Cloudflare Email Routing → the
// faraday-email-ingest Worker → this function:
//   - ingest@faraday-intelligence.ai  → direct streams (Google Alerts, Substack,
//     newsletters). Open sender (opt-in feeds; gated by the shared secret).
//   - forward@faraday-intelligence.ai → Myke's manual forwards from Gmail.
//     Sender allowlisted to mykemiller@gmail.com.
// Channel is decided by the to: address; provenance tagged accordingly.
//
// PAYLOAD (from the Worker):
//   POST { from, to, subject, text, html, received_at, message_id, urls? }
//   Auth: shared secret as `Authorization: Bearer <secret>` (preferred) or body.secret.
//
// AUTH: secret constant-time-compared against ingest_config.secret (id=1).
// DEDUP: artifacts.content_hash (UNIQUE) = sha256(message_id) || sha256(subject+text).
//
// verify_jwt = false — custom shared-secret auth.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const AUTO_ID = "AUTO-049";
const CRAWLER_ID = "ingest-email_v1.0";
const SOURCE_TYPE = "email";
const FORWARD_LOCALPART = "forward";              // forward@<domain> => allowlisted
const ALLOWED_FORWARD_FROM = "mykemiller@gmail.com";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// Constant-time compare — avoids trivial timing attacks on the secret.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// "Myke Miller <mykemiller@gmail.com>" → "mykemiller@gmail.com"
function normalizeEmail(raw: string): string {
  const m = raw.match(/<([^>]+)>/);
  return (m ? m[1] : raw).trim().toLowerCase();
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));

  // --- Auth: shared secret via header bearer or body.secret ---
  const authHeader = req.headers.get("authorization") || "";
  const headerSecret = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";
  const presented = headerSecret || str(body.secret);
  const { data: cfg, error: cfgErr } = await sb
    .from("ingest_config").select("secret").eq("id", 1).single();
  if (cfgErr || !cfg?.secret) {
    console.error("ingest_config read failed:", cfgErr);
    return json({ error: "Server not configured" }, 500);
  }
  if (!presented || !safeEqual(presented, cfg.secret)) {
    return json({ error: "Unauthorized" }, 401);
  }

  // --- Determine channel by the to: address ---
  const toRaw = str(body.to);
  const toNorm = normalizeEmail(toRaw);
  const toLocal = toNorm.split("@")[0];
  const isForward = toLocal === FORWARD_LOCALPART;
  const channel = isForward ? "email:forward" : "email:stream";

  const fromRaw = str(body.from);
  const fromNorm = normalizeEmail(fromRaw);

  // forward@ is allowlisted to Myke; ingest@ (streams) is open.
  if (isForward && fromNorm !== ALLOWED_FORWARD_FROM) {
    console.warn("ingest-email: rejected forward sender", fromRaw);
    return json({ error: "Sender not allowed on forward@", from: fromNorm }, 403);
  }

  // --- Build content + hash ---
  const messageId = str(body.message_id);
  const subject = str(body.subject);
  const text = str(body.text);
  const html = str(body.html);
  const receivedAt = str(body.received_at) || new Date().toISOString();
  const urls: string[] = Array.isArray(body.urls)
    ? body.urls.filter((u): u is string => typeof u === "string")
    : [];

  const contentHash = await sha256Hex(messageId || (subject + "\n" + text));
  const sourceUrl = messageId ? `email:${messageId}` : `email:sha256:${contentHash}`;
  const rawContent = text || html || subject || "(empty)";

  const crawlMetadata = {
    source_channel: channel,
    message_id: messageId || null,
    from: fromRaw,
    to: toNorm,
    subject,
    received_at: receivedAt,
    urls,
  };

  // --- Insert artifact (idempotent on content_hash) ---
  const runStarted = new Date().toISOString();
  const { data: insertData, error: insertErr } = await sb
    .from("artifacts")
    .upsert({
      crawler_id: CRAWLER_ID,
      auto_id: AUTO_ID,
      source_type: SOURCE_TYPE,
      source_url: sourceUrl,
      raw_content: rawContent,
      content_hash: contentHash,
      signal_envelope: { subject, from: fromRaw, to: toNorm, received_at: receivedAt, urls, channel },
      crawl_metadata: crawlMetadata,
      enrich_status: "pending",
      enrich_queued_at: runStarted,
      discovered_at: runStarted,
      published_at: receivedAt,
      airtable_synced: false,
    }, { onConflict: "content_hash", ignoreDuplicates: true })
    .select("artifact_id")
    .maybeSingle();

  if (insertErr) {
    console.error("ingest-email: artifact insert failed:", insertErr);
    await sb.from("automation_health_log").insert({
      auto_id: AUTO_ID, crawler_id: CRAWLER_ID,
      run_started_at: runStarted, run_completed_at: new Date().toISOString(),
      artifacts_found: 1, artifacts_new: 0, artifacts_duped: 0,
      success: false, errors: [insertErr.message], notes: `ingest-email(${channel}): insert failed`,
    });
    return json({ error: "Ingest failed", detail: insertErr.message }, 500);
  }

  const inserted = insertData != null;
  const artifactId = insertData?.artifact_id ?? null;

  await sb.from("automation_health_log").insert({
    auto_id: AUTO_ID, crawler_id: CRAWLER_ID,
    run_started_at: runStarted, run_completed_at: new Date().toISOString(),
    artifacts_found: 1,
    artifacts_new: inserted ? 1 : 0,
    artifacts_duped: inserted ? 0 : 1,
    success: true, errors: [],
    notes: inserted
      ? `ingest-email(${channel}): inserted ${artifactId}; subject="${subject.slice(0, 80)}"`
      : `ingest-email(${channel}): duplicate skipped; ${contentHash}`,
  });

  return json({ ok: true, channel, inserted, artifact_id: artifactId, content_hash: contentHash });
});
