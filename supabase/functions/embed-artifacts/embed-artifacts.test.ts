// Unit tests for embed-artifacts pure helpers.
// Run with: deno test supabase/functions/embed-artifacts/embed-artifacts.test.ts
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { buildEmbedText, chunk } from "./index.ts";

Deno.test("buildEmbedText — title + summary + body, in order", () => {
  const t = buildEmbedText({
    artifact_id: "a1",
    raw_content: "Body text here.",
    signal_envelope: { title: "Title", summary: "Summary." },
  });
  assertEquals(t, "Title\nSummary.\nBody text here.");
});

Deno.test("buildEmbedText — skips empty parts", () => {
  const t = buildEmbedText({
    artifact_id: "a1",
    raw_content: null,
    signal_envelope: { title: "Only Title", summary: "" },
  });
  assertEquals(t, "Only Title");
});

Deno.test("buildEmbedText — tolerates null envelope", () => {
  const t = buildEmbedText({ artifact_id: "a1", raw_content: "Body", signal_envelope: null });
  assertEquals(t, "Body");
});

Deno.test("buildEmbedText — truncates very long bodies", () => {
  const t = buildEmbedText({
    artifact_id: "a1",
    raw_content: "x".repeat(20000),
    signal_envelope: { title: "T", summary: "S" },
  });
  assert(t.length <= 8000);
});

Deno.test("chunk — splits into batches", () => {
  assertEquals(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assertEquals(chunk([], 64), []);
});
