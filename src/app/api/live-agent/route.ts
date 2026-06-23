// CC-06 / FAR-29 — Live Agent: retrieval-grounded subscriber Q&A.
//   POST /api/live-agent  { q, token, request_id? }
//     → 200 { answer, citations[], grounded, retrieval_mode, balance }
//     → 401 missing/invalid session · 402 out of tokens · 403 not entitled
//     → 500 not configured · 502 upstream (retry with the same request_id)
//
// Pipeline: resolve subscriber → retrieve (semantic→lexical) → no-confabulation
// gate (refuse for FREE if the corpus lacks coverage) → atomic 1-token debit
// (entitlement + balance, idempotent by request_id) → grounded generation with
// citations. Refused/un-answered questions are never charged.
//
// Server-only. Secrets stay here. Requires env:
//   SUPABASE_SERVICE_ROLE_KEY  (corpus + RPCs; same key /api/account uses)
//   ANTHROPIC_API_KEY          (grounded generation)
//   VOYAGE_API_KEY             (OPTIONAL — enables semantic retrieval; without
//                               it the route uses the lexical full-text path)

import {
  normalizeRows,
  decideGrounding,
  buildContext,
  generateAnswer,
  embedQuery,
  extractCitedIndices,
  assembleCitations,
  isModelRefusal,
  REFUSAL_ANSWER,
  MAX_CONTEXT_DOCS,
  type RetrievalMode,
  type RetrievedDoc,
} from "@/lib/live-agent";

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://ycadmmngkdhvpcsrcuaq.supabase.co";

const MATCH_COUNT = 8;

type Svc = { base: string; headers: Record<string, string> };

function svc(): Svc | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return {
    base: `${SUPABASE_URL}/rest/v1`,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
  };
}

async function resolveSubscriber(s: Svc, token: string): Promise<string | null> {
  const r = await fetch(
    `${s.base}/dc_sessions?token=eq.${encodeURIComponent(token)}&select=subscriber_id,expires_at`,
    { headers: s.headers, cache: "no-store" },
  );
  if (!r.ok) return null;
  const rows = await r.json().catch(() => null);
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return null;
  if (row.expires_at && new Date(row.expires_at) < new Date()) return null;
  return row.subscriber_id ?? null;
}

// Call a Postgres function via PostgREST RPC.
async function rpc(s: Svc, fn: string, args: Record<string, unknown>): Promise<unknown> {
  const r = await fetch(`${s.base}/rpc/${fn}`, {
    method: "POST",
    headers: s.headers,
    body: JSON.stringify(args),
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`rpc ${fn} ${r.status}`);
  return r.json();
}

// Retrieve the most relevant artifacts. Prefer semantic (Voyage + pgvector);
// fall back to lexical full-text when there's no embedding key, the embedding
// call fails, or semantic returns nothing (e.g. corpus not yet backfilled).
async function retrieve(
  s: Svc,
  question: string,
): Promise<{ docs: RetrievedDoc[]; mode: RetrievalMode }> {
  const voyageKey = process.env.VOYAGE_API_KEY;
  if (voyageKey) {
    const vec = await embedQuery(question, voyageKey);
    if (vec) {
      const rows = (await rpc(s, "match_artifacts", {
        query_embedding: vec,
        match_count: MATCH_COUNT,
      })) as Array<Record<string, unknown>>;
      const docs = normalizeRows(rows, "semantic");
      if (docs.length) return { docs, mode: "semantic" };
    }
  }
  const rows = (await rpc(s, "search_artifacts_text", {
    query_text: question,
    match_count: MATCH_COUNT,
  })) as Array<Record<string, unknown>>;
  return { docs: normalizeRows(rows, "lexical"), mode: "lexical" };
}

export async function POST(request: Request) {
  const s = svc();
  if (!s) {
    return Response.json(
      { error: "Live Agent service not configured" },
      { status: 500 },
    );
  }

  let body: { q?: string; token?: string; request_id?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const q = (body.q || "").trim();
  const token = (body.token || "").trim();
  const requestId = (body.request_id || "").trim() || null;
  if (!q) return Response.json({ error: "Missing question" }, { status: 400 });
  if (q.length > 500) {
    return Response.json({ error: "Question too long" }, { status: 400 });
  }
  if (!token) {
    return Response.json({ error: "Sign in to use Live Agent" }, { status: 401 });
  }

  const subscriberId = await resolveSubscriber(s, token);
  if (!subscriberId) {
    return Response.json({ error: "Invalid or expired session" }, { status: 401 });
  }

  // 1) Retrieve.
  let docs: RetrievedDoc[];
  let mode: RetrievalMode;
  try {
    ({ docs, mode } = await retrieve(s, q));
  } catch {
    return Response.json({ error: "Retrieval failed" }, { status: 502 });
  }

  // 2) No-confabulation gate — refuse for FREE when the corpus lacks coverage.
  const gate = decideGrounding(docs, mode);
  if (!gate.grounded) {
    return Response.json({
      answer: REFUSAL_ANSWER,
      citations: [],
      grounded: false,
      retrieval_mode: mode,
    });
  }

  // 3) Entitlement + atomic 1-token debit (idempotent by request_id). A grounded
  // answer costs exactly 1 Live Agent token.
  let debit: { ok?: boolean; reason?: string; balance?: number; tier?: string };
  try {
    const out = await rpc(s, "live_agent_debit", {
      p_subscriber: subscriberId,
      p_cost: 1,
      p_request_id: requestId,
      p_question: q,
    });
    debit = (Array.isArray(out) ? out[0] : out) as typeof debit;
  } catch {
    return Response.json({ error: "Token service failed" }, { status: 502 });
  }

  if (!debit?.ok) {
    if (debit?.reason === "not_entitled") {
      return Response.json(
        { error: "Live Agent requires an active plan", reason: "not_entitled" },
        { status: 403 },
      );
    }
    return Response.json(
      { error: "Out of Live Agent tokens this cycle", reason: "insufficient_tokens", balance: debit?.balance ?? 0 },
      { status: 402 },
    );
  }

  // 4) Grounded generation. If this fails AFTER the charge, the client may retry
  // with the SAME request_id — the debit is idempotent and won't double-charge.
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    return Response.json(
      { error: "Live Agent generation not configured" },
      { status: 500 },
    );
  }

  const context = buildContext(docs);
  const answer = await generateAnswer(q, context, anthropicKey);
  if (!answer) {
    return Response.json(
      { error: "Generation failed — please retry", request_id: requestId },
      { status: 502 },
    );
  }

  // 5) Map citations the model actually used; mark a model-level decline as
  // ungrounded so the UI/eval treat it as a refusal.
  const grounded = !isModelRefusal(answer);
  const cited = extractCitedIndices(answer, Math.min(docs.length, MAX_CONTEXT_DOCS));
  const citations = grounded ? assembleCitations(docs, cited) : [];

  return Response.json({
    answer,
    citations,
    grounded,
    retrieval_mode: mode,
    balance: debit.balance ?? null,
  });
}
