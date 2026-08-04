// FARADAY PRICING — SINGLE SOURCE OF TRUTH (CC-TOS-PRICING-1.0).
//
// ============================================================================
// PRICING IS AN ALWAYS-HUMAN CARVE-OUT (P-004).
//
// No agent, script, or automation may set, change, infer, derive, or publish a
// monetary value in this file. Every `amountCents` and every `stripePriceId`
// below is `null` and carries a `TODO(myke)` marker. They stay null until Myke
// fills them in by hand.
//
// This file defines the SHAPE and the CONTRACT. It does not define prices.
// ============================================================================
//
// WHY THIS FILE EXISTS. Prices were previously implicit: each storefront would
// have grown its own literals in its own pricing page, and the day a tier price
// changed, some surface would have kept the old number. Every pricing surface in
// every Faraday repository now imports from this module, and `npm run
// test:pricing` fails the build if a price literal reappears in a page.
//
// TIER STRUCTURE IS LOCKED: Free -> Signal -> Core -> Premier. Do not rename a
// tier, do not add a tier, do not reorder them. Faraday Academy runs on a
// SEPARATE pricing model (see ACADEMY_PRICING at the bottom) and is deliberately
// not expressed as one of these tiers.
//
// CROSS-REPO SYNC. This file is canonical here (the repository that serves
// faraday-intelligence.ai). Storefronts in other repositories carry a generated
// mirror produced by `npm run sync:pricing`, guarded by a drift test. Edit this
// file, then re-run the sync in each storefront repo. Never hand-edit a mirror.
//
// WHAT THIS FILE DOES NOT COVER — deliberately:
//   * Jurisdiction Watch TOKEN PACKS. Those are one-time top-ups, not tiers,
//     and their values are LOCKED CANON already approved by a human. They live
//     in the Jurisdiction Watch repository at
//     `src/features/jurisdiction-watch/tokenPacks.ts`, which is their single
//     source of truth. They are NOT restated here, because restating a locked
//     human-approved price in a second file is exactly the drift this module
//     exists to prevent — and because this file's contract is "every monetary
//     value is null", which would be false the moment a real pack price
//     appeared in it.
//   * Live Agent per-answer token costs and plan grants, which live in the
//     `live_agent_plan` database table (provisional, server-side).

/** Locked tier ladder. Order is meaningful: it is the upgrade path. */
export const TIER_IDS = ["free", "signal", "core", "premier"] as const;
export type TierId = (typeof TIER_IDS)[number];

/** Locked billing intervals. */
export const BILLING_INTERVALS = ["monthly", "annual"] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

export interface TierPrice {
  interval: BillingInterval;
  /**
   * Price in the smallest currency unit (US cents), or `null` when unset.
   * NEVER a float, never a display string — formatting is a UI concern.
   */
  amountCents: number | null;
  currency: "usd";
  /** Stripe Price object id (`price_...`), or `null` when unset. */
  stripePriceId: string | null;
  /**
   * `true` once a human has confirmed BOTH the amount and the Stripe price id
   * for this interval. A pricing surface must not offer an interval that is not
   * confirmed, and checkout must refuse it.
   */
  confirmed: boolean;
}

export interface Tier {
  id: TierId;
  /** Subscriber-facing tier name. LOCKED — do not rename. */
  name: string;
  /** One sentence on who the tier is for. Marketing copy, not a price. */
  description: string;
  /** Feature list rendered on the pricing surface. Never contains a price. */
  features: string[];
  /** Position on the ladder, ascending. */
  order: number;
  /**
   * `true` for a tier that is never charged for. A free tier still carries the
   * full price shape so surfaces can iterate tiers uniformly.
   */
  free: boolean;
  prices: Record<BillingInterval, TierPrice>;
}

/** Every monetary field starts null. See the always-human carve-out above. */
function unpriced(interval: BillingInterval): TierPrice {
  return {
    interval,
    // TODO(myke): set the price in US cents (e.g. 4900 for $49.00). Always-human.
    amountCents: null,
    currency: "usd",
    // TODO(myke): paste the Stripe Price id (price_...) for this tier + interval.
    stripePriceId: null,
    // TODO(myke): flip to true only after BOTH values above are set and checked
    // against the live Stripe dashboard.
    confirmed: false,
  };
}

function unpricedIntervals(): Record<BillingInterval, TierPrice> {
  return { monthly: unpriced("monthly"), annual: unpriced("annual") };
}

export const TIERS: Record<TierId, Tier> = {
  free: {
    id: "free",
    name: "Free",
    description:
      "Open access to the Daily Challenge and to public marketing surfaces. No card required.",
    features: [
      "Faraday Daily Challenge — all games, every day",
      "Leaderboards, teams, and seasons",
      "Public jurisdiction map at summary level",
      "Earned Faraday tokens are spendable",
    ],
    order: 0,
    free: true,
    prices: unpricedIntervals(),
  },
  signal: {
    id: "signal",
    name: "Signal",
    description: "For individuals tracking one or two markets and wanting the daily read.",
    features: [
      "Everything in Free",
      "Jurisdiction Watch posture detail on unlocked jurisdictions",
      "Briefing Library access with a monthly token allowance",
      "Signal Room — saved configurations and alerts",
    ],
    order: 1,
    free: false,
    prices: unpricedIntervals(),
  },
  core: {
    id: "core",
    name: "Core",
    description:
      "For practitioners working sites and dockets week to week across multiple markets.",
    features: [
      "Everything in Signal",
      "Higher monthly token allowance",
      "Full attribute and confidence detail on unlocked jurisdictions",
      "Faraday Intelligent Alert",
      "Live Agent — grounded Q&A over the Faraday corpus",
    ],
    order: 2,
    free: false,
    prices: unpricedIntervals(),
  },
  premier: {
    id: "premier",
    name: "Premier",
    description: "For institutional buyers who need coverage breadth and priority support.",
    features: [
      "Everything in Core",
      "Highest monthly token allowance",
      "Priority review of correction requests",
      "Named-seat licence with a documented path to team seats",
    ],
    order: 3,
    free: false,
    prices: unpricedIntervals(),
  },
};

