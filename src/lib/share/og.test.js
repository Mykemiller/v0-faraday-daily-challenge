import test from "node:test";
import assert from "node:assert/strict";
import { dayCardMeta } from "./og.js";
import { buildShareRegistry } from "./manifest.js";
import { gameRow } from "../test-factories.js";

// CC-DC-GAME-REGISTRY-1.0 D10: factory-built rows, not the live seven. Two
// games are enough to exercise slug lookup, legacy display-name lookup, and the
// unknown-game fallback.
const REG = buildShareRegistry([
  gameRow({ runtime_key: "Dark Fiber", display_name: "Dark Fiber", route_slug: "dark-fiber", share_epoch: "2026-06-24" }),
  gameRow({ runtime_key: "Signal Drop", display_name: "Signal Drop", route_slug: "signal-drop", share_epoch: "2026-06-24" }),
  gameRow({ runtime_key: "Rackl", display_name: "Rackl", route_slug: "rackl", share_epoch: "2026-06-24" }),
]);

test("game slug + date → day-scoped per-game unfurl with #number", () => {
  const m = dayCardMeta({ g: "dark-fiber", d: "2026-07-31" }, REG);
  assert.equal(m.title, "Dark Fiber · Faraday Daily Challenge");
  assert.ok(m.description.includes("#38"));
  assert.equal(m.pageUrl, "https://www.faradaydailychallenge.com/?g=dark-fiber&d=2026-07-31");
  assert.equal(
    m.imageUrl,
    "https://www.faradaydailychallenge.com/api/share/card?game=dark-fiber&n=38&date=2026-07-31"
  );
});

test("legacy ?game=<display name> deep links still get the per-game unfurl", () => {
  const m = dayCardMeta({ game: "Signal Drop" }, REG);
  assert.equal(m.slug, "signal-drop");
  assert.ok(m.imageUrl.endsWith("/api/share/card?game=signal-drop"));
});

test("no params / junk params → generic lobby unfurl, never personal", () => {
  for (const q of [undefined, {}, { g: "mystery" }, { g: "daily-challenge" }, { game: "Nope" }, { g: "rackl", d: "07/31/2026" }]) {
    const m = dayCardMeta(q, REG);
    assert.ok(m.imageUrl.startsWith("https://www.faradaydailychallenge.com/api/share/card?game="));
    for (const banned of ["score", "band", "grid"]) {
      assert.ok(!m.imageUrl.includes(banned), `${banned} leaked for ${JSON.stringify(q)}`);
    }
  }
  const generic = dayCardMeta({}, REG);
  assert.equal(generic.title, "Faraday Daily Challenge");
  assert.equal(generic.pageUrl, "https://www.faradaydailychallenge.com/");
});

test("invalid date is dropped but the game unfurl survives", () => {
  const m = dayCardMeta({ g: "rackl", d: "garbage" }, REG);
  assert.equal(m.slug, "rackl");
  assert.ok(!m.imageUrl.includes("date=") && !m.imageUrl.includes("n="));
});
