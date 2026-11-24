// CC-DC-GEN-BATCH-HARDENING-1.0 — the one place generation decides HOW MANY
// puzzles go into a model call, what to do when the model's output is CUT OFF,
// and whether there is enough time left to make the call at all.
//
// Root cause this module exists to kill: the worker asked for 8–12 puzzles of
// one type in a single call capped at `max_tokens: 4096` and then ignored
// `stop_reason` entirely. When the response hit the cap the JSON simply ended
// mid-object; `parseArray()` salvaged the complete objects it could find and
// every item past that point was recorded as `no-content`. Nothing in the run
// row, the logs or the panel said "truncated" — a structural, perfectly
// repeatable failure looked like the model declining to answer.
//
// The offline sizing (chars/4 off the prompts.js exemplars, ×1.6 for
// hints + answer_explanation + the JSON wrapper) shows the worst offender:
//   The Brief  ~662 output tokens/puzzle → 8 puzzles ≈ 5,300 tokens
// i.e. the OLD minimum batch of 8 could not fit inside 4,096 no matter what the
// model did. Circuit at 8 ≈ 3,064 was one verbose explanation from the same
// cliff. Raising the cap alone is not a fix, because "how long is the output"
// is a property of the model's answer, not of our estimate — so the cap goes up
// AND truncation becomes a detected, recoverable condition.
//
// Invariants:
//   B1  TRUNCATION IS NEVER PARTIALLY TRUSTED. On `stop_reason === "max_tokens"`
//       a result is kept only when the number of complete parsed objects equals
//       the number asked for. Anything less is DISCARDED whole — a salvaged
//       prefix of a truncated array is indistinguishable from a model that
//       answered fewer items, and keeping it silently writes an unknown subset.
//   B2  RECOVERY IS A SPLIT, NOT A RETRY. The same prompt at the same size
//       truncates again; halving the slice halves the output. Halves are retried
//       immediately, recursively, down to size 1. A size-1 call that still
//       truncates is a real failure with reason `truncated`.
//   B3  NO CALL IS STARTED THAT CANNOT FINISH. Before every model call —
//       including each split retry — the guard requires
//       elapsed + EMA(batch duration) <= budgetMs. The old code checked the
//       budget once per BATCH, so a batch begun at 249s on a 250s budget ran
//       to the Vercel 300s wall and lost its work uncheckpointed.
//   B4  EVERY SPLIT AND EVERY STOP EMITS ONE STRUCTURED LINE. The reason a FULL
//       run came up short must be readable from the logs without re-deriving it.
//
// Pure: no I/O, no imports, no clock of its own (the caller injects `now`), and
// the model call is injected. Plain JS (not TS) for the same reason
// src/lib/generation/difficulty.js and failure-reasons.js are — the deployed
// worker (TS) and the FAR-287 CLI (.mjs) share ONE implementation of this
// logic rather than twin copies that can drift.
// Tests: src/lib/generation/batching.test.mjs (npm run test:generation-batching).

/**
 * Output cap for a generation call. 16k is ~2.4× the largest batch this module
 * will start (The Brief at 5 ≈ 3.3k est. tokens), so truncation becomes the
 * exception the split path handles rather than the norm.
 */
export const DEFAULT_MAX_TOKENS = 16000;

/** EMA weight on the newest batch duration (D4). */
export const BUDGET_ALPHA = 0.5;
/** EMA seed, used before any batch has completed (D4). */
export const BUDGET_SEED_MS = 60_000;

/**
 * Per-type STARTING batch size (D3), from the offline sizing table. These are
 * starting points for the split logic, not ceilings on correctness: a type that
 * truncates anyway recovers by halving.
 *
 * Every entry sits under 70% of DEFAULT_MAX_TOKENS on the estimate (the worst,
 * The Brief at 5, is ~21%), so none needed adjusting away from the decided map.
 */
export const TYPE_BATCH_SIZE = {
  "The Brief": 5,
  Circuit: 8,
  Frequency: 8,
  Rackl: 8,
  "Signal Drop": 10,
  "The Stack": 10,
  "Dark Fiber": 10,
};

/** Starting size for a type with no entry above (a new game in the catalog). */
export const DEFAULT_TYPE_BATCH_SIZE = 8;

