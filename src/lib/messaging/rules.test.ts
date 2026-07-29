// Unit tests for the pure messaging rules (CC-DC-MESSAGING-1.0). Pure logic —
// no I/O.
//
// Run with:  npm run test:messaging   (node --test with TS type-stripping,
// matching the faradays-take test setup).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_BODY_CHARS,
  DAY_MS,
  normalizeBody,
  orderPair,
  countInWindow,
  countUnread,
  isPairBlocked,
} from "./rules.ts";

const A = "0a70bd56-1111-4a76-9c00-000000000001";
const B = "f2e8cd10-2222-4b81-8d11-000000000002";
const C = "77aa0000-3333-4c92-9e22-000000000003";

test("normalizeBody: empty and whitespace-only bodies are rejected", () => {
  assert.deepEqual(normalizeBody(""), { ok: false, error: "empty" });
  assert.deepEqual(normalizeBody("   \n\t  "), { ok: false, error: "empty" });
  assert.deepEqual(normalizeBody(null), { ok: false, error: "empty" });
  assert.deepEqual(normalizeBody(undefined), { ok: false, error: "empty" });
  assert.deepEqual(normalizeBody(42), { ok: false, error: "empty" });
});

test("normalizeBody: 2000 chars passes, 2001 fails", () => {
  const atCap = "x".repeat(MAX_BODY_CHARS);
  assert.deepEqual(normalizeBody(atCap), { ok: true, body: atCap });
  assert.deepEqual(normalizeBody("x".repeat(MAX_BODY_CHARS + 1)), {
    ok: false,
    error: "too_long",
  });
  // Length is measured after trim — padding never rescues or condemns a body.
  assert.deepEqual(normalizeBody(`  ${atCap}  `), { ok: true, body: atCap });
});

test("orderPair: commutative and always low < high", () => {
  const ab = orderPair(A, B);
  const ba = orderPair(B, A);
  assert.deepEqual(ab, ba);
  assert.ok(ab.low < ab.high);
  assert.equal(ab.low, A);
  assert.equal(ab.high, B);
});

test("orderPair: case-insensitive (matches Postgres uuid comparison)", () => {
  const mixed = orderPair(A.toUpperCase(), B);
  assert.deepEqual(mixed, orderPair(A, B));
  assert.ok(mixed.low < mixed.high);
});

test("countInWindow: boundary at exactly 24h is outside the window", () => {
  const now = Date.parse("2026-07-30T12:00:00Z");
  const exactly24h = new Date(now - DAY_MS).toISOString();
  const justInside = new Date(now - DAY_MS + 1000).toISOString();
  const justOutside = new Date(now - DAY_MS - 1000).toISOString();
  assert.equal(countInWindow([exactly24h], now), 0);
  assert.equal(countInWindow([justInside], now), 1);
  assert.equal(countInWindow([justOutside], now), 0);
  assert.equal(countInWindow([exactly24h, justInside, justOutside], now), 1);
});

test("countInWindow: junk timestamps never count", () => {
  const now = Date.parse("2026-07-30T12:00:00Z");
  assert.equal(countInWindow(["not-a-date", ""], now), 0);
  assert.equal(countInWindow([], now), 0);
});

const msg = (
  createdAt: string,
  authorId: string,
  deletedAt: string | null = null
) => ({ created_at: createdAt, author_id: authorId, deleted_at: deletedAt });

test("countUnread: ignores my own messages", () => {
  const messages = [
    msg("2026-07-30T10:00:00Z", A),
    msg("2026-07-30T10:01:00Z", B),
    msg("2026-07-30T10:02:00Z", A),
  ];
  assert.equal(countUnread(messages, "2026-07-30T09:00:00Z", A), 1);
});

test("countUnread: ignores soft-deleted messages", () => {
  const messages = [
    msg("2026-07-30T10:00:00Z", B, "2026-07-30T11:00:00Z"),
    msg("2026-07-30T10:01:00Z", B),
  ];
  assert.equal(countUnread(messages, null, A), 1);
});

test("countUnread: 0 when last_read_at is newer than everything", () => {
  const messages = [
    msg("2026-07-30T10:00:00Z", B),
    msg("2026-07-30T10:01:00Z", B),
  ];
  assert.equal(countUnread(messages, "2026-07-30T12:00:00Z", A), 0);
});

test("countUnread: null last_read_at = all others' non-deleted messages", () => {
  const messages = [
    msg("2026-07-30T10:00:00Z", B),
    msg("2026-07-30T10:01:00Z", B, "2026-07-30T10:30:00Z"),
    msg("2026-07-30T10:02:00Z", A),
    msg("2026-07-30T10:03:00Z", B),
  ];
  assert.equal(countUnread(messages, null, A), 2);
});

test("isPairBlocked: true A→B, true B→A, false when unrelated", () => {
  assert.equal(isPairBlocked([{ blocker_id: A, blocked_id: B }], A, B), true);
  assert.equal(isPairBlocked([{ blocker_id: A, blocked_id: B }], B, A), true);
  assert.equal(isPairBlocked([{ blocker_id: B, blocked_id: A }], A, B), true);
  assert.equal(isPairBlocked([{ blocker_id: A, blocked_id: C }], A, B), false);
  assert.equal(isPairBlocked([], A, B), false);
});
