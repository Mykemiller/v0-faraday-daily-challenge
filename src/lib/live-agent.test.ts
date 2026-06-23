// Unit tests for the Live Agent RAG core (pure helpers).
// Run with: deno test src/lib/live-agent.test.ts
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  normalizeRows,
  decideGrounding,
  buildContext,
  buildUserPrompt,
  extractCitedIndices,
  assembleCitations,
  isModelRefusal,
  LEXICAL_RANK_FLOOR,
  MAX_CONTEXT_DOCS,
  type RetrievedDoc,
} from "./live-agent.ts";

function doc(over: Partial<RetrievedDoc> = {}): RetrievedDoc {
  return {
    artifact_id: "a1",
    title: "Natural Gas Powers the Data Center Boom",
    summary: "Hyperscalers turn to behind-the-meter gas as grid queues stretch.",
    source: "RBC Capital Markets",
    source_url: "https://example.com/gas",
    published_at: "2026-05-01T00:00:00+00:00",
    ifs_domains: ["D2", "D3"],
    score: 0.12,
    ...over,
  };
}

Deno.test("normalizeRows — semantic uses similarity, lexical uses rank", () => {
  const sem = normalizeRows([{ artifact_id: "x", similarity: 0.42 }], "semantic");
  assertEquals(sem[0].score, 0.42);
  const lex = normalizeRows([{ artifact_id: "x", rank: 0.07 }], "lexical");
  assertEquals(lex[0].score, 0.07);
});

Deno.test("normalizeRows — missing fields default safely", () => {
  const out = normalizeRows([{ artifact_id: "x" }], "lexical");
  assertEquals(out[0].title, "");
  assertEquals(out[0].ifs_domains, []);
  assertEquals(out[0].published_at, null);
  assertEquals(out[0].score, 0);
});

Deno.test("decideGrounding — empty results refuse", () => {
  const g = decideGrounding([], "lexical");
  assertEquals(g.grounded, false);
  assertEquals(g.reason, "no_results");
});

Deno.test("decideGrounding — lexical below floor refuses", () => {
  const g = decideGrounding([doc({ score: LEXICAL_RANK_FLOOR / 2 })], "lexical");
  assertEquals(g.grounded, false);
  assertEquals(g.reason, "below_floor");
});

Deno.test("decideGrounding — lexical above floor grounds", () => {
  const g = decideGrounding([doc({ score: 0.1 })], "lexical");
  assertEquals(g.grounded, true);
});

Deno.test("decideGrounding — any semantic hit grounds (RPC pre-filters)", () => {
  // Semantic results are pre-filtered by the RPC's similarity_threshold, so even
  // a modest score is trustworthy.
  const g = decideGrounding([doc({ score: 0.36 })], "semantic");
  assertEquals(g.grounded, true);
});

Deno.test("buildContext — numbers sources and caps at MAX_CONTEXT_DOCS", () => {
  const docs = Array.from({ length: 9 }, (_, i) =>
    doc({ artifact_id: `a${i}`, title: `Title ${i}` }));
  const ctx = buildContext(docs);
  assert(ctx.includes("[1] Title 0"));
  assert(ctx.includes(`[${MAX_CONTEXT_DOCS}] Title ${MAX_CONTEXT_DOCS - 1}`));
  assert(!ctx.includes(`[${MAX_CONTEXT_DOCS + 1}]`));
});

Deno.test("buildContext — includes source and date", () => {
  const ctx = buildContext([doc()]);
  assert(ctx.includes("RBC Capital Markets"));
  assert(ctx.includes("2026-05-01"));
});

Deno.test("buildUserPrompt — wraps sources and question", () => {
  const p = buildUserPrompt("What about gas?", "[1] X");
  assert(p.includes("SOURCES:"));
  assert(p.includes("QUESTION: What about gas?"));
});

Deno.test("extractCitedIndices — dedupes, orders, ignores out-of-range", () => {
  const got = extractCitedIndices("Claim [2] and [1], also [2] again, plus [9].", 3);
  assertEquals(got, [2, 1]); // [9] dropped (out of range), [2] deduped
});

Deno.test("assembleCitations — maps cited indices to docs", () => {
  const docs = [doc({ title: "A" }), doc({ title: "B" }), doc({ title: "C" })];
  const cites = assembleCitations(docs, [3, 1]);
  assertEquals(cites.length, 2);
  assertEquals(cites[0].n, 3);
  assertEquals(cites[0].title, "C");
  assertEquals(cites[1].title, "A");
});

Deno.test("assembleCitations — falls back to retrieved docs when none parsed", () => {
  const docs = [doc({ title: "A" }), doc({ title: "B" })];
  const cites = assembleCitations(docs, []);
  assertEquals(cites.length, 2); // surfaces sources so an answer is never citation-less
  assertEquals(cites[0].n, 1);
});

Deno.test("isModelRefusal — detects the corpus-gap decline", () => {
  assert(isModelRefusal("I don't have that in the corpus yet. The closest…"));
  assert(isModelRefusal("I dont have that in the corpus yet")); // apostrophe-less
  assertEquals(
    isModelRefusal("Hyperscalers are turning to gas [1]."),
    false,
  );
});
