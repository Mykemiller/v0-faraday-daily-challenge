import test from "node:test";
import assert from "node:assert/strict";
import { dayCardMeta } from "./og.js";

test("game slug + date → day-scoped per-game unfurl with #number", () => {
  const m = dayCardMeta({ g: "dark-fiber", d: "2026-07-31" });
  assert.equal(m.title, "Dark Fiber · Faraday Daily Challenge");
  assert.ok(m.description.includes("#38"));
  assert.equal(m.pageUrl, "https://www.faradaydailychallenge.com/?g=dark-fiber&d=2026-07-31");
  assert.equal(
    m.imageUrl,
    "https://www.faradaydailychallenge.com/api/share/card?game=dark-fiber&n=38&date=2026-07-31"
  );
});

test("legacy ?game=<display name> deep links still get the per-game unfurl", () => {
  const m = dayCardMeta({ game: "Signal Drop" });
  assert.equal(m.slug, "signal-drop");
  assert.ok(m.imageUrl.endsWith("/api/share/card?game=signal-drop"));
});

test("no params / junk params → generic lobby unfurl, never personal", () => {
  for (const q of [undefined, {}, { g: "mystery" }, { g: "daily-challenge" }, { game: "Nope" }, { g: "rackl", d: "07/31/2026" }]) {
    const m = dayCardMeta(q);
    assert.ok(m.imageUrl.startsWith("https://www.faradaydailychallenge.com/api/share/card?game="));
    for (const banned of ["score", "band", "grid"]) {
      assert.ok(!m.imageUrl.includes(banned), `${banned} leaked for ${JSON.stringify(q)}`);
    }
  }
  const generic = dayCardMeta({});
  assert.equal(generic.title, "Faraday Daily Challenge");
  assert.equal(generic.pageUrl, "https://www.faradaydailychallenge.com/");
});

test("invalid date is dropped but the game unfurl survives", () => {
  const m = dayCardMeta({ g: "rackl", d: "garbage" });
  assert.equal(m.slug, "rackl");
  assert.ok(!m.imageUrl.includes("date=") && !m.imageUrl.includes("n="));
});
