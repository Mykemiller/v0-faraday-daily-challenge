// CC-06 / FAR-29 — Live Agent embedding backfill.
// Supabase Edge Function — POST /functions/v1/embed-artifacts
//
// Embeds the artifact corpus into `artifacts.embedding` (pgvector) so the Live
// Agent's semantic retrieval (match_artifacts) has vectors to search. Idempotent
// and resumable: only rows WHERE embedding IS NULL are processed, capped per
// invocation, so it can be run repeatedly (or on a cron) until the corpus is
// fully embedded. Until then the Live Agent transparently uses the lexical
// full-text path — embeddings only upgrade recall, they are not a hard gate.
//
// Embedding provider: Voyage AI (Anthropic's recommended embeddings partner),
// model voyage-3.5 @ 1024 dims (input_type "document"). Keep EMBED_DIM in sync
// with the vector(1024) column in migration 20260623180000_live_agent_rag.sql.
//
// Auth: requires the `Authorization: Bearer <CRON_SECRET>` header when CRON_SECRET
// is set (so only the scheduler / an operator can trigger a backfill).
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VOYAGE_API_KEY, [CRON_SECRET].
//
// Tests: embed-artifacts.test.ts (pure helpers: buildEmbedText, chunk).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const EMBED_MODEL = "voyage-3.5";
const EMBED_DIM = 1024;
const BATCH_SIZE = 64; // Voyage accepts up to 128 inputs/call; 64 is comfortable
const MAX_ROWS_PER_RUN = 512; // bound work per invocation (8 Voyage calls)
const MAX_DOC_CHARS = 8000; // truncate the per-doc text fed to the embedder

interface ArtifactRow {
  artifact_id: string;
  raw_content: string | null;
  signal_envelope: { title?: string; summary?: string } | null;
}

// The text we embed per artifact: title + summary + body. Title and summary
// carry the human-facing signal; raw_content is the crawled excerpt. Exported
// for unit tests.
export function buildEmbedText(row: ArtifactRow): string {
  const env = row.signal_envelope || {};
  const parts = [env.title ?? "", env.summary ?? "", row.raw_content ?? ""]
    .map((p) => (p || "").trim())
    .filter(Boolean);
  return parts.join("\n").slice(0, MAX_DOC_CHARS);
}

// Exported for unit tests.
export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function embedDocuments(
  texts: string[],
  apiKey: string,
): Promise<number[][]> {
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: EMBED_MODEL,
      input: texts,
      input_type: "document",
      output_dimension: EMBED_DIM,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`voyage ${res.status}: ${detail.slice(0, 200)}`);
  }
  const data = await res.json();
  const out = (data?.data ?? []).map((d: { embedding: number[] }) => d.embedding);
  if (out.length !== texts.length) {
    throw new Error(`voyage returned ${out.length} embeddings for ${texts.length} inputs`);
  }
  return out;
}

serve(async (req) => {
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (cronSecret) {
    const auth = req.headers.get("authorization") || "";
    if (auth !== `Bearer ${cronSecret}`) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const voyageKey = Deno.env.get("VOYAGE_API_KEY");
  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: "supabase env missing" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
  if (!voyageKey) {
    return new Response(JSON.stringify({ error: "VOYAGE_API_KEY missing" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  // Pull the next slice of un-embedded artifacts.
  const { data: rows, error } = await supabase
    .from("artifacts")
    .select("artifact_id, raw_content, signal_envelope")
    .is("embedding", null)
    .limit(MAX_ROWS_PER_RUN);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  const pending = (rows ?? []) as ArtifactRow[];
  if (!pending.length) {
    return new Response(
      JSON.stringify({ ok: true, embedded: 0, remaining: 0, done: true }),
      { headers: { "content-type": "application/json" } },
    );
  }

  let embedded = 0;
  const errors: string[] = [];

  for (const batch of chunk(pending, BATCH_SIZE)) {
    try {
      const texts = batch.map(buildEmbedText);
      const vectors = await embedDocuments(texts, voyageKey);
      // Persist one row at a time so a single bad row can't void the batch.
      await Promise.all(
        batch.map(async (row, i) => {
          const { error: upErr } = await supabase
            .from("artifacts")
            .update({ embedding: vectors[i] })
            .eq("artifact_id", row.artifact_id);
          if (upErr) errors.push(`${row.artifact_id}: ${upErr.message}`);
          else embedded++;
        }),
      );
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  // Remaining count after this run (best-effort).
  const { count: remaining } = await supabase
    .from("artifacts")
    .select("artifact_id", { count: "exact", head: true })
    .is("embedding", null);

  return new Response(
    JSON.stringify({
      ok: errors.length === 0,
      embedded,
      remaining: remaining ?? null,
      done: (remaining ?? 0) === 0,
      errors: errors.slice(0, 10),
    }),
    { headers: { "content-type": "application/json" } },
  );
});
