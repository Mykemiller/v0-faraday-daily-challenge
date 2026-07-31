// CC-DC-SHARE-1.0 — buildShare: the ONE payload builder every share surface
// calls (D4). Pure, dependency-free, node-testable. Returns the dual payload
// (D1): a canonical text block (the guaranteed path) plus the image references
// the ShareButton attaches where the platform supports files.
//
// ── Spoiler safety (D5) is BY CONSTRUCTION, not by caller discipline ─────────
// This module must never receive the answer, so it is built so it *can't* use
// one even if a caller passes it:
//   • Inputs are read by an explicit whitelist — unknown keys (word, answers,
//     puzzleName, pairs, …) are simply never read.
//   • The game's display name always comes from the manifest via puzzleType —
//     free-text names are not accepted (Signal Drop's puzzleName IS the answer
//     post-completion; see the Phase 0 audit §4).
//   • The result visualization is an OUTCOME SHAPE: enum states / booleans /
//     small counts. Values outside those domains are dropped, so answer content
//     cannot ride through the outcome object.
//   • publicId must match the strict TYPE4-YY-MM-DD-NNNNN grammar before it is
//     used anywhere, so arbitrary text can't be smuggled through it.
// The AC-3 spoiler test in buildShare.test.js asserts all of this.

import {
  CANONICAL_ORIGIN,
  CANONICAL_HOST,
  GENERIC_SLUG,
  SHARE_MANIFEST,
  SLUG_BY_TYPE,
  slugForType,
} from "./manifest.js";

// Approved glyph vocabulary (Myke, 2026-07-31): one set across all 7 games so a
// subscriber's shares read as one product.
export const GLYPH = { correct: "🟩", partial: "🟨", miss: "⬛" };

export const SIGNAL_MAX_ROWS = 6; // Signal Drop guess cap — never render more rows

// Strict Public ID grammar: TYPE4-YY-MM-DD-NNNNN (e.g. SGNL-26-07-30-00352).
const PUBLIC_ID_RE = /^[A-Z]{4}-(\d{2})-(\d{2})-(\d{2})-\d{5}$/;

const DAY_MS = 24 * 60 * 60 * 1000;

/** "TYPE4-YY-MM-DD-NNNNN" → "20YY-MM-DD", or null when it doesn't parse. */
export function puzzleDateFromPublicId(publicId) {
  if (typeof publicId !== "string") return null;
  const m = PUBLIC_ID_RE.exec(publicId.trim());
  if (!m) return null;
  const [, yy, mm, dd] = m;
  const iso = `20${yy}-${mm}-${dd}`;
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  // Round-trip guard: rejects impossible dates like 20YY-13-40.
  if (new Date(t).toISOString().slice(0, 10) !== iso) return null;
  return iso;
}

/**
 * D2 puzzle number: days_between(epoch, date) + 1, computed in UTC.
 * null when the date is missing/invalid or precedes the epoch.
 */
export function puzzleNumberFromDate(dateStr, epoch) {
  if (typeof dateStr !== "string" || typeof epoch !== "string") return null;
  const d = Date.parse(`${dateStr}T00:00:00Z`);
  const e = Date.parse(`${epoch}T00:00:00Z`);
  if (Number.isNaN(d) || Number.isNaN(e) || d < e) return null;
  return Math.round((d - e) / DAY_MS) + 1;
}

/** 134.2 → "2:14". null for anything unusable. */
export function formatElapsed(sec) {
  if (typeof sec !== "number" || !Number.isFinite(sec) || sec < 0) return null;
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// ── Outcome shapes → glyph lines ─────────────────────────────────────────────
// Each game's outcome is the minimal honest encoding of the result (Phase 0 §4;
// reduced blocks for Rackl / Dark Fiber accepted by Myke 2026-07-31):
//   signal-drop  { rows: [["correct"|"present"|"absent"|"empty", …], …] }
//   the-stack | circuit | the-brief | frequency   { ok: [boolean, …] }
//   rackl        { solved: 0–4 groups, mistakes: 0–4 }
//   dark-fiber   { pairs: 0–12, mistakes: 0–20 }
// Anything malformed → [] (text-only share, never a throw — AC 7).

const ROW_STATE = { correct: GLYPH.correct, present: GLYPH.partial, absent: GLYPH.miss, empty: GLYPH.miss };

function clampCount(v, max) {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) return null;
  return Math.min(v, max);
}