/**
 * `max_tokens` for a generation call. `DC_GEN_MAX_TOKENS` overrides; a value
 * that is not a number ≥ 1024 is ignored rather than allowed to produce a cap
 * so small that every call truncates.
 *
 * @param {Record<string, string|undefined>} [env]
 * @returns {number}
 */
export function genMaxTokens(env) {
  const source = env ?? (typeof process !== "undefined" ? process.env : {}) ?? {};
  const n = Number(source.DC_GEN_MAX_TOKENS);
  return Number.isFinite(n) && n >= 1024 ? Math.trunc(n) : DEFAULT_MAX_TOKENS;
}

/**
 * The size of the first model call for `type`, clamped by the caller's upper
 * bound (the worker's 8–12 `batchSize`). The per-type number may be BELOW that
 * bound — that is the point of the map — so only the upper side is clamped.
 *
 * @param {string} type runtime_key of the game
 * @param {number} [cap] caller's maximum batch size
 * @returns {number}
 */
export function startingBatchSize(type, cap) {
  const base = TYPE_BATCH_SIZE[type] ?? DEFAULT_TYPE_BATCH_SIZE;
  const n = Number(cap);
  const limit = Number.isFinite(n) && n >= 1 ? Math.trunc(n) : base;
  return Math.max(1, Math.min(base, limit));
}

/**
 * @typedef {object} Budget
 * @property {number} budgetMs the slice's wall-clock budget
 * @property {number} ema current exponential moving average of batch duration
 * @property {number} samples how many durations have been recorded
 * @property {() => number} nowMs the injected clock
 * @property {() => number} elapsed ms since the slice started
 * @property {() => number} projected elapsed + ema
 * @property {() => boolean} canAfford whether one more average-length call fits
 * @property {(ms: unknown) => number} record fold a completed call's duration in
 */

/**
 * The B3 guard. Seeded PESSIMISTICALLY (60s) so the first batch of a slice is
 * refused when little time is left, and then converges on what this run's
 * batches actually cost — a Rackl batch and a Brief batch are not the same
 * size of bet.
 *
 * @param {{budgetMs?: number, startedAt?: number, now?: () => number, alpha?: number, seedMs?: number}} [opts]
 * @returns {Budget}
 */
export function createBudget(opts = {}) {
  const now = typeof opts.now === "function" ? opts.now : () => Date.now();
  const budgetMs = Number.isFinite(Number(opts.budgetMs)) ? Number(opts.budgetMs) : 230_000;
  const alpha = Number.isFinite(Number(opts.alpha)) ? Number(opts.alpha) : BUDGET_ALPHA;
  const startedAt = Number.isFinite(Number(opts.startedAt)) ? Number(opts.startedAt) : now();
  let ema = Number.isFinite(Number(opts.seedMs)) ? Number(opts.seedMs) : BUDGET_SEED_MS;
  let samples = 0;

  const elapsed = () => now() - startedAt;
  return {
    budgetMs,
    get ema() { return ema; },
    get samples() { return samples; },
    nowMs: now,
    elapsed,
    projected: () => elapsed() + ema,
    canAfford: () => elapsed() + ema <= budgetMs,
    record(ms) {
      const n = Number(ms);
      if (!Number.isFinite(n) || n < 0) return ema;
      samples += 1;
      ema = alpha * n + (1 - alpha) * ema;
      return ema;
    },
  };
}

/**
 * @template T
 * @typedef {object} BatchOutcome
 * @property {T} item the slot this outcome belongs to
 * @property {unknown} [object] the parsed array element (may be undefined when
 *   the model simply returned fewer elements — the caller's existing
 *   `no-content` handling owns that case, which is NOT truncation)
 * @property {{reason: string, message: string, error?: unknown}} [failure]
 */

/**
 * @template T
 * @typedef {object} BatchRun
 * @property {BatchOutcome<T>[]} outcomes one per ATTEMPTED item, in item order
 * @property {T[]} unattempted items never sent, because the budget guard stopped
 * @property {boolean} stopped true when the budget guard halted the slice
 * @property {number} calls model calls made
 * @property {number} splits truncation-driven splits performed
 */

