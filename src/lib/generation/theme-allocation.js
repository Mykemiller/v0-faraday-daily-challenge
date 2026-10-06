// CC-DC-GEN-THEME-ALLOCATION-1.0 — the one place generation decides WHICH
// theme each season day carries.
//
// Root cause this module exists to kill: Phase A of the worker built the season
// calendar out of the corpus's OWN dates. It looked up the corpus row whose
// `theme_date` equalled the season date, substituted the nearest-dated
// non-excluded row when that one was excluded or already taken, and never once
// read `target_pct`. Two consequences followed directly:
//
//   • the commissioner's configured mix was decorative. Football's config says
//     T-002 35.31 / T-005 29.41 / T-007 35.28 with T-001/003/004/006 excluded,
//     but the calendar it produced was whatever the corpus happened to carry on
//     those 500 dates — T-007 holds only 45 corpus rows, so a 35% emphasis
//     could never be met by date-matching however the exclusions fell.
//   • the "nearest date" fallback made the calendar a function of the corpus
//     WINDOW. A season date past the end of the corpus window (2027-12-13) drew
//     from the same tail rows over and over, and once they were used the loop
//     threw `no corpus theme row available for <date>`.
//
// Invariants:
//   D1  pure. No I/O, no clock, no randomness that is not seeded. The caller
//       hands in the dates, the corpus rows and the mix; it gets back a plan.
//   D2  included Theater-level rows (sector_code null, thread_code null,
//       is_excluded false) are normalized to 100 and converted to WHOLE DAYS by
//       largest remainder over dates.length. A Theater that also carries
//       included Sector-level rows splits its own day quota across those
//       sectors the same way; otherwise its sectors are free.
//   D3  a corpus row is ineligible if its theater, its sector, or ANY of its
//       threads is excluded — the same rule the worker's old `passes` applied.
//   D4  corpus row DATE is irrelevant to selection. Inside a quota, sectors
//       rotate least-used-first and rows that have not been used this season
//       are preferred; once a pool is exhausted the least-recently-used row is
//       reused. This is what removes the corpus-window gap.
//   D5  spread: a deterministic interleave keyed on the season id means no
//       Theater runs more than 2 consecutive days and no sector repeats on
//       consecutive days, whenever the quotas admit such an arrangement. (A
//       Theater holding more than two thirds of the season cannot be spread
//       that way by any arrangement; the run of 3+ is then unavoidable and the
//       allocator takes it rather than failing.)
//   D6  deterministic: same dates + corpus + mix + seed ⇒ identical output.
//   D7  an included Theater or Sector with a positive share and ZERO eligible
//       corpus rows is an ERROR, never a silent redistribution onto its
//       neighbours. The League Office checklist reports it as
//       `theme_quota_unfillable` and the worker fails the run with
//       `theme:unfillable:<theater>`.
//
// Plain JS (not TS), like difficulty.js and failure-reasons.js, so the deployed
// worker, the server-side checklist and any CLI share one vocabulary with no
// build step between them. No imports at all: normalizeTo100 is mirrored from
// src/lib/league-office/season-config-logic.ts and the mirror is pinned by
// src/lib/generation/theme-allocation.test.mjs, which imports both and asserts
// they agree.
//
// Tests: src/lib/generation/theme-allocation.test.mjs (npm run test:theme-allocation).

/** The failure key the worker records for an unfillable Theater (D7). */
export function themeUnfillableKey(theaterId) {
  return `theme:unfillable:${String(theaterId ?? "-").trim() || "-"}`;
}

/** Thrown by allocateThemeCalendar when the plan cannot be built (D7). */
export class ThemeAllocationError extends Error {
  /**
   * @param {string} message
   * @param {{code?: string, unfillable?: {theater_id: string, sector_code: string|null}[]}} [info]
   */
  constructor(message, info) {
    super(message);
    this.name = "ThemeAllocationError";
    const i = info && typeof info === "object" ? info : {};
    /** stable short code: `unfillable` | `no_theme_mix` */
    this.code = i.code || "unfillable";
    /** every Theater/Sector that could not be filled, in report order */
    this.unfillable = Array.isArray(i.unfillable) ? i.unfillable : [];
    /** one key per DISTINCT theater, so slice counts stay comparable (F2) */
    this.failureKeys = [...new Set(this.unfillable.map((u) => themeUnfillableKey(u.theater_id)))];
    /** the key a single-key caller should record */
    this.failureKey = this.failureKeys[0] || `theme:${this.code}`;
  }
}