/** Tiers in ladder order — the order every pricing surface must render. */
export const TIER_LIST: Tier[] = TIER_IDS.map((id) => TIERS[id]);

export function getTier(id: TierId): Tier {
  return TIERS[id];
}

export function getPrice(id: TierId, interval: BillingInterval): TierPrice {
  return TIERS[id].prices[interval];
}

/** A price is offerable only when a human has confirmed both of its values. */
export function isOfferable(price: TierPrice): boolean {
  return price.confirmed && price.amountCents !== null && price.stripePriceId !== null;
}

/** True when a paid tier can be sold at all. Free tiers are always available. */
export function isTierPurchasable(id: TierId): boolean {
  const tier = TIERS[id];
  if (tier.free) return false;
  return BILLING_INTERVALS.some((i) => isOfferable(tier.prices[i]));
}

/** True once every paid tier/interval carries confirmed values. */
export const PRICING_READY: boolean = TIER_LIST.filter((t) => !t.free).every((t) =>
  BILLING_INTERVALS.every((i) => isOfferable(t.prices[i])),
);

/**
 * Resolve the Stripe Price id for checkout. THROWS when the price is not
 * confirmed — a checkout must fail loudly rather than fall back to a guess, an
 * env var, or a client-supplied amount.
 */
export function requireStripePriceId(id: TierId, interval: BillingInterval): string {
  const price = getPrice(id, interval);
  if (!isOfferable(price) || !price.stripePriceId) {
    throw new Error(
      `pricing_not_configured: ${id}/${interval} has no confirmed Stripe price. ` +
        `Set amountCents, stripePriceId and confirmed in src/config/pricing.ts (always-human).`,
    );
  }
  return price.stripePriceId;
}

/**
 * Format an amount for display. Returns the placeholder for unset prices so a
 * surface renders "Pricing to be announced" rather than "$NaN" or "$0".
 */
export const PRICE_TBA = "Pricing to be announced";

export function formatAmount(amountCents: number | null, currency: "usd" = "usd"): string {
  if (amountCents === null) return PRICE_TBA;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: amountCents % 100 === 0 ? 0 : 2,
  }).format(amountCents / 100);
}

export function formatTierPrice(id: TierId, interval: BillingInterval): string {
  const tier = TIERS[id];
  if (tier.free) return "Free";
  const price = tier.prices[interval];
  if (!isOfferable(price)) return PRICE_TBA;
  return `${formatAmount(price.amountCents, price.currency)}/${interval === "monthly" ? "mo" : "yr"}`;
}

// ---------------------------------------------------------------------------
// Faraday Academy — SEPARATE PRICING MODEL.
//
// Academy is not a tier on the ladder above and must never be folded into one.
// It sells course and cohort enrolments, which are one-time purchases with their
// own refund policy (Schedule FA, FA-4 — still open, pending counsel).
// ---------------------------------------------------------------------------

export type AcademyProductKind = "course" | "bundle" | "cohort";

export interface AcademyProduct {
  id: string;
  name: string;
  kind: AcademyProductKind;
  description: string;
  /** Price in US cents, or null when unset. */
  amountCents: number | null;
  currency: "usd";
  stripePriceId: string | null;
  confirmed: boolean;
  /**
   * Whether completing this product grants Faraday tokens. The grant is an
   * unhedged redemption liability — see Schedule FA (FA-6) and Schedule BL
   * (BL-4). Leave the count null until counsel resolves the token expiry
   * question; do not invent one.
   */
  grantsTokens: boolean;
  // TODO(myke + counsel): token grant size, and whether it is capped. Blocked on
  // the BL-4 / FA-6 expiry and forfeiture decision.
  tokenGrant: number | null;
}

export const ACADEMY_PRODUCTS: AcademyProduct[] = [
  {
    id: "academy-catalog-placeholder",
    name: "Faraday Academy — catalogue",
    kind: "course",
    description:
      "Placeholder for the Academy catalogue. Courses are authored in LearnWorlds; this array is the pricing contract they must be entered against.",
    // TODO(myke): Academy course pricing in US cents. Always-human.
    amountCents: null,
    currency: "usd",
    // TODO(myke): Stripe Price id for this Academy product.
    stripePriceId: null,
    // TODO(myke): flip to true once amount and Stripe id are both set.
    confirmed: false,
    grantsTokens: false,
    tokenGrant: null,
  },
];

export const ACADEMY_PRICING = {
  /** Academy never renews on the tier ladder's intervals. */
  model: "one-time-purchase" as const,
  products: ACADEMY_PRODUCTS,
  /**
   * TODO(myke + counsel): the Academy refund window. Schedule FA, FA-4 lists
   * exactly what has to be decided. Left null so no surface can publish a
   * refund promise that counsel has not approved.
   */
  refundWindowDays: null as number | null,
};

export const ACADEMY_PRICING_READY: boolean = ACADEMY_PRODUCTS.every(
  (p) => p.confirmed && p.amountCents !== null && p.stripePriceId !== null,
);
