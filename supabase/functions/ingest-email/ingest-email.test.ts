// Unit tests for ingest-email helper functions.
// Run with: deno test supabase/functions/ingest-email/ingest-email.test.ts
import { assertEquals, assertNotEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { safeEqual, normalizeEmail, sha256Hex } from "./index.ts";

// ─── safeEqual ────────────────────────────────────────────────────────────────
Deno.test("safeEqual — identical strings match", () => {
  assertEquals(safeEqual("abc123", "abc123"), true);
});

Deno.test("safeEqual — different strings reject", () => {
  assertEquals(safeEqual("abc123", "abc124"), false);
});

Deno.test("safeEqual — different length strings reject", () => {
  assertEquals(safeEqual("abc", "abcd"), false);
});

Deno.test("safeEqual — empty strings match", () => {
  assertEquals(safeEqual("", ""), true);
});

// ─── normalizeEmail ───────────────────────────────────────────────────────────
Deno.test("normalizeEmail — bare address unchanged", () => {
  assertEquals(normalizeEmail("mykemiller@gmail.com"), "mykemiller@gmail.com");
});

Deno.test("normalizeEmail — display name stripped", () => {
  assertEquals(normalizeEmail("Myke Miller <mykemiller@gmail.com>"), "mykemiller@gmail.com");
});

Deno.test("normalizeEmail — uppercased address lowercased", () => {
  assertEquals(normalizeEmail("MykeMiller@Gmail.COM"), "mykemiller@gmail.com");
});

Deno.test("normalizeEmail — display name with uppercase stripped + lowercased", () => {
  assertEquals(normalizeEmail("Myke <MykeMiller@Gmail.COM>"), "mykemiller@gmail.com");
});

Deno.test("normalizeEmail — non-allowlisted address returned as-is (normalized)", () => {
  const result = normalizeEmail("attacker@evil.com");
  assertEquals(result, "attacker@evil.com");
  assertNotEquals(result, "mykemiller@gmail.com");
});

// ─── sha256Hex ────────────────────────────────────────────────────────────────
Deno.test("sha256Hex — known vector", async () => {
  // SHA-256 of empty string
  const result = await sha256Hex("");
  assertEquals(result, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
});

Deno.test("sha256Hex — same input is idempotent", async () => {
  const a = await sha256Hex("test-message-id-12345");
  const b = await sha256Hex("test-message-id-12345");
  assertEquals(a, b);
});

Deno.test("sha256Hex — different inputs produce different hashes", async () => {
  const a = await sha256Hex("msg-001");
  const b = await sha256Hex("msg-002");
  assertNotEquals(a, b);
});

// ─── Allowlist logic (inline simulation — no live Supabase needed) ────────────
Deno.test("allowlist — mykemiller@gmail.com passes", () => {
  const ALLOWED_FROM = "mykemiller@gmail.com";
  assertEquals(normalizeEmail("mykemiller@gmail.com") === ALLOWED_FROM, true);
  assertEquals(normalizeEmail("Myke <mykemiller@gmail.com>") === ALLOWED_FROM, true);
  assertEquals(normalizeEmail("MYKEMILLER@GMAIL.COM") === ALLOWED_FROM, true);
});

Deno.test("allowlist — non-gmail address rejected", () => {
  const ALLOWED_FROM = "mykemiller@gmail.com";
  assertEquals(normalizeEmail("someone@otherdomain.com") === ALLOWED_FROM, false);
  assertEquals(normalizeEmail("mykemiller@yahoo.com") === ALLOWED_FROM, false);
  assertEquals(normalizeEmail("") === ALLOWED_FROM, false);
});
