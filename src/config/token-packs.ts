// TOKEN PACKS — MIRROR OF LOCKED CANON (CC-TOS-PRICING-1.0).
//
// ============================================================================
// THESE PRICES ARE HUMAN-APPROVED CANON (CC-05 / FAR-45). DO NOT ALTER THEM.
// No agent may change a value in this file. To change a pack price, a human
// edits the SOURCE OF TRUTH and the mirror is regenerated:
//
//   source : faraday-jurisdiction-watch
//            src/features/jurisdiction-watch/tokenPacks.ts
//   mirror : this file  (regenerate with `npm run sync:token-packs`)
//
// A drift test (`npm run test:pricing`) fails if the two disagree.
// ============================================================================
//
// WHY A MIRROR AND NOT A LITERAL. Before this file existed, the storefront
// homepage carried its own `TOKEN_PACKS` array with "$49" / "$89" / "$799"
// written out as display strings — a second, unguarded copy of a locked price
// in a different repository from the one that charges it. That is exactly the
// drift the CC-TOS-PRICING-1.0 contract exists to eliminate: the day a pack
// price changes in Jurisdiction Watch, this homepage would have kept quoting
// the old number to buyers.
//
// WHY NOT IN `pricing.ts`. `src/config/pricing.ts` carries the SUBSCRIPTION
// TIER contract, whose invariant is "every monetary value is null pending
// Myke". Packs are one-time top-ups whose prices are already set by a human.
// Mixing them would make that invariant false and make the tier scaffold
// untestable. Two files, two contracts.

export type TokenPackKey = "tokens-500" | "tokens-1000" | "tokens-10000";

export interface TokenPack {
  key: TokenPackKey;
  /** Tokens credited to the wallet. */
  tokens: number;
  /** tokens / 100 — the grant unit used by jw_record_stripe_grant. */
  blocks: number;
  /** Headline price in whole US dollars. */
  priceUsd: number;
  /** Stripe unit_amount in cents — the only value ever charged. */
  amountCents: number;
  /** Storefront display label. */
  label: string;
}

/** Mirror of the Jurisdiction Watch canon. Regenerate; never hand-edit. */
export const TOKEN_PACKS: readonly TokenPack[] = [
  { key: "tokens-500", tokens: 500, blocks: 5, priceUsd: 49, amountCents: 4900, label: "500 tokens" },
  { key: "tokens-1000", tokens: 1000, blocks: 10, priceUsd: 89, amountCents: 8900, label: "1,000 tokens" },
  { key: "tokens-10000", tokens: 10000, blocks: 100, priceUsd: 799, amountCents: 79900, label: "10,000 tokens" },
] as const;

export function getTokenPack(key: string | undefined | null): TokenPack | undefined {
  return TOKEN_PACKS.find((p) => p.key === key);
}

/** $/1k tokens — lower is cheaper. Drives the "best value" flag. */
export function pricePerThousand(pack: TokenPack): number {
  return (pack.priceUsd / pack.tokens) * 1000;
}

/** Display price for a pack. Derived, never written out as a literal. */
export function formatPackPrice(pack: TokenPack): string {
  return `$${pack.priceUsd.toLocaleString("en-US")}`;
}

/** Display token count for a pack. */
export function formatPackTokens(pack: TokenPack): string {
  return pack.tokens.toLocaleString("en-US");
}

/** The cheapest pack per 1,000 tokens. */
export function bestValuePackKey(): TokenPackKey {
  return TOKEN_PACKS.reduce((best, p) =>
    pricePerThousand(p) < pricePerThousand(best) ? p : best,
  ).key;
}