// ── pure arithmetic ──────────────────────────────────────────────────────────

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Push the residual onto the largest element — mirrors season-config-logic. */
function absorbDrift(values) {
  const out = values.slice();
  const drift = round2(100 - out.reduce((a, v) => a + v, 0));
  if (drift === 0) return out;
  let idx = 0;
  for (let i = 1; i < out.length; i++) if (out[i] > out[idx]) idx = i;
  out[idx] = round2(out[idx] + drift);
  return out;
}

/** n equal shares that sum to exactly 100 — mirrors season-config-logic. */
export function evenSplit(n) {
  if (n <= 0) return [];
  return absorbDrift(new Array(n).fill(round2(100 / n)));
}

/**
 * Proportionally rescale to exactly 100. Mirror of normalizeTo100 in
 * src/lib/league-office/season-config-logic.ts — the editor and the writer
 * already rescale every saved mix with it, and the allocator must land on the
 * same numbers for a mix that reached the database some other way.
 * @param {number[]} values
 * @returns {number[]}
 */
export function normalizeTo100(values) {
  if (!values.length) return [];
  const total = values.reduce((a, v) => a + (Number(v) || 0), 0);
  if (total <= 0) return evenSplit(values.length);
  return absorbDrift(values.map((v) => round2(((Number(v) || 0) * 100) / total)));
}

/**
 * Whole-number apportionment of `total` across `weights` by largest remainder.
 * Always sums to exactly `total`; ties go to the lower index so the result is
 * a pure function of the input order (D6).
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

// ── seeded, deterministic ordering ───────────────────────────────────────────

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
 * A stable order for `keys` that depends on the seed — so two seasons with the
 * same mix do not produce byte-identical calendars, while one season always
 * does (D6). Ties on the hash fall back to the key itself.
 * @param {string[]} keys
 * @param {string} seed
 * @returns {string[]}
 */
export function seededOrder(keys, seed) {
  return [...keys].sort((a, b) => {
    const ha = hash32(`${seed}|${a}`);
    const hb = hash32(`${seed}|${b}`);
    return ha - hb || (a < b ? -1 : a > b ? 1 : 0);
  });
}

// ── the mix ──────────────────────────────────────────────────────────────────

/**
 * Is this row one of the Theater-level rows the 100% total is computed over?
 * Mirror of isThemeTotalRow in season-config-logic.ts.
 */
export function isTheaterTotalRow(r) {
  return !!r && !r.sector_code && !r.thread_code && !r.is_excluded;
}

/**
 * The three exclusion axes, exactly as the worker's old `passes` read them:
 * a Theater row with no sector/thread excludes the Theater; a row with a sector
 * and no thread excludes that SECTOR CODE wherever it appears; a row with a
 * thread excludes that thread code.
 * @param {{theater_id: string, sector_code: string|null, thread_code: string|null, is_excluded: boolean}[]} mixRows
 */
export function themeExclusions(mixRows) {
  const rows = Array.isArray(mixRows) ? mixRows : [];
  return {
    theaters: new Set(rows.filter((r) => r.is_excluded && !r.sector_code && !r.thread_code).map((r) => r.theater_id)),
    sectors: new Set(rows.filter((r) => r.is_excluded && r.sector_code && !r.thread_code).map((r) => r.sector_code)),
    threads: new Set(rows.filter((r) => r.is_excluded && r.thread_code).map((r) => r.thread_code)),
  };
}

/** D3 — is this corpus row usable at all under the configured exclusions? */
export function isEligible(row, ex) {
  if (!row) return false;
  if (ex.theaters.has(row.theater_id)) return false;
  if (ex.sectors.has(row.sector_code)) return false;
  return !(row.thread_codes || []).some((c) => ex.threads.has(c));
}

