// Unit tests for faraday-crawl parser hardening.
// Run with: deno test supabase/functions/faraday-crawl/faraday-crawl.test.ts
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { extractAndParse, normalizeRecords } from "./index.ts";

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

// ─── FAR-188: per-record isolation ─────────────────────────────────────────────
Deno.test("normalizeRecords — a 50-record batch with one bad record does not abort", () => {
  // 13 automations → cap 4 each = capacity for all 49 good records.
  const batch = Array.from({ length: 13 }, (_, i) => ({
    auto_id: `AUTO-${String(900 + i)}`,
    source_type: "web_news",
    ifs_domains: ["D1"],
    queries: ["q"],
  }));

  const records: unknown[] = [];
  for (let i = 0; i < 49; i++) {
    records.push({
      auto_id: batch[i % batch.length].auto_id,
      source_url: `https://example.com/article-${i}`,
      title: `Title ${i}`,
      source: "Pub",
      summary: "Summary.",
      published_at: null,
      ifs_domains: ["D1"],
      keyword_matches: [],
    });
  }
  // The 50th record throws the moment `title` is read (hostile getter).
  const hostile: Record<string, unknown> = {
    auto_id: batch[0].auto_id,
    source_url: "https://example.com/boom",
  };
  Object.defineProperty(hostile, "title", { get() { throw new Error("boom-record"); }, enumerable: true });
  records.splice(25, 0, hostile); // bad record in the middle of the batch

  const { artifacts, parseErrors } = normalizeRecords(records, batch);

  // The whole batch was processed: 49 good artifacts survived the one bad row.
  assertEquals(artifacts.length, 49);
  assertEquals(parseErrors.length, 1);
  assertEquals(parseErrors[0].auto_id, batch[0].auto_id); // FK preserved
  assertEquals(parseErrors[0].reason, "boom-record");
});

Deno.test("normalizeRecords — null / non-object records are skipped, not fatal", () => {
  const batch = [{ auto_id: "AUTO-001", source_type: "web_news", ifs_domains: ["D1"], queries: ["q"] }];
  const records: unknown[] = [
    null,
    "not an object",
    { auto_id: "AUTO-001", source_url: "https://ok.com/x", title: "Good", ifs_domains: ["D1"] },
    42,
  ];
  const { artifacts, parseErrors } = normalizeRecords(records, batch);
  assertEquals(artifacts.length, 1);
  assertEquals(parseErrors.length, 0); // non-conforming ≠ parse error
});
