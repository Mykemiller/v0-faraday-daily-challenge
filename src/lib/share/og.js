// CC-DC-SHARE-1.0 Phase 4 (D9) — unfurl metadata for the lobby + game links.
//
// Link previews use the SAME /api/share/card renderer as shares, so a pasted
// link and a shared card look like one product. Day-scoped and NEVER personal:
// this helper only ever emits game/n/date params — no score, band, or grid.
// Pure and node-testable; /challenge's generateMetadata is a thin shell.

import {
  CANONICAL_ORIGIN,
  GENERIC_SLUG,
  EMPTY_SHARE_REGISTRY,
} from "./manifest.js";
import { puzzleNumberFromDate } from "./buildShare.js";

const DATE_RE = /^20\d{2}-\d{2}-\d{2}$/;

/**
 * Resolve unfurl metadata from a challenge URL's query params.
 * @param {{ g?: string, game?: string, d?: string }} [q]  raw query params —
 *   `g` is the D6 share slug, `game` the legacy display-name deep link, `d`
 *   the serve date. Anything invalid degrades to the generic lobby unfurl.
 * @param {object} [shareRegistry]  from buildShareRegistry(games)
 * @returns {{ slug: string, title: string, description: string, pageUrl: string, imageUrl: string }}
 */
export function dayCardMeta(q, shareRegistry = EMPTY_SHARE_REGISTRY) {
  const src = q && typeof q === "object" ? q : {};
  const reg = shareRegistry || EMPTY_SHARE_REGISTRY;
  const bySlug =
    typeof src.g === "string" && src.g !== GENERIC_SLUG && reg.manifest[src.g] ? src.g : null;
  const byType = typeof src.game === "string" ? reg.slugByType[src.game] || null : null;
  const slug = bySlug || byType; // null → generic lobby unfurl
  const entry = reg.manifest[slug || GENERIC_SLUG];
  // D9 (CC-DC-GAME-REGISTRY-1.0): the count comes from the registry, never a
  // literal "seven" — an eighth game must not make the unfurl copy a lie.
  const gameCount = Object.keys(reg.slugByType).length;
  const games = gameCount === 1 ? "game" : "games";

  const date = typeof src.d === "string" && DATE_RE.test(src.d) ? src.d : null;
  const n = slug && date ? puzzleNumberFromDate(date, entry.epoch) : null;

  const card = new URLSearchParams();
  card.set("game", slug || GENERIC_SLUG);
  if (n !== null) card.set("n", String(n));
  if (date) card.set("date", date);

  const page = new URLSearchParams();
  if (slug) page.set("g", slug);
  if (slug && date) page.set("d", date);
  const pageQs = page.toString();

  return {
    slug: slug || GENERIC_SLUG,
    title: slug ? `${entry.displayName} · Faraday Daily Challenge` : "Faraday Daily Challenge",
    description: slug
      ? `Today's ${entry.displayName}${n !== null ? ` #${n}` : ""} — one of ${gameCount} daily intelligence ${games} on the AI data center economy.`
      : `${gameCount} daily intelligence ${games} on the AI data center economy.`,
    pageUrl: `${CANONICAL_ORIGIN}/${pageQs ? `?${pageQs}` : ""}`,
    imageUrl: `${CANONICAL_ORIGIN}/api/share/card?${card.toString()}`,
  };
}