/**
 * Day quotas per included Theater, and per Sector inside a Theater that
 * configures them (D2).
 *
 * @param {{theater_id: string, sector_code: string|null, thread_code: string|null, target_pct: number, is_excluded: boolean}[]} mixRows
 * @param {number} dayCount
 * @returns {{theaters: {theater_id: string, target_pct: number, days: number}[],
 *            sectors: Map<string, {sector_code: string, target_pct: number, days: number}[]>}}
 */
export function themeQuotas(mixRows, dayCount) {
  const rows = Array.isArray(mixRows) ? mixRows : [];
  const ex = themeExclusions(mixRows);

  const totals = rows.filter(isTheaterTotalRow).filter((r) => !ex.theaters.has(r.theater_id));
  const pcts = normalizeTo100(totals.map((r) => Number(r.target_pct) || 0));
  const days = largestRemainder(pcts, dayCount);
  const theaters = totals.map((r, i) => ({ theater_id: r.theater_id, target_pct: pcts[i], days: days[i] }));

  const sectors = new Map();
  for (const t of theaters) {
    const secRows = rows.filter(
      (r) =>
        r.theater_id === t.theater_id &&
        r.sector_code &&
        !r.thread_code &&
        !r.is_excluded &&
        !ex.sectors.has(r.sector_code)
    );
    if (!secRows.length) continue;
    const secPcts = normalizeTo100(secRows.map((r) => Number(r.target_pct) || 0));
    const secDays = largestRemainder(secPcts, t.days);
    sectors.set(
      t.theater_id,
      secRows.map((r, i) => ({ sector_code: r.sector_code, target_pct: secPcts[i], days: secDays[i] }))
    );
  }
  return { theaters, sectors };
}

/**
 * D7, as the League Office checklist sees it: which included Theaters/Sectors
 * carry a share the corpus cannot serve at all.
 *
 * `corpusCounts` is the cheap pre-flight shape — SELECT theater_id, sector_code,
 * count(*) FROM dc_daily_theme WHERE season_id IS NULL — so only the Theater and
 * Sector exclusion axes can be applied here. THREAD exclusions are not visible
 * in a count, which makes this check conservative: it never reports a quota that
 * is in fact fillable, but a Theater emptied purely by thread exclusions is
 * caught by the worker (allocateThemeCalendar), which holds the whole rows and
 * is the authority.
 *
 * @param {{mixRows: object[], corpusCounts: {theater_id: string, sector_code: string|null, count: number|string}[], dayCount?: number}} input
 * @returns {{theater_id: string, sector_code: string|null, key: string}[]}
 */
export function unfillableThemeQuotas(input) {
  const mixRows = Array.isArray(input?.mixRows) ? input.mixRows : [];
  const counts = Array.isArray(input?.corpusCounts) ? input.corpusCounts : [];
  const dayCount = Number.isFinite(input?.dayCount) ? Math.max(0, Math.trunc(input.dayCount)) : 0;
  if (!mixRows.length || !counts.length) return [];

  const ex = themeExclusions(mixRows);
  const byTheater = new Map();
  const byPair = new Map();
  for (const c of counts) {
    const n = Number(c.count) || 0;
    if (n <= 0) continue;
    if (ex.theaters.has(c.theater_id) || ex.sectors.has(c.sector_code)) continue;
    byTheater.set(c.theater_id, (byTheater.get(c.theater_id) ?? 0) + n);
    byPair.set(`${c.theater_id}|${c.sector_code ?? ""}`, (byPair.get(`${c.theater_id}|${c.sector_code ?? ""}`) ?? 0) + n);
  }

  const { theaters, sectors } = themeQuotas(mixRows, dayCount);
  const out = [];
  for (const t of theaters) {
    if (t.days <= 0 && t.target_pct <= 0) continue;
    if ((byTheater.get(t.theater_id) ?? 0) === 0) {
      out.push({ theater_id: t.theater_id, sector_code: null, key: themeUnfillableKey(t.theater_id) });
      continue; // its sectors are unfillable for the same reason; say it once
    }
    for (const s of sectors.get(t.theater_id) ?? []) {
      if (s.days <= 0 && s.target_pct <= 0) continue;
      if ((byPair.get(`${t.theater_id}|${s.sector_code}`) ?? 0) === 0)
        out.push({ theater_id: t.theater_id, sector_code: s.sector_code, key: themeUnfillableKey(t.theater_id) });
    }
  }
  return out;
}