/** Outcome shape → array of glyph strings (one per line). [] when unusable. */
export function glyphLines(slug, outcome) {
  if (!outcome || typeof outcome !== "object") return [];
  try {
    if (slug === "signal-drop") {
      const rows = Array.isArray(outcome.rows) ? outcome.rows.slice(0, SIGNAL_MAX_ROWS) : [];
      const lines = rows
        .filter((r) => Array.isArray(r) && r.length > 0 && r.every((s) => s in ROW_STATE))
        .map((r) => r.map((s) => ROW_STATE[s]).join(""));
      return lines.length === rows.length ? lines : []; // any bad row → no grid
    }
    if (slug === "rackl") {
      const solved = clampCount(outcome.solved, 4);
      const mistakes = clampCount(outcome.mistakes, 4);
      if (solved === null || mistakes === null) return [];
      const parts = [GLYPH.correct.repeat(solved), GLYPH.miss.repeat(mistakes)].filter(Boolean);
      return parts.length ? [parts.join(" ")] : [];
    }
    if (slug === "dark-fiber") {
      const pairs = clampCount(outcome.pairs, 12);
      const mistakes = clampCount(outcome.mistakes, 20);
      if (pairs === null || mistakes === null) return [];
      const parts = [GLYPH.correct.repeat(pairs), GLYPH.miss.repeat(mistakes)].filter(Boolean);
      return parts.length ? [parts.join(" ")] : [];
    }
    // the-stack, circuit, the-brief, frequency — per-position/question marks.
    const ok = Array.isArray(outcome.ok) ? outcome.ok : null;
    if (!ok || ok.length === 0 || ok.length > 20 || !ok.every((b) => typeof b === "boolean")) return [];
    return [ok.map((b) => (b ? GLYPH.correct : GLYPH.miss)).join("")];
  } catch {
    return [];
  }
}

// ── Sanitizers ───────────────────────────────────────────────────────────────

/** utm_medium / surface tag: lowercased, [a-z0-9-] only, non-empty. */
function sanitizeSurface(surface) {
  const s = String(surface || "").toLowerCase().replace(/[^a-z0-9-]/g, "");
  return s || "unknown";
}

/** Display text lines (band label, generic headline/detail): single line, capped. */
function sanitizeLine(v, max = 80) {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim().slice(0, max);
  return s || null;
}

function sanitizeScore(v) {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 99999 ? v : null;
}

// ── The builder (D4) ─────────────────────────────────────────────────────────

/**
 * Build the share payload for any surface. Reads ONLY the keys below — any
 * other key on the input object is ignored by construction (D5).
 *
 * @param {object} input
 * @param {"game"|"generic"} [input.kind]   defaults to "game" when puzzleType maps to a game, else generic
 * @param {string}  input.surface           utm_medium tag, e.g. "scorecard", "leaderboard"
 * @param {string}  [input.puzzleType]      runtime game key ("Signal Drop") — display name comes from the manifest
 * @param {string}  [input.publicId]        strict TYPE4-YY-MM-DD-NNNNN; drives #number, date, fine print
 * @param {number}  [input.score]
 * @param {number}  [input.elapsedSec]
 * @param {string}  [input.bandLabel]       Market Reaction band label (display-only, non-spoiling)
 * @param {object}  [input.outcome]         outcome shape (see glyphLines) — states/booleans/counts only
 * @param {string}  [input.headline]        generic shares only: optional first detail line
 * @param {string}  [input.detail]          generic shares only: optional second detail line
 * @returns {{ title:string, text:string, url:string, imageUrl:string, iconUrl:string, imageFilename:string, number:(number|null) }}
 */
