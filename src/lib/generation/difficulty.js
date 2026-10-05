// CC-DC-GEN-DIFFICULTY-CANON-1.0 — the one place generation decides what a
// difficulty band IS.
//
// Root cause this module exists to kill: the generator used to emit the legacy
// strings easy/medium/hard, while dc_puzzle_bank_staging carries
//   CHECK dc_puzzle_bank_staging_difficulty_canon
//     (difficulty IS NULL OR difficulty IN ('foundational','practitioner','expert'))
// so EVERY insert was rejected by Postgres and a run wrote 0 rows
// (pilot 0118d976-ca9a-4f8f-b3c3-f1c9f1ae347a: 5/5 failed on that constraint).
//
// Invariants:
//   D1  the season-assigned band (from season_difficulty_mix) is AUTHORITATIVE
//       for `difficulty`. The model's self-reported value is never written there.
//   D2  the model's self-reported string is kept verbatim in `difficulty_raw`
//       (audit only). Nothing to report -> null.
//   D5  no DB trigger, no relaxed CHECK. The strict constraint is what caught
//       this and it stays strict.
//
// Plain JS (not TS) so the deployed worker (src/lib/generation/worker.ts) and
// the local CLI both share one vocabulary. The CLI's copy is
// scripts/far287/lib/difficulty.mjs and must stay identical in OUTPUT —
// src/lib/generation/difficulty.test.mjs enforces that.

// Canonical bands, in increasing depth. Mirrors table puzzle_difficulty_band
// and the order the staging CHECK accepts.
export const CANONICAL_BANDS = ["foundational", "practitioner", "expert"];

// Legacy vocabulary -> canonical. Mirrors table puzzle_difficulty_alias.
export const LEGACY_ALIASES = {
  easy: "foundational",
  medium: "practitioner",
  hard: "expert",
};

/**
 * Canonicalize any difficulty string.
 * @param {unknown} value
 * @returns {string|null} a canonical band, or null when the input is empty or
 *   is not a band we know (callers must treat null as "unknown", never as a
 *   default — a wrong band is a silently mislabelled puzzle).
 */
export function canonicalDifficulty(value) {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  if (!v) return null;
  if (CANONICAL_BANDS.includes(v)) return v;
  return LEGACY_ALIASES[v] ?? null;
}

/**
 * Deterministic band for a generation slot, drawn from the season's difficulty
 * mix. Same 10-slot bag as before; what changed is that the bands are canonical
 * and that a mix row with an unrecognised band is canonicalized (or dropped),
 * never passed through to the insert.
 *
 * @param {{difficulty_band: string, target_pct: number}[]} mix
 * @param {number} slot
 * @returns {string} always one of CANONICAL_BANDS
 */
export function difficultyFor(mix, slot) {
  const DEFAULT_MIX = [
    { difficulty_band: "foundational", target_pct: 40 },
    { difficulty_band: "practitioner", target_pct: 40 },
    { difficulty_band: "expert", target_pct: 20 },
  ];

  // Canonicalize first, then drop what still will not resolve. A mix of only
  // junk bands is the same as no mix at all: fall back to the default.
  const canon = (Array.isArray(mix) ? mix : [])
    .map((b) => ({
      difficulty_band: canonicalDifficulty(b?.difficulty_band),
      target_pct: Number(b?.target_pct) || 0,
    }))
    .filter((b) => b.difficulty_band !== null);

  const bands = canon.length ? canon : DEFAULT_MIX;
  const sorted = [...bands].sort(
    (a, b) => CANONICAL_BANDS.indexOf(a.difficulty_band) - CANONICAL_BANDS.indexOf(b.difficulty_band),
  );
  const total = sorted.reduce((a, b) => a + b.target_pct, 0) || 100;
  let acc = 0;
  const thresholds = sorted.map((b) => ({
    band: b.difficulty_band,
    upto: (acc += (b.target_pct / total) * 10),
  }));
  const r = ((Math.trunc(Number(slot) || 0) % 10) + 10) % 10;
  return thresholds.find((t) => r < t.upto)?.band ?? sorted[sorted.length - 1].difficulty_band;
}

/**
 * The two difficulty columns for one staging row.
 *
 * D1: `difficulty` comes from the season-assigned band ONLY. D2: the model's
 * self-report is preserved verbatim in `difficulty_raw`. The 'practitioner'
 * fallback exists so a row can never carry a non-canonical band into an insert
 * the CHECK would reject; it should be unreachable, since difficultyFor()
 * always returns a canonical band.
 *
 * @param {unknown} assigned   the season-assigned band (it.difficulty)
 * @param {unknown} modelValue whatever the model put in "difficulty"
 * @returns {{difficulty: string, difficulty_raw: string|null}}
 */
export function resolveRowDifficulty(assigned, modelValue) {
  let raw = null;
  if (typeof modelValue === "string") raw = modelValue.trim() === "" ? null : modelValue;
  else if (modelValue !== null && modelValue !== undefined) raw = String(modelValue);
  return {
    difficulty: canonicalDifficulty(assigned) ?? "practitioner",
    difficulty_raw: raw,
  };
}
