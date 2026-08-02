// League Playoffs — single-elimination bracket construction, as pure functions.
//
// THE structural rules for seeding and advancement. Nothing here reads a
// database or invents a result: seeds come from real regular-season standings,
// and a matchup is decided only by points already earned inside that round's
// date window. `decideMatchup` returns null whenever the outcome is not yet
// determined — an undecided matchup is a real state, never a coin flip.
//
// v1 format is single elimination by seed, with byes padding the field up to the
// next power of two. Format + qualifier count are per-season config
// (`dc_playoff_config`), so changing them is a commissioner action rather than a
// code change.

/** A qualifying participant, snapshotted at seed time. */
export type Seed = {
  /** 1-based; 1 is the best regular-season record. */
  seed: number;
  /** Team id or subscriber id, depending on the bracket's participant_kind. */
  participantId: string;
  /** Name as of seeding — snapshotted so a later rename can't rewrite history. */
  displayName: string;
  /** Regular-season points that earned the seed. */
  points: number;
};

export type DateWindow = { from: string; to: string };

export type Matchup = {
  round: number;
  /** 0-based position within the round, top to bottom of the bracket. */
  slot: number;
  seedA: number | null;
  seedB: number | null;
  /** Where the winner goes. null in the final round. */
  nextSlot: number | null;
  /** Which side of the next matchup the winner occupies. */
  nextSide: "a" | "b" | null;
  window: DateWindow;
};

/** Smallest power of two >= n (minimum 2 — a bracket needs at least one pair). */
export function bracketSize(qualifiers: number): number {
  if (qualifiers < 2) return 0;      // not a bracket
  let size = 2;
  while (size < qualifiers) size *= 2;
  return size;
}

/** Number of elimination rounds for a field of `qualifiers`. */
export function roundCount(qualifiers: number): number {
  const size = bracketSize(qualifiers);
  if (size === 0) return 0;
  return Math.log2(size);
}

/**
 * Standard single-elimination seed order for a bracket of `size`.
 *
 * Built by the classic reflection: order(2) = [1,2]; each doubling maps every
 * seed s to the pair (s, 2n+1−s). This is what makes 1 and 2 meet only in the
 * final, and gives every top seed the weakest available opponent each round.
 *
 *   size 4 → [1,4,2,3]            pairs (1,4) (2,3)
 *   size 8 → [1,8,4,5,2,7,3,6]    pairs (1,8) (4,5) (2,7) (3,6)
 */
export function seedOrder(size: number): number[] {
  if (size < 2) return [];
  let order = [1, 2];
  while (order.length < size) {
    const n = order.length * 2;
    const next: number[] = [];
    for (const s of order) {
      next.push(s, n + 1 - s);
    }
    order = next;
  }
  return order;
}

/**
 * Split a date window into `rounds` contiguous, non-overlapping sub-windows.
 *
 * Remainder days go to the EARLIEST rounds, so the later rounds are never
 * shorter than the earlier ones by more than a day and the final never gets
 * squeezed below its share. Returns null when the window cannot be split (fewer
 * days than rounds) — the caller must surface that rather than overlap rounds.
 */
export function splitWindow(window: DateWindow, rounds: number): DateWindow[] | null {
  if (rounds < 1) return null;
  const days = dayCount(window.from, window.to);
  if (days == null || days < rounds) return null;

  const base = Math.floor(days / rounds);
  const extra = days % rounds;

  const out: DateWindow[] = [];
  let cursor = window.from;
  for (let r = 0; r < rounds; r++) {
    const len = base + (r < extra ? 1 : 0);
    const to = addDays(cursor, len - 1);
    out.push({ from: cursor, to });
    cursor = addDays(to, 1);
  }
  return out;
}

/**
 * Round-1 pairings plus every later-round shell, with feed-forward wiring.
 *
 * Seeds beyond the qualifying field are absent, which makes their opponent's
 * slot a BYE: `seedB` is null and that seed advances without playing. Byes land
 * on the strongest seeds first, which is exactly what the reflection order
 * gives us for free.
 */