export function buildShare(input) {
  const src = input && typeof input === "object" ? input : {};
  const surface = sanitizeSurface(src.surface);

  const isGame = src.kind !== "generic" && typeof src.puzzleType === "string" && src.puzzleType in SLUG_BY_TYPE;
  const slug = isGame ? slugForType(src.puzzleType) : GENERIC_SLUG;
  const entry = SHARE_MANIFEST[slug];

  // Number + date ride the Public ID only (its date segment IS the serve day —
  // the client's own clock is UTC-vs-CT ambiguous, Phase 0 §3).
  const publicId = isGame && puzzleDateFromPublicId(src.publicId) ? src.publicId.trim() : null;
  const date = publicId ? puzzleDateFromPublicId(publicId) : null;
  const number = date ? puzzleNumberFromDate(date, entry.epoch) : null;

  const score = sanitizeScore(src.score);
  const elapsed = formatElapsed(src.elapsedSec);
  const band = sanitizeLine(src.bandLabel, 40);
  const lines = isGame ? glyphLines(slug, src.outcome) : [];

  // D6 canonical link. Generic shares drop g/d; a game share drops d when the
  // serve date is unknown (mock/offline play has no publicId).
  const params = new URLSearchParams();
  if (isGame) params.set("g", slug);
  if (isGame && date) params.set("d", date);
  params.set("utm_source", "share");
  params.set("utm_medium", surface);
  const url = `${CANONICAL_ORIGIN}/?${params.toString()}`;

  // Card renderer params (D3 — the /api/share/card route ships in Phase 2; the
  // param grammar is fixed here so both phases agree). Outcome travels as the
  // compact `grid` encoding — states only, never content.
  const card = new URLSearchParams();
  card.set("game", slug);
  if (number !== null) card.set("n", String(number));
  if (date) card.set("date", date);
  if (score !== null) card.set("score", String(score));
  if (band) card.set("band", band);
  const grid = encodeGrid(slug, isGame ? src.outcome : null);
  if (grid) card.set("grid", grid);
  const imageUrl = `/api/share/card?${card.toString()}`;

  // Text block (approved template). Stat line assembles from whatever exists;
  // a missing result field degrades to fewer lines, never a hole (AC 7).
  const head = isGame
    ? `Faraday · ${entry.displayName}${number !== null ? ` #${number}` : ""}`
    : `Faraday ${entry.displayName}`;
  const statBits = [];
  if (score !== null) statBits.push(`${score} pts`);
  if (elapsed) statBits.push(elapsed);
  if (band) statBits.push(band);
  const textLines = [head, ...lines];
  if (statBits.length) textLines.push(statBits.join(" · "));
  if (!isGame) {
    const h = sanitizeLine(src.headline);
    const d = sanitizeLine(src.detail);
    if (h) textLines.push(h);
    if (d) textLines.push(d);
  }
  textLines.push(CANONICAL_HOST);

  return {
    title: "Faraday Daily Challenge",
    text: textLines.join("\n"),
    url,
    imageUrl,
    iconUrl: entry.icon,
    imageFilename: `faraday-${slug}.png`,
    number,
  };
}

// Compact, content-free grid encoding for the card URL:
//   signal-drop  rows of c/p/a/e joined by "-"   e.g. "aapc-ccccc"
//   ok-row games o/x per position                e.g. "ooxoo"
//   rackl        s<solved>m<mistakes>            e.g. "s4m1"
//   dark-fiber   p<pairs>m<mistakes>             e.g. "p5m2"
const ROW_CHAR = { correct: "c", present: "p", absent: "a", empty: "e" };

export function encodeGrid(slug, outcome) {
  if (!outcome || typeof outcome !== "object") return null;
  if (slug === "signal-drop") {
    const rows = Array.isArray(outcome.rows) ? outcome.rows.slice(0, SIGNAL_MAX_ROWS) : [];
    if (!rows.length) return null;
    const enc = rows.map((r) =>
      Array.isArray(r) && r.length > 0 && r.every((s) => s in ROW_CHAR)
        ? r.map((s) => ROW_CHAR[s]).join("")
        : null
    );
    return enc.every(Boolean) ? enc.join("-") : null;
  }
  if (slug === "rackl") {
    const s = clampCount(outcome.solved, 4);
    const m = clampCount(outcome.mistakes, 4);
    return s === null || m === null ? null : `s${s}m${m}`;
  }
  if (slug === "dark-fiber") {
    const p = clampCount(outcome.pairs, 12);
    const m = clampCount(outcome.mistakes, 20);
    return p === null || m === null ? null : `p${p}m${m}`;
  }
  const ok = Array.isArray(outcome.ok) ? outcome.ok : null;
  if (!ok || ok.length === 0 || ok.length > 20 || !ok.every((b) => typeof b === "boolean")) return null;
  return ok.map((b) => (b ? "o" : "x")).join("");
}
