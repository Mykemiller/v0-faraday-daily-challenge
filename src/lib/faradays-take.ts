// Faraday's Take (FAR-389) — shared, pure helpers for the editorial verdict shown
// on every puzzle completion screen. No I/O; imported by both the server read
// path (day-content sync / today route) and the client (`FaradaysTake` +
// `DailyChallenge`).
//
// Three concerns live here:
//   1. Voice attribution BY GAME TYPE (the take's byline) — so the voice feels
//      consistent per format rather than arbitrary. Editorial can still override
//      any single puzzle via the Airtable "Take Byline" field; this is only the
//      DEFAULT when none is set.
//   2. `resolveTakeByline` — override → game-type voice → Gilbert Faraday.
//   3. `deriveTakeFallback` — the stopgap body used when a puzzle has no authored
//      Take yet: its own per-question `explanation` strings from Puzzle Content,
//      surfaced plain/unsigned (never a blank or a generic "Nice work!").

// The two editorial voices (FAR-389 pre-resolved decision).
export const GILBERT_FARADAY = "Gilbert Faraday"; // Authority / Warmth
export const MACH_EIGEN = "Mach Eigen"; //           Precision / forward-looking

// Default voice per game type:
//   Gilbert Faraday → the data / market-mechanics games.
//   Mach Eigen      → the scenario / prediction games.
// This is a proposed default, not a hard lock — the "Take Byline" field overrides
// it per puzzle when a specific Take reads better in the other voice.
export const TAKE_VOICE_BY_TYPE: Record<string, string> = {
  Rackl: GILBERT_FARADAY,
  "The Stack": GILBERT_FARADAY,
  "Dark Fiber": GILBERT_FARADAY,
  Frequency: GILBERT_FARADAY,
  Circuit: MACH_EIGEN,
  "The Brief": MACH_EIGEN,
  "Signal Drop": MACH_EIGEN,
};

// The whole-set default when a type is unknown / unmapped — Gilbert Faraday, the
// house voice (matches `FaradaysTake`'s own last-resort default).
export function defaultTakeByline(puzzleType?: string | null): string {
  return (puzzleType && TAKE_VOICE_BY_TYPE[puzzleType]) || GILBERT_FARADAY;
}

// Byline resolution order: explicit editorial override → game-type voice →
// Gilbert Faraday. A blank/whitespace override is treated as "no override".
export function resolveTakeByline(
  puzzleType?: string | null,
  override?: string | null
): string {
  const o = typeof override === "string" ? override.trim() : "";
  return o || defaultTakeByline(puzzleType);
}

// Soft cap so the fallback stays tight on the completion screen — matches the
// ~320-char wrap budget the voiced Take renders under.
const FALLBACK_SOFT_CAP = 320;

// Fallback body when a puzzle has no authored Take: join the puzzle's own
// per-question `explanation` strings (Circuit / The Brief / Frequency carry
// these in `Puzzle Content`; the other four types have none → null). Returns a
// compact string, or null when the content carries no explanation — the caller
// then renders nothing rather than a blank/generic filler.
//
// Spoiler-safe: these explanation strings already ship to the client in the
// puzzle payload, and the Take slot only renders on the post-solve completion
// screen — this surfaces text the player is already entitled to see.
export function deriveTakeFallback(content: unknown): string | null {
  if (!content || typeof content !== "object") return null;
  const questions = (content as Record<string, unknown>).questions;
  if (!Array.isArray(questions)) return null;

  const parts: string[] = [];
  const seen = new Set<string>();
  for (const q of questions) {
    if (!q || typeof q !== "object") continue;
    const ex = (q as Record<string, unknown>).explanation;
    if (typeof ex !== "string") continue;
    const t = ex.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    parts.push(t);
  }
  if (!parts.length) return null;

  // Join into one compact paragraph, stopping once we exceed the soft cap (but
  // always keep at least the first explanation).
  let out = "";
  for (const p of parts) {
    const next = out ? `${out} ${p}` : p;
    if (out && next.length > FALLBACK_SOFT_CAP) break;
    out = next;
  }
  return out || null;
}
