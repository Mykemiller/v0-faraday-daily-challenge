// CC-DC-GEN-DIFFICULTY-CANON-1.0 — the one place generation decides what a
// difficulty band IS.
// CC-DC-GEN-DIFFICULTY-ALLOCATION-1.0 — and the one place it decides HOW MANY
// of each band a season gets, and WHICH day each one lands on.
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

/** 40/40/20 — what a missing or wholly unreadable mix degrades to. */
const DEFAULT_MIX = [
  { difficulty_band: "foundational", target_pct: 40 },
  { difficulty_band: "practitioner", target_pct: 40 },
  { difficulty_band: "expert", target_pct: 20 },
];

/** Canonicalize the mix rows, drop what still will not resolve, and fall back
 *  to the default when nothing survives. A mix of only junk bands is the same
 *  as no mix at all. Shared by difficultyFor and planDifficulty so the two can
 *  never disagree about what a mix MEANS.
 *  @param {unknown} mix
 *  @returns {{difficulty_band: string, target_pct: number}[]} */
function resolveMix(mix) {
  const canon = (Array.isArray(mix) ? mix : [])
    .map((b) => ({
      difficulty_band: canonicalDifficulty(b?.difficulty_band),
      target_pct: Number(b?.target_pct) || 0,
    }))
    .filter((b) => b.difficulty_band !== null);
  return canon.length ? canon : DEFAULT_MIX;
}

/**
 * Deterministic band for a generation slot, drawn from the season's difficulty
 * mix. Same 10-slot bag as before; what changed is that the bands are canonical
 * and that a mix row with an unrecognised band is canonicalized (or dropped),
 * never passed through to the insert.
 *
 * CC-DC-GEN-DIFFICULTY-ALLOCATION-1.0: the WORKER no longer calls this. A bag
 * of ten can only quantize to tenths, so Football's 14.41/29.82/55.77 came out
 * of it as 10/30/60 per ten slots and the season banked 120/178/297 where the
 * mix wanted 85/180/330 (measured 2026-10-06). planDifficulty() below is what
 * the worker allocates with now. difficultyFor stays exported for
 * scripts/far287/generate-puzzles.mjs, which still walks slot indices.
 *
 * @param {{difficulty_band: string, target_pct: number}[]} mix
 * @param {number} slot
 * @returns {string} always one of CANONICAL_BANDS
 */
