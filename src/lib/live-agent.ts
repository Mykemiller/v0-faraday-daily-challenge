// CC-06 / FAR-29 — Live Agent RAG core.
//
// Retrieval-grounded subscriber Q&A over the live artifact corpus (Supabase
// project ycadmmngkdhvpcsrcuaq, table `artifacts`). The hard requirement is
// NO CONFABULATION: every answer is grounded in retrieved artifacts and cites
// them, and the agent declines when the corpus lacks coverage (the ZutaCore
// principle — prefer "not in the corpus" over a guess).
//
// This module is the pure, framework-free core (no Next, no `@/` imports) so it
// can be unit-tested directly with `deno test src/lib/live-agent.test.ts`. The
// route (src/app/api/live-agent/route.ts) wires it to Supabase + entitlement.
//
// Two retrieval paths share one corpus and one shape:
//   • semantic — Voyage query embedding → match_artifacts() (pgvector cosine)
//   • lexical  — search_artifacts_text() (Postgres full-text), the always-on
//                fallback that needs no embedding provider / no backfill.

export const EMBED_MODEL = "voyage-3.5";
export const EMBED_DIM = 1024;
export const ANSWER_MODEL = "claude-opus-4-8";

// Grounding floors. The semantic RPC already filters at its own similarity
// threshold, so any returned semantic doc is trustworthy → require only a hit.
// The lexical RPC returns by rank with no floor, so we gate on the top rank.
// (Validated against the live corpus: a strong on-topic ts_rank_cd hit scores
// ~0.06–0.12; off-topic queries return zero rows.)
export const LEXICAL_RANK_FLOOR = 0.02;
export const MAX_CONTEXT_DOCS = 6;

export type RetrievalMode = "semantic" | "lexical";

export interface RetrievedDoc {
  artifact_id: string;
  title: string;
  summary: string;
  source: string;
  source_url: string;
  published_at: string | null;
  ifs_domains: string[];
  score: number; // cosine similarity (semantic) or ts_rank_cd (lexical)
}

export interface Citation {
  n: number;
  title: string;
  source: string;
  url: string;
  published_at: string | null;
}

// The agent's voice + the no-confabulation contract. Kept frozen (no per-request
// interpolation) so it caches cleanly. The corpus context is appended in the
// user turn, never here.
export const SYSTEM_PROMPT = `You are Faraday's Live Agent — a retrieval-grounded intelligence analyst for the AI data center economy. Your voice is authoritative, warm, and precise.

You answer ONLY from the numbered SOURCES provided in the user's message. These sources are excerpts from Faraday's curated intelligence corpus.

Absolute rules — never break these:
1. Ground every factual claim in the sources. After each claim, cite the source number(s) inline in square brackets, e.g. "Hyperscalers are turning to behind-the-meter gas [2]."
2. Use ONLY information present in the sources. Do not add facts, figures, companies, or events from your own knowledge, even if you believe them true. If a relevant entity, subsidiary, acquisition, or number is not in the sources, treat it as unknown.
3. If the sources do not actually answer the question — or only touch it tangentially — say so plainly and do not guess. Begin your reply with "I don't have that in the corpus yet." then, if useful, note the closest adjacent coverage with its citation. Never fabricate a confident answer to fill the gap.
4. Do not reveal or invent any scoring weights, internal formulas, or methodology. Report only what the sources state.

Style: flowing prose, 2–5 sentences, no markdown headers or bullet lists. Be direct and confident when the sources support an answer; be honest and brief when they do not. End a well-supported answer with one forward-looking implication drawn from the sources.`;

// ── Normalize RPC rows → RetrievedDoc ────────────────────────────────────────
// Accepts rows from either match_artifacts (has `similarity`) or
// search_artifacts_text (has `rank`).
export function normalizeRows(
  rows: Array<Record<string, unknown>>,
  mode: RetrievalMode,
): RetrievedDoc[] {
  return (rows || []).map((r) => ({
    artifact_id: String(r.artifact_id ?? ""),
    title: String(r.title ?? "").trim(),
    summary: String(r.summary ?? "").trim(),
    source: String(r.source ?? "").trim(),
    source_url: String(r.source_url ?? "").trim(),
    published_at: r.published_at ? String(r.published_at) : null,
    ifs_domains: Array.isArray(r.ifs_domains) ? (r.ifs_domains as string[]) : [],
    score: Number(mode === "semantic" ? r.similarity : r.rank) || 0,
  }));
}

