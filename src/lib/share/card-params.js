// CC-DC-SHARE-1.0 Phase 2 — card-route param validation + grid decoding.
// Pure and node-testable; the /api/share/card route is a thin shell over this.
//
// The param grammar was FIXED in Phase 1 (buildShare.js encodeGrid + the card
// URLSearchParams): game, n, date, score, band, grid (+ size, renderer-only).
// Everything here is fail-soft: an invalid piece is dropped (the card renders
// without that zone), an unknown game falls back to the Daily Challenge mark
// (D7/AC7) — a share link is never a 500 and never a broken image.
//
// Spoiler posture (D5): these params carry outcome SHAPE only. The decoder
// accepts nothing but the closed per-game grammars below, so answer content
// cannot be smuggled into the renderer through the URL.

import { EMPTY_SHARE_REGISTRY, GENERIC_SLUG } from "./manifest.js";

export const CARD_SIZES = {
  og: { width: 1200, height: 630 }, // link unfurls (Open Graph)
  square: { width: 1080, height: 1080 }, // messaging apps
};

const DATE_RE = /^20\d{2}-\d{2}-\d{2}$/;
const SIGNAL_GRID_RE = /^[cpae]{1,10}(-[cpae]{1,10}){0,5}$/; // ≤6 rows, ≤10 cols
const OK_GRID_RE = /^[ox]{1,20}$/;
const RACKL_GRID_RE = /^s([0-4])m([0-4])$/;
const FIBER_GRID_RE = /^p(\d{1,2})m(\d{1,2})$/;

const ROW_STATE_BY_CHAR = { c: "correct", p: "partial", a: "miss", e: "miss" };

/**
 * Decode a Phase-1 `grid` param into render rows.
 * Returns { rows: Array<Array<"correct"|"partial"|"miss">> } or null.
 * Counts-only encodings (rackl/dark-fiber) become a single row of pips.
 */
export function decodeGrid(slug, grid) {
  if (typeof grid !== "string" || !grid) return null;
  if (slug === "signal-drop") {
    if (!SIGNAL_GRID_RE.test(grid)) return null;
    return { rows: grid.split("-").map((r) => [...r].map((ch) => ROW_STATE_BY_CHAR[ch])) };
  }
  if (slug === "rackl") {
    const m = RACKL_GRID_RE.exec(grid);
    if (!m) return null;
    const solved = Number(m[1]);
    const mistakes = Number(m[2]);
    const row = [...Array(solved).fill("correct"), ...Array(mistakes).fill("miss")];
    return row.length ? { rows: [row] } : null;
  }
  if (slug === "dark-fiber") {
    const m = FIBER_GRID_RE.exec(grid);
    if (!m) return null;
    const pairs = Number(m[1]);
    const mistakes = Number(m[2]);
    if (pairs > 12 || mistakes > 20) return null;
    const row = [...Array(pairs).fill("correct"), ...Array(mistakes).fill("miss")];
    return row.length ? { rows: [row] } : null;
  }
  if (!OK_GRID_RE.test(grid)) return null;
  return { rows: [[...grid].map((ch) => (ch === "o" ? "correct" : "miss"))] };
}

/**
 * Validate the full card query. Never throws; every invalid piece degrades to
 * its absence. Returns:
 * { slug, entry, size:{width,height,key}, n, date, score, band, grid }
 *
 * @param {{ get: (k: string) => string | null }} searchParams
 * @param {ReturnType<import("./manifest.js").buildShareRegistry>} [shareRegistry]
 */
export function parseCardParams(searchParams, shareRegistry = EMPTY_SHARE_REGISTRY) {
  const reg = shareRegistry || EMPTY_SHARE_REGISTRY;
  const get = (k) => {
    const v = searchParams && typeof searchParams.get === "function" ? searchParams.get(k) : null;
    return typeof v === "string" ? v : null;
  };

  const rawGame = get("game");
  const slug = rawGame && reg.manifest[rawGame] ? rawGame : GENERIC_SLUG;
  const entry = reg.manifest[slug];

  const sizeKey = get("size") === "square" ? "square" : "og";

  const nRaw = get("n");
  const n = nRaw && /^\d{1,5}$/.test(nRaw) ? Number(nRaw) : null;

  const dateRaw = get("date");
  const date = dateRaw && DATE_RE.test(dateRaw) ? dateRaw : null;

  const scoreRaw = get("score");
  const score = scoreRaw && /^\d{1,5}$/.test(scoreRaw) ? Number(scoreRaw) : null;

  const bandRaw = get("band");
  const band = bandRaw ? bandRaw.replace(/\s+/g, " ").trim().slice(0, 40) || null : null;

  const grid = slug === GENERIC_SLUG ? null : decodeGrid(slug, get("grid"));

  return { slug, entry, size: { ...CARD_SIZES[sizeKey], key: sizeKey }, n, date, score, band, grid };
}

/**
 * Fine-print line: the Public ID prefix + the serve date's YY-MM-DD segment
 * (the full NNNNN counter is deliberately not a card param — Phase 0 D2 keeps
 * it out of the headline; the prefix+date segment is enough provenance).
 * null when either piece is missing (generic cards carry no fine print).
 */
export function finePrint(entry, date) {
  if (!entry || !entry.publicIdPrefix || !date || !DATE_RE.test(date)) return null;
  return `${entry.publicIdPrefix}-${date.slice(2)}`;
}
