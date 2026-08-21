// ── Behaviour-driven cross-sell teasers — DATA CONTRACT + selection seam ──────
// Shipped OFF behind NEXT_PUBLIC_FARADAY_TEASERS (see TeaserSlot.tsx). This file
// is the seam, not a full engine: selectTeaser() holds a few obvious placeholder
// mappings to be expanded later. No token/price copy belongs here (the lobby
// stays price-free; route commerce to the homepage).

export interface TeaserContext {
  registered: boolean;
  streak: number;
  gamesPlayedToday: string[];
  /** Plain-language domains touched by today's puzzles — never internal D-codes. */
  domainsEngaged: string[];
  lastGame: string | null;
}

export type TeaserSlotName = "scorecard" | "lobby-inline" | "between-games";

export interface Teaser {
  /** Surface to tease, e.g. "Briefing Library", "Jurisdiction Watch". */
  surface: string;
  /** Brand-voiced, value-first. No price/token talk. */
  copy: string;
  /** Where the teaser routes — a homepage surface, not a checkout. */
  href: string;
  slot: TeaserSlotName;
}

// Placeholder rules — intentionally small and obvious. Expand later; keep the
// signature stable so TeaserSlot never needs re-architecting to turn this on.
const TEASER_BY_GAME: Record<string, Teaser> = {
  "The Brief": {
    surface: "Briefing Library",
    copy: "Liked the brief? The Briefing Library is the full archive Faraday reads from.",
    href: "/briefing-library",
    slot: "scorecard",
  },
};

export function selectTeaser(ctx: TeaserContext): Teaser | null {
  // Per-game teasers, keyed on runtime_key (CC-DC-GAME-REGISTRY-1.0 Q5: the
  // copy is editorial and stays in code, but it is a registry lookup rather
  // than a chain of name comparisons — a game with no teaser just falls
  // through to the rules below).
  for (const [game, teaser] of Object.entries(TEASER_BY_GAME)) {
    if (ctx.lastGame === game || ctx.gamesPlayedToday.includes(game)) return teaser;
  }

  // Touched cooling/water content → tease Jurisdiction Watch (permitting/water risk).
  if (ctx.domainsEngaged.some((d) => /cooling|water/i.test(d))) {
    return {
      surface: "Jurisdiction Watch",
      copy: "Cooling and water decide where the buildout lands. Jurisdiction Watch maps where.",
      href: "/jurisdiction-watch",
      slot: "lobby-inline",
    };
  }

  // Warm, returning player → tease the Live Agent (the "try one thing" surface).
  if (ctx.registered && ctx.streak >= 3) {
    return {
      surface: "Live Agent",
      copy: "Readiness building — ask Faraday the question behind today's puzzle, live.",
      href: "/live-agent",
      slot: "between-games",
    };
  }

  return null;
}
