// Unit tests for faraday-crawl parser hardening.
// Run with: deno test supabase/functions/faraday-crawl/faraday-crawl.test.ts
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { extractAndParse } from "./index.ts";

Deno.test("extractAndParse — valid JSON", () => {
  const text = JSON.stringify({
    artifacts: [
      { auto_id: "AUTO-001", source_type: "web_news", source_url: "https://example.com/a", title: "Title A", source: "Pub", summary: "Summary A.", published_at: "2026-06-23", ifs_domains: ["D1"], keyword_matches: ["AI"] },
    ],
    note: "1 article found",
  });
  const { artifacts, note, salvaged } = extractAndParse(text);
  assertEquals(artifacts.length, 1);
  assertEquals((artifacts[0] as Record<string, unknown>).auto_id, "AUTO-001");
  assertEquals(note, "1 article found");
  assertEquals(salvaged, false);
});

Deno.test("extractAndParse — code-fence-wrapped JSON", () => {
  const inner = JSON.stringify({
    artifacts: [
      { auto_id: "AUTO-017", source_type: "web_news", source_url: "https://example.com/b", title: "Title B", source: "Pub", summary: "Summary B.", published_at: null, ifs_domains: ["D3"], keyword_matches: [] },
    ],
    note: "fenced",
  });
  const text = "```json\n" + inner + "\n```";
  const { artifacts, salvaged } = extractAndParse(text);
  assertEquals(salvaged, false);
  assertEquals(artifacts.length, 1);
  assertEquals((artifacts[0] as Record<string, unknown>).auto_id, "AUTO-017");
});

Deno.test("extractAndParse — truncated JSON salvages complete objects", () => {
  // Simulate truncation mid-way through the third artifact
  const full = '{"artifacts":[{"auto_id":"AUTO-001","source_type":"web_news","source_url":"https://a.com","title":"T1","source":"P","summary":"S1","published_at":null,"ifs_domains":["D1"],"keyword_matches":[]},{"auto_id":"AUTO-036","source_type":"web_news","source_url":"https://b.com","title":"T2","source":"P","summary":"S2","published_at":null,"ifs_domains":["D1"],"keyword_matches":[]},{"auto_id":"AUTO-037","source_type":"web_news","source_url":"https://c.com","title":"T3"';
  const { artifacts, salvaged } = extractAndParse(full);
  assertEquals(salvaged, true);
  // Should salvage the two complete objects
  assertEquals(artifacts.length, 2);
  assertEquals((artifacts[0] as Record<string, unknown>).auto_id, "AUTO-001");
  assertEquals((artifacts[1] as Record<string, unknown>).auto_id, "AUTO-036");
});

Deno.test("extractAndParse — embedded unescaped control chars in surrounding prose", () => {
  // Model wraps JSON in prose with a stray tab / newline before the array
  const text = `Here are the results:\t\n{"artifacts":[{"auto_id":"AUTO-023","source_type":"web_news","source_url":"https://d.com","title":"T4","source":"P","summary":"S4","published_at":null,"ifs_domains":["D4"],"keyword_matches":[]}],"note":"tab test"}`;
  const { artifacts, salvaged } = extractAndParse(text);
  assertEquals(salvaged, false);
  assertEquals(artifacts.length, 1);
  assertEquals((artifacts[0] as Record<string, unknown>).auto_id, "AUTO-023");
});

Deno.test("extractAndParse — fully empty / junk response returns empty with salvage flag", () => {
  const { artifacts, salvaged } = extractAndParse("I could not find any relevant articles today.");
  assertEquals(salvaged, true);
  assertEquals(artifacts.length, 0);
});