/**
 * Run one starting batch, splitting on truncation (B1/B2) and refusing to start
 * a call that cannot finish (B3).
 *
 * `call` is injected — this module makes no network request and holds no API
 * key, which is what lets the tests drive every branch offline. It receives a
 * sub-slice of `items` and must return the PARSED array plus the model's
 * `stop_reason`; throwing is treated as a whole-sub-slice `model` failure
 * (unchanged from the pre-split behaviour) rather than a reason to split, since
 * a transport error says nothing about output length.
 *
 * @template T
 * @param {T[]} items
 * @param {{
 *   call: (slice: T[]) => Promise<{objects?: unknown[], stopReason?: string|null, ms?: number}>,
 *   budget?: Budget|null,
 *   log?: (event: Record<string, unknown>) => void,
 *   minSize?: number,
 * }} deps
 * @returns {Promise<BatchRun<T>>}
 */
export async function runBatchWithSplit(items, deps) {
  const list = Array.isArray(items) ? items : [];
  const call = deps && typeof deps.call === "function" ? deps.call : null;
  if (!call) throw new Error("runBatchWithSplit requires a `call` function");
  const budget = deps.budget ?? null;
  const log = typeof deps.log === "function" ? deps.log : () => {};
  const minSize = Math.max(1, Math.trunc(Number(deps.minSize) || 1));

  /** @type {BatchRun<T>} */
  const state = { outcomes: [], unattempted: [], stopped: false, calls: 0, splits: 0 };

  /**
   * @param {T[]} slice
   * @param {number} depth
   */
  async function attempt(slice, depth) {
    if (!slice.length) return;

    // B3 — once the guard has stopped the slice, NOTHING else is sent, not even
    // the other half of a split already in flight conceptually. Those slots stay
    // pending in the DB and the next invocation picks them up.
    if (state.stopped) {
      state.unattempted.push(...slice);
      return;
    }
    if (budget && !budget.canAfford()) {
      state.stopped = true;
      state.unattempted.push(...slice);
      log({
        step: "budget-stop", depth, size: slice.length,
        elapsedMs: Math.round(budget.elapsed()), emaMs: Math.round(budget.ema), budgetMs: budget.budgetMs,
      });
      return;
    }

    const startedAt = budget ? budget.nowMs() : 0;
    state.calls += 1;
    /** @type {{objects?: unknown[], stopReason?: string|null, ms?: number}} */
    let res;
    try {
      res = await call(slice);
    } catch (err) {
      // Measured, not reported: a call that threw still consumed wall clock
      // (including the client's one transient retry), and the guard has to know.
      if (budget) budget.record(budget.nowMs() - startedAt);
      const message = err instanceof Error ? err.message : String(err);
      for (const item of slice) state.outcomes.push({ item, failure: { reason: "model", message, error: err } });
      return;
    }
    if (budget) budget.record(Number.isFinite(Number(res?.ms)) ? Number(res?.ms) : budget.nowMs() - startedAt);

    const objects = Array.isArray(res?.objects) ? res.objects : [];
    const truncated = String(res?.stopReason ?? "") === "max_tokens";

    if (truncated && objects.length !== slice.length) {
      if (slice.length <= minSize) {
        log({ step: "truncated", depth, size: slice.length, parsed: objects.length });
        for (const item of slice)
          state.outcomes.push({
            item,
            failure: {
              reason: "truncated",
              message: `model output hit max_tokens at batch size ${slice.length} (${objects.length}/${slice.length} complete)`,
            },
          });
        return;
      }
      const mid = Math.ceil(slice.length / 2);
      state.splits += 1;
      // B4 — one line per split, carrying the three facts that explain it.
      log({ step: "split", depth, size: slice.length, parsed: objects.length, halves: [mid, slice.length - mid] });
      await attempt(slice.slice(0, mid), depth + 1);
      await attempt(slice.slice(mid), depth + 1);
      return;
    }

    // Truncated but COMPLETE: every requested object closed before the cap bit
    // (the cap landed in trailing whitespace or a closing bracket). Kept per B1
    // because the count matches, and logged because it means the next size up
    // for this type would not have fit.
    if (truncated) log({ step: "truncated-complete", depth, size: slice.length, parsed: objects.length });

    slice.forEach((item, k) => state.outcomes.push({ item, object: objects[k] }));
  }

  await attempt(list, 0);
  return state;
}