// ── the allocator ────────────────────────────────────────────────────────────

/**
 * Build the season theme calendar: one corpus row per season date, honouring
 * the configured mix (D2), the exclusions (D3) and the spread rule (D5).
 *
 * @param {{dates: string[], corpusRows: object[], mixRows: object[], seed?: string}} input
 *   `corpusRows` are the season_id IS NULL rows, each with at least
 *   `{id, theater_id, sector_code, thread_codes}`; nothing else is read here.
 * @returns {{date: string, sourceId: string, theater_id: string, sector_code: string}[]}
 *   in date order — the caller maps sourceId back to the row it inserts.
 * @throws {ThemeAllocationError} when an included Theater/Sector has no
 *   eligible corpus row at all (D7), or when no theme mix is configured.
 */
export function allocateThemeCalendar(input) {
  const dates = Array.isArray(input?.dates) ? input.dates : [];
  const corpusRows = Array.isArray(input?.corpusRows) ? input.corpusRows : [];
  const mixRows = Array.isArray(input?.mixRows) ? input.mixRows : [];
  const seed = String(input?.seed ?? "");
  if (dates.length === 0) return [];

  const ex = themeExclusions(mixRows);
  const quotas = themeQuotas(mixRows, dates.length);
  if (quotas.theaters.length === 0)
    throw new ThemeAllocationError("no included theme mix rows are configured", { code: "no_theme_mix" });

  // eligible corpus rows, bucketed (theater → sector → rows). Row ORDER inside
  // a bucket is seeded, never the corpus date order (D4).
  /** @type {Map<string, Map<string, object[]>>} */
  const pool = new Map();
  for (const row of corpusRows) {
    if (!isEligible(row, ex)) continue;
    if (!pool.has(row.theater_id)) pool.set(row.theater_id, new Map());
    const sectors = pool.get(row.theater_id);
    if (!sectors.has(row.sector_code)) sectors.set(row.sector_code, []);
    sectors.get(row.sector_code).push(row);
  }
  for (const sectors of pool.values())
    for (const [code, rows] of sectors) {
      const byId = new Map(rows.map((r) => [String(r.id), r]));
      sectors.set(code, seededOrder([...byId.keys()], seed).map((id) => byId.get(id)));
    }

  // D7 — refuse to redistribute. An included quota the corpus cannot serve is
  // a configuration fault and the commissioner has to see it.
  const unfillable = [];
  for (const t of quotas.theaters) {
    const sectors = pool.get(t.theater_id);
    if (t.days <= 0 && t.target_pct <= 0) continue;
    if (!sectors || sectors.size === 0) {
      unfillable.push({ theater_id: t.theater_id, sector_code: null });
      continue;
    }
    for (const s of quotas.sectors.get(t.theater_id) ?? []) {
      if (s.days <= 0 && s.target_pct <= 0) continue;
      if (!(sectors.get(s.sector_code) ?? []).length)
        unfillable.push({ theater_id: t.theater_id, sector_code: s.sector_code });
    }
  }
  if (unfillable.length)
    throw new ThemeAllocationError(
      `theme mix cannot be filled from the corpus: ${unfillable
        .map((u) => (u.sector_code ? `${u.theater_id}/${u.sector_code}` : u.theater_id))
        .join(", ")}`,
      { unfillable }
    );

  // ── remaining-day state ───────────────────────────────────────────────────
  const remTheater = new Map(quotas.theaters.map((t) => [t.theater_id, t.days]));
  /** theater → (sector → remaining days), only for Theaters that configure sectors */
  const remSector = new Map();
  for (const [tid, secs] of quotas.sectors) remSector.set(tid, new Map(secs.map((s) => [s.sector_code, s.days])));
  /** `${theater}|${sector}` → times chosen (free rotation, D4) */
  const sectorUse = new Map();
  /** row id → { uses, last } for not-yet-used-first then LRU (D4) */
  const rowUse = new Map();

  // Seeded candidate order: every "pick the best of" below walks these arrays,
  // so a tie resolves the same way on every run and differently per season.
  const theaterOrder = seededOrder([...remTheater.keys()], seed);
  /** theater → seeded sector order */
  const sectorOrder = new Map(
    [...pool.entries()].map(([tid, secs]) => [tid, seededOrder([...secs.keys()], `${seed}|${tid}`)])
  );

  const out = [];
  let prev1 = null; // theater on day i-1
  let prev2 = null; // theater on day i-2
  let prevSector = null;

  for (const date of dates) {
    // ── theater: most days still owed, never a third day in a row (D5) ──────
    const open = theaterOrder.filter((t) => (remTheater.get(t) ?? 0) > 0);
    if (!open.length) break; // cannot happen — quotas sum to dates.length
    const blocked = prev1 && prev1 === prev2 ? prev1 : null;
    const free = open.filter((t) => t !== blocked);
    // A Theater holding more than two thirds of the season leaves nothing else
    // open; the run of 3 is arithmetic, not a bug, so take it.
    const theaterPick = (free.length ? free : open).reduce((best, t) =>
      (remTheater.get(t) ?? 0) > (remTheater.get(best) ?? 0) ? t : best
    );

    // ── sector: configured split if there is one, else least-used rotation ──
    const sectors = pool.get(theaterPick);
    const rem = remSector.get(theaterPick);
    let openSectors = sectorOrder.get(theaterPick).filter((c) => (sectors.get(c) ?? []).length > 0);
    if (rem) {
      const owed = openSectors.filter((c) => (rem.get(c) ?? 0) > 0);
      // A quota'd Theater whose sector quotas are spent (possible only when a
      // sector quota rounded to 0 days somewhere) falls back to free rotation
      // rather than dropping the day.
      if (owed.length) openSectors = owed;
    }
    const spreadable = openSectors.filter((c) => c !== prevSector);
    const sectorPool = spreadable.length ? spreadable : openSectors;
    const sectorPick =
      rem && sectorPool.some((c) => (rem.get(c) ?? 0) > 0)
        ? sectorPool.reduce((best, c) => ((rem.get(c) ?? 0) > (rem.get(best) ?? 0) ? c : best))
        : sectorPool.reduce((best, c) =>
            (sectorUse.get(`${theaterPick}|${c}`) ?? 0) < (sectorUse.get(`${theaterPick}|${best}`) ?? 0) ? c : best
          );

    // ── row: unused first, then least-recently-used (D4). Date is not read. ──
    const rows = sectors.get(sectorPick);
    let pick = rows[0];
    let pickUse = rowUse.get(String(pick.id)) ?? { uses: 0, last: -1 };
    for (const r of rows) {
      const u = rowUse.get(String(r.id)) ?? { uses: 0, last: -1 };
      if (u.uses < pickUse.uses || (u.uses === pickUse.uses && u.last < pickUse.last)) {
        pick = r;
        pickUse = u;
      }
    }

    remTheater.set(theaterPick, (remTheater.get(theaterPick) ?? 0) - 1);
    if (rem && (rem.get(sectorPick) ?? 0) > 0) rem.set(sectorPick, rem.get(sectorPick) - 1);
    sectorUse.set(`${theaterPick}|${sectorPick}`, (sectorUse.get(`${theaterPick}|${sectorPick}`) ?? 0) + 1);
    rowUse.set(String(pick.id), { uses: pickUse.uses + 1, last: out.length });

    out.push({ date, sourceId: String(pick.id), theater_id: theaterPick, sector_code: sectorPick });
    prev2 = prev1;
    prev1 = theaterPick;
    prevSector = sectorPick;
  }

  return out;
}
