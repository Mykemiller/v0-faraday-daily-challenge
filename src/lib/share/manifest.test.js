import test from "node:test";
import assert from "node:assert/strict";
import { GAME_ACCENT } from "../game-accent.js";
import {
  SHARE_MANIFEST,
  SLUG_BY_TYPE,
  GENERIC_SLUG,
  SHARE_EPOCH,
  CANONICAL_ORIGIN,
  entryForType,
  slugForType,
  iconForSlug,
} from "./manifest.js";

test("manifest carries exactly 8 entries: 7 games + the generic mark", () => {
  assert.equal(Object.keys(SHARE_MANIFEST).length, 8);
  assert.ok(SHARE_MANIFEST[GENERIC_SLUG]);
  assert.equal(Object.keys(SLUG_BY_TYPE).length, 7);
});

test("every game entry sources its accent from GAME_ACCENT (never redefined)", () => {
  for (const [type, slug] of Object.entries(SLUG_BY_TYPE)) {
    assert.equal(SHARE_MANIFEST[slug].accent, GAME_ACCENT[type].accent, `${type} accent`);
  }
});

test("public id prefixes match the minted TYPE4 set", () => {
  const prefixes = Object.values(SLUG_BY_TYPE).map((s) => SHARE_MANIFEST[s].publicIdPrefix).sort();
  assert.deepEqual(prefixes, ["BRIF", "CIRC", "FIBR", "FREQ", "RACK", "SGNL", "STAK"]);
  assert.equal(SHARE_MANIFEST[GENERIC_SLUG].publicIdPrefix, null);
});

test("every epoch is the pinned 2026-06-24 constant", () => {
  assert.equal(SHARE_EPOCH, "2026-06-24");
  for (const entry of Object.values(SHARE_MANIFEST)) assert.equal(entry.epoch, SHARE_EPOCH);
});

test("canonical origin is the www subscriber domain", () => {
  assert.equal(CANONICAL_ORIGIN, "https://www.faradaydailychallenge.com");
});

test("icon paths live under /share/icons/ and match their slug", () => {
  for (const [slug, entry] of Object.entries(SHARE_MANIFEST)) {
    assert.equal(entry.icon, `/share/icons/${slug}.png`);
  }
});

test("unknown type/slug degrades to the Daily Challenge mark (D7 / AC7)", () => {
  assert.equal(entryForType("Mystery Game"), SHARE_MANIFEST[GENERIC_SLUG]);
  assert.equal(entryForType(undefined), SHARE_MANIFEST[GENERIC_SLUG]);
  assert.equal(slugForType("Mystery Game"), GENERIC_SLUG);
  assert.equal(iconForSlug("nope"), SHARE_MANIFEST[GENERIC_SLUG].icon);
  assert.equal(iconForSlug("rackl"), "/share/icons/rackl.png");
});