export function difficultyFor(mix, slot) {
  const bands = resolveMix(mix);
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

// ═══════════════════════════════════════════════════════════════════════════
// CC-DC-GEN-DIFFICULTY-ALLOCATION-1.0 — season-wide difficulty allocation
// ═══════════════════════════════════════════════════════════════════════════
//
// Root cause this half of the module exists to kill: the worker drew each
// slot's band from difficultyFor(mix, idx * 7 + types.indexOf(type)) — a bag of
// ten. Two things followed directly:
//
//   • the configured mix was only ever honoured to the nearest tenth. Football
//     asks for 14.41 / 29.82 / 55.77 and the bag can only say 10 / 30 / 60, so
//     the season banked 120 foundational / 178 practitioner / 297 expert where
//     the mix wanted 85 / 180 / 330 (measured 2026-10-06).
//   • `difficulty_curve` — the shape the editor previews with a sparkline —
//     was read by nothing. A commissioner could set `ramp` and get a flat,
//     period-10 sawtooth.
//
// Invariants:
//   D1  pure. No I/O, no clock, no unseeded randomness. Dates, types, mix and
//       curve in; a Map<"type|date", band> out.
//   D2  per TYPE, the normalized mix is converted to WHOLE puzzle counts over
//       that type's date count by largest remainder. Every type therefore lands
//       within ±1 puzzle of the mix, and the counts sum to exactly the date
//       count — no rounding leak.
//   D3  the curve only decides WHICH dates get which band; it can never change
//       the totals D2 computed. `flat` is a seeded even interleave; `ramp` and
//       `wave` rank-match the bands (ascending depth) to the shape
//       curvePoints() returns; `custom` is treated as flat and the League
//       Office warns `difficulty_curve_custom_unsupported` — there is no stored
//       custom shape to read (see generationWarnings() in generation-logic.ts).
//   D4  deterministic: same dates + types + mix + curve + seed ⇒ byte-identical
//       output, in this process and in the CLI twin.
//   D5  per-game mix rows (season_difficulty_mix.applies_to_game_id) and the
//       per-game difficulty_floor/ceiling are OUT OF SCOPE here, but
//       `perTypeMix` is the seam they plug into: supply a mix per runtime key
//       and that type is apportioned against it instead of the season mix.
//   D6  CC-DC-GEN-DIFFICULTY-CANON-1.0 is untouched — the allocator only ever
//       emits CANONICAL_BANDS, and the model's self-report still goes nowhere
//       near `difficulty` (resolveRowDifficulty above).

/** The four shapes `season_config.difficulty_curve` accepts.
 *  @type {readonly ["flat", "ramp", "wave", "custom"]} */
export const DIFFICULTY_CURVES = ["flat", "ramp", "wave", "custom"];

/** The League Office warning code for a curve with no shape to place (D3). */
export const CURVE_CUSTOM_WARNING = "difficulty_curve_custom_unsupported";

/** Any curve we do not know reads as `flat` — never as an error, because a
 *  stale enum value must not be able to stop a season generating.
 *  @param {unknown} curve
 *  @returns {string} one of DIFFICULTY_CURVES */
export function normalizeCurve(curve) {
  const v = typeof curve === "string" ? curve.trim().toLowerCase() : "";
  return DIFFICULTY_CURVES.indexOf(v) >= 0 ? v : "flat";
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Normalized 0..1 sample points for a difficulty curve.
 *
 * CC-DC-GEN-DIFFICULTY-ALLOCATION-1.0 D3 — this is AUTHORITATIVE, not a
 * preview. It used to live in season-config-logic.ts labelled "presentation
 * only — no scoring or selection logic reads this", and that label was the bug:
 * the editor drew a ramp the generator never honoured. The sparkline in
 * ConfigEditor and the band placement in planDifficulty() now read the same
 * function, so what the commissioner previews is what the season gets.
 *
 * Returns EXACTLY `n` points. (The preview-era version clamped to 2..200, which
 * for a 500-day season would have truncated the shape it was asked for.)
 *
 * @param {string} curve
 * @param {number} [n]
 * @returns {number[]}
 */
export function curvePoints(curve, n = 24) {
  const count = Math.floor(Number(n) || 0);
  if (count <= 0) return [];
  const out = [];
  for (let i = 0; i < count; i++) {
    // A one-point curve has no slope to sample; take its midpoint.
    const t = count === 1 ? 0.5 : i / (count - 1);
    switch (curve) {
      case "ramp":
        out.push(t);
        break;
      case "wave":
        out.push(0.5 - Math.cos(t * Math.PI * 2) / 2);
        break;
      case "custom":
        out.push(0.5);
        break;
      case "flat":
      default:
        out.push(0.5);
        break;
    }
  }
  return out.map((v) => round2(Math.max(0, Math.min(1, v))));
}

/** The mix as one weight per CANONICAL_BANDS entry, duplicate rows summed. A
 *  mix whose surviving rows all read 0 is "no signal" and degrades to the
 *  default rather than apportioning the whole season onto the first band.
 *  @param {unknown} mix
 *  @returns {number[]} */
export function mixWeights(mix) {
  const weigh = (rows) => {
    const out = CANONICAL_BANDS.map(() => 0);
    for (const r of rows) out[CANONICAL_BANDS.indexOf(r.difficulty_band)] += Math.max(0, r.target_pct);
    return out;
  };
  const w = weigh(resolveMix(mix));
  return w.reduce((a, v) => a + v, 0) > 0 ? w : weigh(DEFAULT_MIX);
}

/**
 * Whole-number apportionment of `total` across `weights` by largest remainder.
 * Always sums to exactly `total`; ties go to the lower index so the result is a
 * pure function of the input order (D4). Mirror of largestRemainder in
 * src/lib/generation/theme-allocation.js — difficulty.test.mjs imports both and
 * asserts they agree on every case it checks.
 *
 * @param {number[]} weights
 * @param {number} total
 * @returns {number[]}
 */
export function largestRemainder(weights, total) {
  const n = weights.length;
  const want = Number.isFinite(total) ? Math.max(0, Math.trunc(total)) : 0;
  if (!n || want === 0) return new Array(n).fill(0);

  const sum = weights.reduce((a, v) => a + Math.max(0, Number(v) || 0), 0);
  if (sum <= 0) {
    // "no signal" reads as an even split, the same way normalizeTo100 does.
    const base = Math.floor(want / n);
    const out = new Array(n).fill(base);
    for (let i = 0; i < want - base * n; i++) out[i]++;
    return out;
  }

  const exact = weights.map((w) => (Math.max(0, Number(w) || 0) * want) / sum);
  const out = exact.map((v) => Math.floor(v));
  const left = want - out.reduce((a, v) => a + v, 0);
  const order = exact
    .map((v, i) => ({ i, rem: v - Math.floor(v) }))
    .sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (let k = 0; k < left; k++) out[order[k].i]++;
  return out;
}

/** FNV-1a. Not cryptographic — it only has to be stable across processes. */
function hash32(text) {
  let h = 0x811c9dc5;
  const s = String(text);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * `flat` placement: every band laid down at its own even spacing, with a seeded
 * phase offset so two types in the same season do not stack their expert days
 * on the same dates. The phase shifts a band as a whole and never changes the
 * spacing INSIDE it, which is what keeps the spread tight whatever the seed:
 * the longest run of one band is bounded by the ratio of the band spacings.
 *
 * @param {number[]} counts  one per CANONICAL_BANDS entry
 * @param {string} seed
 * @returns {string[]}
 */
function evenInterleave(counts, seed) {
  const items = [];
  for (let bi = 0; bi < CANONICAL_BANDS.length; bi++) {
    const c = counts[bi];
    if (c <= 0) continue;
    const phase = (hash32(`${seed}|${CANONICAL_BANDS[bi]}`) % 1000) / 1000;
    for (let k = 0; k < c; k++) items.push({ bi, key: (k + phase) / c });
  }
  items.sort((a, b) => a.key - b.key || a.bi - b.bi);
  return items.map((it) => CANONICAL_BANDS[it.bi]);
}

/**
 * `ramp`/`wave` placement: rank the dates by the curve's value at that date
 * (ties by date index, so the result is a pure function of the shape) and pour
 * the bands in ascending depth down that ranking. The shallowest band lands on
 * the lowest points of the curve and the deepest on the highest — a ramp gets
 * progressively harder; a wave peaks mid-season and eases off at both ends.
 *
 * @param {number[]} counts  one per CANONICAL_BANDS entry
 * @param {number[]} shape   curvePoints(curve, dates.length)
 * @returns {string[]}
 */
function rankMatch(counts, shape) {
  const order = shape
    .map((v, i) => ({ v, i }))
    .sort((a, b) => a.v - b.v || a.i - b.i);
  const seq = [];
  for (let bi = 0; bi < CANONICAL_BANDS.length; bi++)
    for (let k = 0; k < counts[bi]; k++) seq.push(CANONICAL_BANDS[bi]);
  const out = new Array(shape.length);
  for (let r = 0; r < order.length; r++) out[order[r].i] = seq[r];
  return out;
}

/**
 * The season's whole difficulty plan: the band every (type, date) slot gets.
 *
 * Totals come from the mix (D2), placement comes from the curve (D3), and the
 * two are independent — changing `curve` reshuffles the calendar without moving
 * a single puzzle between bands.
 *
 * @param {{
 *   dates: string[],
 *   types: string[],
 *   mix?: {difficulty_band: string, target_pct: number}[],
 *   curve?: string,
 *   seed?: string,
 *   perTypeMix?: Record<string, {difficulty_band: string, target_pct: number}[]>,
 * }} input
 * @returns {Map<string, string>} key `"<type>|<date>"` -> a CANONICAL_BANDS value
 */
export function planDifficulty(input) {
  const i = input && typeof input === "object" ? input : {};
  const dates = (Array.isArray(i.dates) ? i.dates : []).map(String);
  const types = (Array.isArray(i.types) ? i.types : []).map(String);
  const curve = normalizeCurve(i.curve);
  const seed = String(i.seed ?? "");
  const perTypeMix = i.perTypeMix && typeof i.perTypeMix === "object" ? i.perTypeMix : {};

  /** @type {Map<string, string>} */
  const out = new Map();
  if (!dates.length || !types.length) return out;

  // `custom` has no stored shape, so it places as flat; the League Office says
  // so out loud rather than letting the editor's sparkline imply otherwise.
  const shape = curve === "ramp" || curve === "wave" ? curvePoints(curve, dates.length) : null;

  for (const type of types) {
    // D5 — a per-type mix wins over the season mix when one is supplied.
    const mix = Object.prototype.hasOwnProperty.call(perTypeMix, type) ? perTypeMix[type] : i.mix;
    const counts = largestRemainder(mixWeights(mix), dates.length);
    const seq = shape ? rankMatch(counts, shape) : evenInterleave(counts, `${seed}|${type}`);
    for (let k = 0; k < dates.length; k++) out.set(`${type}|${dates[k]}`, seq[k]);
  }
  return out;
}

/**
 * The whole-puzzle target per band for ONE type over `dateCount` dates — the
 * same arithmetic planDifficulty applies, exposed so a caller can state the
 * target without building the whole calendar.
 *
 * @param {unknown} mix
 * @param {number} dateCount
 * @returns {Record<string, number>}
 */
export function difficultyTargets(mix, dateCount) {
  const counts = largestRemainder(mixWeights(mix), dateCount);
  /** @type {Record<string, number>} */
  const out = {};
  CANONICAL_BANDS.forEach((b, i) => { out[b] = counts[i]; });
  return out;
}
