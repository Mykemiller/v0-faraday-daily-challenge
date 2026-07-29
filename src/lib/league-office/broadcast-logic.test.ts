// League Office — Announcements visibility-rule tests.
//   node --test src/lib/league-office/broadcast-logic.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import {
  LIVE_BROADCAST_ORDER,
  broadcastStatus,
  buildLiveBroadcastFilters,
  isSeverity,
} from "./broadcast-logic.ts";

const NOW = new Date("2026-07-29T12:00:00Z");
const iso = (d: string) => new Date(d).toISOString();

test("severity guard accepts only the three allowed values", () => {
  for (const ok of ["info", "warning", "celebration"]) assert.equal(isSeverity(ok), true);
  for (const bad of ["INFO", "urgent", "", null, undefined, 3, {}])
    assert.equal(isSeverity(bad), false);
});

test("lifecycle: live / scheduled / expired / revoked", () => {
  const base = { starts_at: iso("2026-07-29T09:00:00Z"), expires_at: null, revoked_at: null };
  assert.equal(broadcastStatus(base, NOW), "live");
  assert.equal(
    broadcastStatus({ ...base, starts_at: iso("2026-07-30T09:00:00Z") }, NOW),
    "scheduled"
  );
  assert.equal(
    broadcastStatus({ ...base, expires_at: iso("2026-07-29T11:00:00Z") }, NOW),
    "expired"
  );
  // revoked wins over everything, including a still-open window
  assert.equal(
    broadcastStatus({ ...base, revoked_at: iso("2026-07-29T10:00:00Z") }, NOW),
    "revoked"
  );
  // a future expiry is still live
  assert.equal(
    broadcastStatus({ ...base, expires_at: iso("2026-07-29T18:00:00Z") }, NOW),
    "live"
  );
});

// ── AC 4 + AC 5: revoked and expired broadcasts never reach a player ─────────
test("AC4/AC5 — the player filter excludes revoked, unstarted and expired rows", () => {
  const filters = buildLiveBroadcastFilters(NOW.toISOString(), []);
  assert.ok(filters.includes("revoked_at=is.null"), "revoked rows excluded");
  assert.ok(filters.includes(`starts_at=lte.${NOW.toISOString()}`), "future-dated rows excluded");
  assert.ok(
    filters.includes(`or=(expires_at.is.null,expires_at.gt.${NOW.toISOString()})`),
    "expired rows excluded; null expiry runs until revoked"
  );
});

// ── AC 3: dismissal is per-player ────────────────────────────────────────────
test("AC3 — this player's dismissals are excluded, and only theirs", () => {
  const a = "11111111-1111-4111-8111-111111111111";
  const b = "22222222-2222-4222-8222-222222222222";

  const forPlayerWithDismissals = buildLiveBroadcastFilters(NOW.toISOString(), [a, b]);
  assert.ok(forPlayerWithDismissals.includes(`id=not.in.(${a},${b})`));

  // A player who has dismissed nothing gets NO exclusion clause — so one
  // player's dismissal can never suppress the banner for another.
  const forFreshPlayer = buildLiveBroadcastFilters(NOW.toISOString(), []);
  assert.equal(forFreshPlayer.some((f) => f.startsWith("id=not.in")), false);
  assert.equal(forFreshPlayer.length, 3);
});

// ── AC 8: exactly one banner ─────────────────────────────────────────────────
test("AC8 — exactly one banner, by query not by constraint", () => {
  assert.equal(LIVE_BROADCAST_ORDER, "order=starts_at.desc&limit=1");
  assert.ok(LIVE_BROADCAST_ORDER.includes("limit=1"), "at most one row is ever returned");
  assert.ok(LIVE_BROADCAST_ORDER.includes("starts_at.desc"), "the most recent one wins");
});
