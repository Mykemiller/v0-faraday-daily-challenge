import test from "node:test";
import assert from "node:assert/strict";
import { gameRow, resetGameRowSeq } from "../test-factories.js";
import {
  buildShareRegistry,
  EMPTY_SHARE_REGISTRY,
  GENERIC_SLUG,
  GENERIC_ENTRY,
  CANONICAL_ORIGIN,
} from "./manifest.js";

// CC-DC-GAME-REGISTRY-1.0 D10: these tests build their own catalog rows. They
// assert the SHAPE of the manifest, not the identity of the seven launch games —
// naming those here is what let the manifest and the catalog drift apart.

function registryOf(n) {
  resetGameRowSeq();
  const rows = Array.from({ length: n }, () => gameRow());
  return { rows, reg: buildShareRegistry(rows) };
}

test("manifest carries one entry per game plus the generic mark", () => {
  const { rows, reg } = registryOf(3);
  assert.equal(Object.keys(reg.manifest).length, rows.length + 1);
  assert.ok(reg.manifest[GENERIC_SLUG]);
  assert.equal(Object.keys(reg.slugByType).length, rows.length);
});

test("each entry sources its accent from the catalog row, never redefined", () => {
  const rows = [gameRow({ accent_hex: "#123456", route_slug: "alpha", runtime_key: "Alpha" })];
  const reg = buildShareRegistry(rows);
  assert.equal(reg.manifest.alpha.accent, "#123456");
});

test("public id prefix comes from the row; the generic mark has none", () => {
  const reg = buildShareRegistry([
    gameRow({ route_slug: "alpha", runtime_key: "Alpha", public_id_prefix: "ALFA" }),
  ]);
  assert.equal(reg.manifest.alpha.publicIdPrefix, "ALFA");
  assert.equal(reg.manifest[GENERIC_SLUG].publicIdPrefix, null);
});

test("epoch is per game and pinned by the catalog, not derived", () => {
  const reg = buildShareRegistry([
    gameRow({ route_slug: "alpha", runtime_key: "Alpha", share_epoch: "2026-06-24" }),
    gameRow({ route_slug: "bravo", runtime_key: "Bravo", share_epoch: "2027-01-15" }),
  ]);
  assert.equal(reg.manifest.alpha.epoch, "2026-06-24");
  assert.equal(reg.manifest.bravo.epoch, "2027-01-15");
});

test("canonical origin is the www subscriber domain", () => {
  assert.equal(CANONICAL_ORIGIN, "https://www.faradaydailychallenge.com");
});

test("icon paths live under /share/icons/ and match their slug", () => {
  const { reg } = registryOf(3);
  for (const [slug, entry] of Object.entries(reg.manifest)) {
    if (slug === GENERIC_SLUG) continue;
    assert.equal(entry.icon, `/share/icons/${slug}.png`);
  }
});

test("unknown type/slug degrades to the Daily Challenge mark (D7 / AC7)", () => {
  const reg = buildShareRegistry([gameRow({ route_slug: "alpha", runtime_key: "Alpha" })]);
  assert.equal(reg.entryForType("Mystery Game"), GENERIC_ENTRY);
  assert.equal(reg.entryForType(undefined), GENERIC_ENTRY);
  assert.equal(reg.slugForType("Mystery Game"), GENERIC_SLUG);
  assert.equal(reg.iconForSlug("nope"), GENERIC_ENTRY.icon);
  assert.equal(reg.iconForSlug("alpha"), "/share/icons/alpha.png");
});

test("an unreachable catalog degrades to the generic mark, never to stale games", () => {
  assert.equal(Object.keys(EMPTY_SHARE_REGISTRY.slugByType).length, 0);
  assert.equal(EMPTY_SHARE_REGISTRY.entryForType("Anything"), GENERIC_ENTRY);
  assert.equal(EMPTY_SHARE_REGISTRY.isGameType("Anything"), false);
});

test("a row with no route_slug is skipped rather than half-registered", () => {
  const reg = buildShareRegistry([gameRow({ route_slug: null, runtime_key: "Nameless" })]);
  assert.equal(Object.keys(reg.slugByType).length, 0);
  assert.equal(reg.entryForType("Nameless"), GENERIC_ENTRY);
});