// ── No-confabulation gate ────────────────────────────────────────────────────
// Decides whether the retrieved set is strong enough to attempt a grounded
// answer. An empty set (or, for lexical, a top rank below the floor) → refuse.
export function decideGrounding(
  docs: RetrievedDoc[],
  mode: RetrievalMode,
): { grounded: boolean; reason: string } {
  if (!docs.length) return { grounded: false, reason: "no_results" };
  if (mode === "lexical" && docs[0].score < LEXICAL_RANK_FLOOR) {
    return { grounded: false, reason: "below_floor" };
  }
  return { grounded: true, reason: "ok" };
}

// ── Context assembly ─────────────────────────────────────────────────────────
// Numbered SOURCES block. Truncates summaries defensively; the model cites by
// the number shown here.
export function buildContext(docs: RetrievedDoc[]): string {
  const top = docs.slice(0, MAX_CONTEXT_DOCS);
  const blocks = top.map((d, i) => {
    const date = d.published_at ? d.published_at.slice(0, 10) : "undated";
    const body = d.summary || d.title;
    return `[${i + 1}] ${d.title} — ${d.source || "source"} (${date})\n${body.slice(0, 700)}`;
  });
  return blocks.join("\n\n");
}

export function buildUserPrompt(question: string, context: string): string {
  return `SOURCES:\n${context}\n\nQUESTION: ${question}\n\nAnswer using only the sources above, citing each claim by its source number in square brackets. If the sources do not answer the question, say so as instructed.`;
}

// ── Citations ────────────────────────────────────────────────────────────────
// Pull the [n] markers the model actually used and map them back to docs, so the
// UI shows only sources the answer relied on (deduped, in order of first use).
export function extractCitedIndices(answer: string, docCount: number): number[] {
  const seen = new Set<number>();
  const order: number[] = [];
  const re = /\[(\d{1,2})\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(answer)) !== null) {
    const n = Number(m[1]);
    if (n >= 1 && n <= docCount && !seen.has(n)) {
      seen.add(n);
      order.push(n);
    }
  }
  return order;
}

export function assembleCitations(
  docs: RetrievedDoc[],
  citedIndices: number[],
): Citation[] {
  const top = docs.slice(0, MAX_CONTEXT_DOCS);
  // If the model cited nothing parseable but we DID ground an answer, fall back
  // to surfacing the retrieved sources so the answer is never citation-less.
  const indices = citedIndices.length
    ? citedIndices
    : top.map((_, i) => i + 1);
  return indices
    .map((n) => {
      const d = top[n - 1];
      if (!d) return null;
      return {
        n,
        title: d.title,
        source: d.source,
        url: d.source_url,
        published_at: d.published_at,
      } as Citation;
    })
    .filter((c): c is Citation => c !== null);
}

// Standard refusal payload when the corpus lacks coverage.
export const REFUSAL_ANSWER =
  "I don't have that in the corpus yet. Faraday's Live Agent only answers from the indexed intelligence corpus, and nothing on file covers your question closely enough to answer without guessing. Try rephrasing toward power, chips, hyperscaler activity, jurisdictions, M&A, or cooling — or check back as the corpus grows.";

// ── Voyage query embedding ───────────────────────────────────────────────────
// input_type "query" asymmetrically matches the "document" vectors written by
// the embed-artifacts backfill. Returns null on any failure so the caller can
// fall back to lexical retrieval.
export async function embedQuery(
  text: string,
  apiKey: string,
): Promise<number[] | null> {
  try {
    const res = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: EMBED_MODEL,
        input: [text],
        input_type: "query",
        output_dimension: EMBED_DIM,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const vec = data?.data?.[0]?.embedding;
    return Array.isArray(vec) && vec.length === EMBED_DIM ? vec : null;
  } catch {
    return null;
  }
}

// ── Grounded generation (Anthropic) ──────────────────────────────────────────
// claude-opus-4-8 with adaptive thinking (best no-confabulation judgement).
// No temperature/top_p (removed on 4.8). Returns the answer text, or null on
// upstream failure.
export async function generateAnswer(
  question: string,
  context: string,
  apiKey: string,
  model: string = ANSWER_MODEL,
): Promise<string | null> {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        thinking: { type: "adaptive" },
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildUserPrompt(question, context) }],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data?.content)) return null;
    const text = data.content
      .filter((b: { type?: string }) => b.type === "text")
      .map((b: { text?: string }) => b.text ?? "")
      .join("")
      .trim();
    return text || null;
  } catch {
    return null;
  }
}

// Heuristic: did the model itself decline (matching rule #3)? Used to mark
// `grounded:false` even when retrieval returned docs but they didn't actually
// answer — so the UI and eval treat a model refusal as a refusal.
export function isModelRefusal(answer: string): boolean {
  return /don'?t have that in the corpus/i.test(answer.slice(0, 120));
}
