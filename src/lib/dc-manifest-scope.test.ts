// node --test src/lib/dc-manifest-scope.test.ts  (FDY-127 D6)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DC_START_URL, dcManifestScope } from "./dc-manifest-scope.ts";

test("D6: the DC host keeps the whole origin; every other host scopes the game to its start_url", () => {
  assert.equal(dcManifestScope("www.faradaydailychallenge.com"), "/");
  assert.equal(dcManifestScope("FARADAYDAILYCHALLENGE.COM:443"), "/");
  for (const h of ["www.faraday-intelligence.ai", "faraday-intelligence.ai", "www.faraday-player.com", "v0-faraday-daily-challenge-n2u5.vercel.app", "localhost:3000", null, ""]) {
    assert.equal(dcManifestScope(h), DC_START_URL, String(h));
  }
});

test("D6: /predicts is outside the DC scope on the host that serves it, and start_url is always in scope", () => {
  const scope = dcManifestScope("www.faraday-intelligence.ai");
  assert.ok(!"/predicts".startsWith(scope));
  for (const h of ["www.faradaydailychallenge.com", "www.faraday-intelligence.ai"]) assert.ok(DC_START_URL.startsWith(dcManifestScope(h)));
  const src = readFileSync(new URL("../app/manifest.ts", import.meta.url), "utf8");
  assert.match(src, /scope: dcManifestScope\(/);
  assert.match(src, /start_url: "\/daily-challenge"/);
  assert.equal(DC_START_URL, "/daily-challenge");
});
