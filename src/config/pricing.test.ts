// Pricing contract guard (CC-TOS-PRICING-1.0).
//
// Two jobs:
//   1. Hold the always-human carve-out (P-004): every tier amount and every
//      Stripe price id stays null until a human sets it. When Myke fills them
//      in, the "still null" assertions below are EXPECTED to fail — that is the
//      signal to flip them to positive assertions, not to delete them.
//   2. Prove no pricing surface carries a hardcoded price literal.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  TIER_IDS,
  TIER_LIST,
  BILLING_INTERVALS,
  PRICING_READY,
  ACADEMY_PRODUCTS,
  ACADEMY_PRICING,
  ACADEMY_PRICING_READY,
  isOfferable,
  isTierPurchasable,
  requireStripePriceId,
  formatAmount,
  formatTierPrice,
  PRICE_TBA,
} from "./pricing.ts";
import { TOKEN_PACKS } from "./token-packs.ts";

// ── The locked ladder ───────────────────────────────────────────────────────

test("tier ladder is exactly Free -> Signal -> Core -> Premier, in order", () => {
  assert.deepEqual([...TIER_IDS], ["free", "signal", "core", "premier"]);
  assert.deepEqual(TIER_LIST.map((t) => t.name), ["Free", "Signal", "Core", "Premier"]);
  assert.deepEqual(TIER_LIST.map((t) => t.order), [0, 1, 2, 3]);
});

test("billing intervals are monthly and annual", () => {
  assert.deepEqual([...BILLING_INTERVALS], ["monthly", "annual"]);
});

test("every tier carries the full shape a pricing surface needs", () => {
  for (const tier of TIER_LIST) {
    assert.ok(tier.description.length > 0, `${tier.id} needs a description`);
    assert.ok(tier.features.length > 0, `${tier.id} needs a feature list`);
    for (const interval of BILLING_INTERVALS) {
      const price = tier.prices[interval];
      assert.equal(price.interval, interval);
      assert.equal(price.currency, "usd");
    }
  }
});

// ── The always-human carve-out ──────────────────────────────────────────────

test("P-004: every tier amount is null (no agent may set a price)", () => {
  for (const tier of TIER_LIST) {
    for (const interval of BILLING_INTERVALS) {
      assert.equal(
        tier.prices[interval].amountCents,
        null,
        `${tier.id}/${interval} carries a price. Prices are always-human — if Myke set this ` +
          `deliberately, update this test to assert the confirmed value instead of deleting it.`,
      );
    }
  }
});

test("P-004: every Stripe price id is null", () => {
  for (const tier of TIER_LIST) {
    for (const interval of BILLING_INTERVALS) {
      assert.equal(tier.prices[interval].stripePriceId, null, `${tier.id}/${interval}`);
    }
  }
});

test("P-004: nothing is marked confirmed yet, so nothing is offerable", () => {
  for (const tier of TIER_LIST) {
    for (const interval of BILLING_INTERVALS) {
      assert.equal(isOfferable(tier.prices[interval]), false);
    }
    assert.equal(isTierPurchasable(tier.id), false);
  }
  assert.equal(PRICING_READY, false);
});

test("every monetary TODO is explicitly marked for Myke", () => {
  const src = readFileSync(join(process.cwd(), "src/config/pricing.ts"), "utf8");
  const todos = src.match(/TODO\(myke[^)]*\)/g) ?? [];
  assert.ok(todos.length >= 6, `expected TODO(myke) markers on every unset value, found ${todos.length}`);
});

// ── Checkout must fail loudly, never guess ──────────────────────────────────

test("requireStripePriceId throws while a price is unconfigured", () => {
  assert.throws(() => requireStripePriceId("core", "monthly"), /pricing_not_configured/);
});

test("unset prices render as a placeholder, never $0 or NaN", () => {
  assert.equal(formatAmount(null), PRICE_TBA);
  assert.equal(formatTierPrice("core", "monthly"), PRICE_TBA);
  assert.equal(formatTierPrice("free", "monthly"), "Free");
});

test("formatAmount renders confirmed cents correctly when they eventually exist", () => {
  assert.equal(formatAmount(4900), "$49");
  assert.equal(formatAmount(79900), "$799");
  assert.equal(formatAmount(4999), "$49.99");
});

// ── Academy is a separate model ─────────────────────────────────────────────

