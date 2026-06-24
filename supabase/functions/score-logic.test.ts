// Unit tests for daily score accumulation, attempt idempotency, and handle
// validation logic. Run with: deno test supabase/functions/score-logic.test.ts

import { assertEquals, assertMatch, assertNotMatch } from "jsr:@std/assert";

// ── Handle validation (mirrors /api/account POST update-handle) ───────────────
const VALID_HANDLE = /^[a-z0-9]{3,20}$/;

Deno.test("handle: accepts 3-char alphanumeric", () => {
  assertMatch("abc", VALID_HANDLE);
  assertMatch("a1b", VALID_HANDLE);
  assertMatch("123", VALID_HANDLE);
});

Deno.test("handle: accepts 20-char alphanumeric", () => {
  assertMatch("a".repeat(20), VALID_HANDLE);
  assertMatch("a1".repeat(10), VALID_HANDLE);
});

Deno.test("handle: rejects underscores and dots (new handles)", () => {
  assertNotMatch("my_handle", VALID_HANDLE);
  assertNotMatch("my.handle", VALID_HANDLE);
  assertNotMatch("my handle", VALID_HANDLE);
});

Deno.test("handle: rejects too short (< 3)", () => {
  assertNotMatch("ab", VALID_HANDLE);
  assertNotMatch("a", VALID_HANDLE);
  assertNotMatch("", VALID_HANDLE);
});

Deno.test("handle: rejects too long (> 20)", () => {
  assertNotMatch("a".repeat(21), VALID_HANDLE);
});

Deno.test("handle: rejects uppercase (stored lowercase)", () => {
  assertNotMatch("MyHandle", VALID_HANDLE); // storage lowercases first; raw uppercase fails
});

// ── Daily accumulation (pure score math) ─────────────────────────────────────
function accumulateDailyScore(
  existing: { score: number; gamesPlayed: number } | null,
  addScore: number
): { score: number; gamesPlayed: number } {
  if (!existing) return { score: addScore, gamesPlayed: 1 };
  return { score: existing.score + addScore, gamesPlayed: existing.gamesPlayed + 1 };
}

Deno.test("accumulation: first game of the day", () => {
  const result = accumulateDailyScore(null, 115);
  assertEquals(result, { score: 115, gamesPlayed: 1 });
});

Deno.test("accumulation: second game adds to running total", () => {
  const result = accumulateDailyScore({ score: 115, gamesPlayed: 1 }, 95);
  assertEquals(result, { score: 210, gamesPlayed: 2 });
});

Deno.test("accumulation: 7 games (full set)", () => {
  let state: { score: number; gamesPlayed: number } | null = null;
  const scores = [100, 115, 90, 130, 75, 110, 125];
  for (const s of scores) state = accumulateDailyScore(state, s);
  assertEquals(state?.gamesPlayed, 7);
  assertEquals(state?.score, scores.reduce((a, b) => a + b, 0));
});

// ── Attempt idempotency ───────────────────────────────────────────────────────
// Simulates the dc_daily_attempts uniqueness constraint check.
function checkAttemptAllowed(
  attempts: Array<{ subscriberId: string; gameType: string; playDate: string }>,
  subscriberId: string,
  gameType: string,
  playDate: string
): { allowed: boolean; existingAttempt?: (typeof attempts)[0] } {
  const existing = attempts.find(
    (a) => a.subscriberId === subscriberId && a.gameType === gameType && a.playDate === playDate
  );
  return existing ? { allowed: false, existingAttempt: existing } : { allowed: true };
}

Deno.test("attempt: first attempt is allowed", () => {
  const result = checkAttemptAllowed([], "sub-1", "Rackl", "2026-06-24");
  assertEquals(result.allowed, true);
});

Deno.test("attempt: second attempt same game same day is rejected", () => {
  const attempts = [{ subscriberId: "sub-1", gameType: "Rackl", playDate: "2026-06-24" }];
  const result = checkAttemptAllowed(attempts, "sub-1", "Rackl", "2026-06-24");
  assertEquals(result.allowed, false);
  assertEquals(result.existingAttempt?.gameType, "Rackl");
});

Deno.test("attempt: same game different day is allowed (CT reset)", () => {
  const attempts = [{ subscriberId: "sub-1", gameType: "Rackl", playDate: "2026-06-23" }];
  const result = checkAttemptAllowed(attempts, "sub-1", "Rackl", "2026-06-24");
  assertEquals(result.allowed, true);
});

Deno.test("attempt: different game same day is allowed", () => {
  const attempts = [{ subscriberId: "sub-1", gameType: "Rackl", playDate: "2026-06-24" }];
  const result = checkAttemptAllowed(attempts, "sub-1", "Circuit", "2026-06-24");
  assertEquals(result.allowed, true);
});

Deno.test("attempt: different subscriber same game+day is allowed", () => {
  const attempts = [{ subscriberId: "sub-1", gameType: "Rackl", playDate: "2026-06-24" }];
  const result = checkAttemptAllowed(attempts, "sub-2", "Rackl", "2026-06-24");
  assertEquals(result.allowed, true);
});
