// Unit tests for faraday-crawl-healthcheck pure helpers.
// Run with: deno test supabase/functions/faraday-crawl-healthcheck/faraday-crawl-healthcheck.test.ts
import { assertEquals, assert } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { shouldAlert, summarizeFailures, buildAlertEmail } from "./index.ts";

Deno.test("shouldAlert — only 0 in the window triggers an alert", () => {
  assertEquals(shouldAlert(0), true);
  assertEquals(shouldAlert(1), false);
  assertEquals(shouldAlert(50), false);
});

Deno.test("summarizeFailures — dedups string + object errors, caps at 5", () => {
  const rows = [
    { notes: "faraday-crawl batch failed", errors: ["Anthropic 400: credit balance too low"] },
    { notes: "faraday-crawl batch failed", errors: ["Anthropic 400: credit balance too low"] }, // dup
    { notes: "parse_error: boom", errors: [{ kind: "parse_error", reason: "boom-record", excerpt: "{}" }] },
    { notes: "x", errors: [{ message: "upstream 503" }] },
  ];
  const out = summarizeFailures(rows);
  assertEquals(out.length, 3);
  assert(out.includes("Anthropic 400: credit balance too low"));
  assert(out.includes("boom-record"));
  assert(out.includes("upstream 503"));
});

Deno.test("summarizeFailures — falls back to notes when errors empty", () => {
  const out = summarizeFailures([{ notes: "no errors but failed", errors: [] }]);
  assertEquals(out, ["no errors but failed"]);
});

Deno.test("buildAlertEmail — subject + body carry window, last-seen and reasons", () => {
  const { subject, html } = buildAlertEmail({
    windowHours: 2,
    lastArtifactAt: "2026-06-24T00:28:59Z",
    failureReasons: ["Anthropic 400: credit balance too low"],
    now: "2026-06-26T08:00:00Z",
  });
  assert(subject.includes("0 new artifacts"));
  assert(subject.includes("2h"));
  assert(html.includes("2026-06-24T00:28:59Z"));
  assert(html.includes("Anthropic 400: credit balance too low"));
});

Deno.test("buildAlertEmail — HTML-escapes failure reasons", () => {
  const { html } = buildAlertEmail({
    windowHours: 2,
    lastArtifactAt: null,
    failureReasons: ['<script>alert("x")</script>'],
    now: "2026-06-26T08:00:00Z",
  });
  assert(!html.includes("<script>"));
  assert(html.includes("&lt;script&gt;"));
  assert(html.includes("never")); // null last-artifact renders as "never"
});