test("Academy pricing is separate from the tier ladder and equally unset", () => {
  assert.equal(ACADEMY_PRICING.model, "one-time-purchase");
  assert.equal(ACADEMY_PRICING.refundWindowDays, null, "refund window is open pending counsel (FA-4)");
  assert.equal(ACADEMY_PRICING_READY, false);
  for (const p of ACADEMY_PRODUCTS) {
    assert.equal(p.amountCents, null, `${p.id} carries a price`);
    assert.equal(p.stripePriceId, null, `${p.id} carries a Stripe id`);
    assert.equal(p.tokenGrant, null, `${p.id} token grant is blocked on BL-4/FA-6`);
  }
});

test("no Academy product is expressed as a subscription tier", () => {
  const tierNames = new Set(TIER_LIST.map((t) => t.name.toLowerCase()));
  for (const p of ACADEMY_PRODUCTS) {
    assert.equal(tierNames.has(p.name.toLowerCase()), false);
  }
});

// ── Token packs: locked canon, mirrored not re-typed ────────────────────────

test("token pack canon is intact (locked — never alter these values)", () => {
  assert.deepEqual(
    TOKEN_PACKS.map((p) => [p.tokens, p.priceUsd, p.amountCents, p.blocks]),
    [
      [500, 49, 4900, 5],
      [1000, 89, 8900, 10],
      [10000, 799, 79900, 100],
    ],
  );
});

test("every pack's amountCents is exactly priceUsd * 100, and blocks are tokens/100", () => {
  for (const p of TOKEN_PACKS) {
    assert.equal(p.amountCents, p.priceUsd * 100, `${p.key} amountCents must match priceUsd`);
    assert.equal(p.blocks, p.tokens / 100, `${p.key} blocks must be tokens/100`);
  }
});

// ── No hardcoded prices in any surface ──────────────────────────────────────

/** Walk a directory tree, returning repo-relative file paths. */
function walk(dir: string, out: string[] = []): string[] {
  const abs = join(process.cwd(), dir);
  for (const name of readdirSync(abs)) {
    const rel = join(dir, name);
    if (statSync(join(process.cwd(), rel)).isDirectory()) walk(rel, out);
    else if (/\.(tsx?|jsx?|mjs)$/.test(name) && !/\.test\./.test(name)) out.push(rel);
  }
  return out;
}

// The ONLY files permitted to contain a monetary literal. Both are pricing
// sources of truth, both are guarded by the tests above.
const PRICE_SOURCES = new Set(["src/config/pricing.ts", "src/config/token-packs.ts"]);

test("no pricing surface hardcodes a dollar amount", () => {
  const offenders: string[] = [];
  // A currency literal: $49, $1,299, $49.99 — but not `${...}` template syntax
  // and not a regex capture group like $1.
  const CURRENCY = /\$\s?\d[\d,]*(\.\d{2})?\b/;

  for (const file of [...walk("src/app"), ...walk("src/components")]) {
    const rel = relative(".", file);
    if (PRICE_SOURCES.has(rel)) continue;
    const src = readFileSync(join(process.cwd(), file), "utf8");
    for (const [i, line] of src.split("\n").entries()) {
      // Comment lines are prose, not a published price — the note explaining
      // why the literals were removed necessarily quotes them.
      if (/^\s*(\/\/|\*|\/\*|\{\s*\/\*)/.test(line)) continue;
      // Skip template-literal interpolation and regex backreferences.
      const stripped = line.replace(/\$\{[^}]*\}/g, "").replace(/\\?\$\d(?![\d,.])/g, "");
      if (CURRENCY.test(stripped)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "hardcoded price literal(s) found. Import from src/config/pricing.ts (tiers) or " +
      "src/config/token-packs.ts (packs) instead:\n" + offenders.join("\n"),
  );
});

test("no surface hardcodes a Stripe price id", () => {
  const offenders: string[] = [];
  for (const file of [...walk("src/app"), ...walk("src/components"), ...walk("src/lib")]) {
    const rel = relative(".", file);
    if (PRICE_SOURCES.has(rel)) continue;
    const src = readFileSync(join(process.cwd(), file), "utf8");
    if (/["'`]price_[A-Za-z0-9]{6,}/.test(src)) offenders.push(rel);
  }
  assert.deepEqual(offenders, [], "Stripe price ids must come from src/config/pricing.ts");
});
