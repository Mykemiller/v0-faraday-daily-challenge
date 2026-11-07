// Faraday Predicts home tile (FDY-120, 26-43-v01) — pure logic, no React.
// Run: npm run test:predicts-tile

import { formatDate } from "./predicts.ts";

/** Copy supplied verbatim by FDY-120 (decisions 3-5). Do not edit without Myke. */
export const TILE_COPY = {
  badge: "Scored",
  title: "Faraday Predicts",
  line: "Calls you can hold us to.",
  receiptsLink: "See the receipts →",
  requestCta: "Request access",
  requestNote: "We review every request personally. Nothing is sent until you're approved.",
  success: "Thanks. We'll review your request personally.",
  error: "That didn't go through - try again shortly.",
  forecastsLink: "Open forecasts →",
} as const;

/** The FDY-147 tile copy — what renders when the API fails or is slow. */
export const FALLBACK_COPY = {
  blurb: "Dated, probability-weighted calls on the AI data center buildout — and every one is graded when its date arrives.",
  cta: "Open →",
} as const;

export const RECEIPTS_HREF = "/predicts?view=receipts";
export const FEATURED_TIMEOUT_MS = 3000;
export const CALL_MAX = 200;

export type FeaturedCall = {
  text: string;
  probability: number;
  resolvesBy: string; // "Mon D, YYYY"
  sector: string | null;
};

export type TileData = { featured: FeaturedCall | null; releaseTag: string | null };

/** Cut to <= max chars on a word boundary; the ellipsis is inside the budget. */
export function truncateCall(text: string, max = CALL_MAX): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  const head = t.slice(0, max - 1);
  const space = head.lastIndexOf(" ");
  return `${(space > max * 0.6 ? head.slice(0, space) : head).trimEnd().replace(/[.,;:]+$/, "")}…`;
}

/** "NN% - resolves by Mon D, YYYY" */
export function metaLine(c: FeaturedCall): string {
  return `${c.probability}% - resolves by ${c.resolvesBy}`;
}

/** The three API URLs derive from the one configured predicts-public base. */
export function featuredUrl(apiUrl: string): string {
  return `${apiUrl}?view=featured`;
}
export function requestAccessUrl(apiUrl: string): string {
  return apiUrl.replace(/predicts-public\/?$/, "predicts-request-access");
}

/** Validate the API payload defensively. Anything off -> null (caller falls
 *  back to the FDY-147 copy). A featured call is shown only when it carries a
 *  1-99 integer probability, a real resolves-by date, and text; a missing
 *  Sector hides just the chip. null never renders as 0. */
export function parseTileResponse(json: unknown): TileData | null {
  if (!json || typeof json !== "object") return null;
  const j = json as Record<string, unknown>;
  if (j.ok !== true || j.view !== "featured") return null;
  const releaseTag = typeof j.release_tag === "string" && j.release_tag.trim() ? j.release_tag.trim() : null;
  const f = j.featured;
  let featured: FeaturedCall | null = null;
  if (f && typeof f === "object") {
    const r = f as Record<string, unknown>;
    const p = r.probability_score;
    const resolvesBy = typeof r.target_resolution_date === "string" ? formatDate(r.target_resolution_date) : null;
    if (
      typeof r.prediction_text === "string" && r.prediction_text.trim() &&
      typeof p === "number" && Number.isInteger(p) && p >= 1 && p <= 99 && resolvesBy
    ) {
      featured = {
        text: truncateCall(r.prediction_text),
        probability: p,
        resolvesBy,
        sector: typeof r.sector_name === "string" && r.sector_name.trim() ? r.sector_name.trim() : null,
      };
    }
  }
  return { featured, releaseTag };
}
