// Run: npm run test:signal-room
//
// The Home tile's "Live" tag is a public claim about another deployment. These
// tests pin when the engine is allowed to make it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SIGNAL_ROOM_HEALTH_URL,
  SIGNAL_ROOM_UNKNOWN,
  SIGNAL_ROOM_URL,
  parseSignalRoomHealth,
  signalRoomTile,
} from "./signal-room.ts";

const healthy = { ok: true, status: "ok", live: true, signals: 200, last24h: 28, newestFiredAt: "2026-11-10T07:30:00.000Z" };

test("a healthy, launched feed earns Live and a measured count", () => {
  const h = parseSignalRoomHealth(healthy);
  assert.deepEqual(h, { ok: true, live: true, last24h: 28 });
  assert.deepEqual(signalRoomTile(h), { tag: "Live", stat: "28 Signals in the last 24 hours" });
});

test("the count is singular at one and omitted at zero", () => {
  assert.equal(signalRoomTile({ ok: true, live: true, last24h: 1 }).stat, "1 Signal in the last 24 hours");
  assert.deepEqual(signalRoomTile({ ok: true, live: true, last24h: 0 }), { tag: "Live", stat: undefined });
});

test("an unhealthy feed makes no claim at all", () => {
  // The exact body the Signal Room serves while its Supabase key is wrong.
  const down = { ok: false, status: "query_failed", live: true, signals: 0, last24h: 0, newestFiredAt: null };
  assert.deepEqual(parseSignalRoomHealth(down), SIGNAL_ROOM_UNKNOWN);
  assert.deepEqual(signalRoomTile(parseSignalRoomHealth(down)), { tag: undefined, stat: undefined });
});

test("a populated feed behind the Preview flag is not Live", () => {
  const h = parseSignalRoomHealth({ ...healthy, live: false });
  assert.equal(h.ok, true);
  assert.deepEqual(signalRoomTile(h), { tag: undefined, stat: undefined });
});

test("only a literal true counts as healthy", () => {
  for (const body of [null, undefined, "", "ok", 1, [], {}, { ok: "true" }, { ok: 1 }, { ok: "false", live: true }]) {
    assert.deepEqual(parseSignalRoomHealth(body), SIGNAL_ROOM_UNKNOWN, JSON.stringify(body));
  }
});

test("a malformed count never reaches the page", () => {
  for (const last24h of [-3, 2.5, "28", null, NaN, Infinity]) {
    assert.equal(parseSignalRoomHealth({ ...healthy, last24h }).last24h, 0, String(last24h));
  }
});

test("the tile, the route and the health probe share one origin", () => {
  assert.equal(SIGNAL_ROOM_URL, "https://faraday-signal-room.com/signal-room");
  assert.equal(SIGNAL_ROOM_HEALTH_URL, "https://faraday-signal-room.com/api/signal-room/health");
});

test("the homepage and the route import the address instead of repeating it", () => {
  for (const file of ["src/app/page.tsx", "src/app/signal-room/page.tsx"]) {
    const src = readFileSync(file, "utf8");
    assert.ok(!src.includes("faraday-signal-room.com"), `${file} hardcodes the Signal Room host`);
    assert.ok(src.includes("@/lib/signal-room"), `${file} should import from @/lib/signal-room`);
  }
});