export function buildMatchups(qualifiers: number, windows: DateWindow[]): Matchup[] {
  const size = bracketSize(qualifiers);
  const rounds = roundCount(qualifiers);
  if (size === 0 || windows.length !== rounds) return [];

  const order = seedOrder(size);
  const out: Matchup[] = [];

  // Round 1 — pair the reflection order two at a time.
  const firstRoundSlots = size / 2;
  for (let slot = 0; slot < firstRoundSlots; slot++) {
    const a = order[slot * 2];
    const b = order[slot * 2 + 1];
    out.push({
      round: 1,
      slot,
      seedA: a <= qualifiers ? a : null,
      seedB: b <= qualifiers ? b : null,
      nextSlot: rounds > 1 ? Math.floor(slot / 2) : null,
      nextSide: rounds > 1 ? (slot % 2 === 0 ? "a" : "b") : null,
      window: windows[0],
    });
  }

  // Later rounds — participants are unknown until the prior round settles.
  for (let r = 2; r <= rounds; r++) {
    const slots = size / 2 ** r;
    for (let slot = 0; slot < slots; slot++) {
      out.push({
        round: r,
        slot,
        seedA: null,
        seedB: null,
        nextSlot: r < rounds ? Math.floor(slot / 2) : null,
        nextSide: r < rounds ? (slot % 2 === 0 ? "a" : "b") : null,
        window: windows[r - 1],
      });
    }
  }

  return out;
}

export type Side = {
  participantId: string | null;
  seed: number | null;
  /** Points earned inside this round's window. null = not yet computed. */
  points: number | null;
};

export type Decision =
  | { decided: true; winnerId: string; reason: "bye" | "points" | "seed_tiebreak" }
  | { decided: false; reason: "empty" | "window_open" | "tie_unbreakable" };

/**
 * Decide a matchup from real in-window points.
 *
 * - One side empty → the other advances on a **bye** (immediately; there is
 *   nothing to wait for).
 * - Both empty → undecided, `empty` (an upstream round has not settled).
 * - Window still open → undecided, even if one side currently leads. Playoff
 *   results are only final once the round's last day has passed.
 * - Closed window → higher points wins; a tie breaks to the **better seed**
 *   (lower number), which is what the seeding earned.
 *
 * `windowClosed` is passed in rather than computed so the caller controls the
 * clock (and tests are deterministic).
 */
export function decideMatchup(a: Side, b: Side, windowClosed: boolean): Decision {
  const aIn = a.participantId != null;
  const bIn = b.participantId != null;

  if (!aIn && !bIn) return { decided: false, reason: "empty" };
  if (aIn && !bIn) return { decided: true, winnerId: a.participantId!, reason: "bye" };
  if (!aIn && bIn) return { decided: true, winnerId: b.participantId!, reason: "bye" };

  if (!windowClosed) return { decided: false, reason: "window_open" };

  const pa = a.points ?? 0;
  const pb = b.points ?? 0;
  if (pa > pb) return { decided: true, winnerId: a.participantId!, reason: "points" };
  if (pb > pa) return { decided: true, winnerId: b.participantId!, reason: "points" };

  // Tie on points → better seed advances.
  const sa = a.seed;
  const sb = b.seed;
  if (sa != null && sb != null) {
    return sa < sb
      ? { decided: true, winnerId: a.participantId!, reason: "seed_tiebreak" }
      : { decided: true, winnerId: b.participantId!, reason: "seed_tiebreak" };
  }
  // No seed to break the tie with — refuse rather than pick arbitrarily.
  return { decided: false, reason: "tie_unbreakable" };
}

/**
 * Rank regular-season standings into seeds.
 *
 * Input must already be ordered best-first by the caller (the leaderboard RPC
 * does this). Ties are broken by the order given, which is the RPC's own
 * `MIN(played_at)` tiebreak — earliest scorer ranks higher.
 */
export function assignSeeds(
  standings: Array<{ participantId: string; displayName: string; points: number }>,
  qualifierCount: number
): Seed[] {
  return standings
    .slice(0, Math.max(0, qualifierCount))
    .map((row, i) => ({
      seed: i + 1,
      participantId: row.participantId,
      displayName: row.displayName,
      points: row.points,
    }));
}

/** Effective field size: you cannot qualify more participants than exist. */
export function effectiveQualifiers(configured: number, available: number): number {
  return Math.max(0, Math.min(configured, available));
}

// ── date helpers (kept local so this module stays dependency-free) ───────────

function dayCount(from: string, to: string): number | null {
  const a = Date.parse(from + "T12:00:00Z");
  const b = Date.parse(to + "T12:00:00Z");
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
  return Math.round((b - a) / 86_400_000) + 1;
}

function addDays(date: string, n: number): string {
  const t = new Date(date + "T12:00:00Z");
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
