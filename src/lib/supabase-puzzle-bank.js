// Supabase Puzzle Bank client for the Faraday Daily Challenge
// (CC-DC-SUPABASE-SERVING-1.0 — the successor to airtable-puzzle-bank.js).
//
// SERVER-SIDE ONLY. This module reads SUPABASE_SERVICE_ROLE_KEY from the
// environment — never import it into a client component or the key will be
// bundled and leaked. All access must go through the /api route handlers.
//
// Source of record: public.dc_puzzle_bank_staging in project ycadmmngkdhvpcsrcuaq
// (RLS deny-all; the service role is the only reader/writer — D5: no anon
// policy, ever, because rows carry answer_key and pre-solve answers).
//
// The "live set" is the rows whose `published` column equals "Live" (one row
// per puzzle type per day). `puzzle_content` is JSONB — PostgREST returns it
// already parsed; never JSON.parse it.
//
// Publish state machine (published column, identical to the Airtable bank):
// Unpublished → Published → Live → Retired. Draft rows reach Published only
// via fn_dc_approve_puzzles (D4); the rotator (AUTO-128, /api/cron/rotate)
// calls fn_dc_rotate_live_set — ONE transaction for promote+retire (D3).
//
// Exports mirror airtable-puzzle-bank.js exactly (same names, signatures and
// return shapes) so call sites switch by a one-line import swap — see
// src/lib/puzzle-bank.js for the DC_PUZZLE_SOURCE selector.

import { toPublicSignalPuzzle, normalizeWord } from "./signal-drop.js";

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://ycadmmngkdhvpcsrcuaq.supabase.co";

export const PUZZLE_BANK_TABLE = "dc_puzzle_bank_staging";

// Canonical puzzle types, matching the game component keys exactly.
export const PUZZLE_TYPES = [
  "Rackl",
  "Signal Drop",
  "The Stack",
  "Circuit",
  "The Brief",
  "Dark Fiber",
  "Frequency",
];

// Columns the serving read selects. answer_key is deliberately ABSENT — it is
// a plaintext answer column and must never be selected into anything that can
// reach a client-facing payload. (Signal Drop's in-content `word` is stripped
// separately via toPublicSignalPuzzle below.)
const SERVE_COLUMNS = "puzzle_type,puzzle_content,public_id";

class SupabaseConfigError extends Error {}

function getServiceKey() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new SupabaseConfigError(
      "SUPABASE_SERVICE_ROLE_KEY is not set — the Puzzle Bank staging table is " +
        "deny-all RLS and can only be read with the service role."
    );
  }
  return key;
}

// Low-level: fetch the Live rows. Same caching contract as the Airtable
// helper: puzzles change at most daily, so serving reads let the platform
// cache for an hour; the rotator passes noStore so its reads (none today, but
// kept for parity) always see current state.
async function fetchLiveRows({ noStore = false } = {}) {
  const key = getServiceKey();
  const url =
    `${SUPABASE_URL}/rest/v1/${PUZZLE_BANK_TABLE}` +
    `?published=eq.Live&select=${SERVE_COLUMNS}&order=go_live_date.desc`;
  const res = await fetch(url, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    ...(noStore ? { cache: "no-store" } : { next: { revalidate: 3600 } }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Supabase puzzle-bank request failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const rows = await res.json();
  return Array.isArray(rows) ? rows : [];
}

// Fetch the live puzzle set: rows with published = "Live", one usable puzzle
// per type. Returns an object keyed by puzzle type, e.g.
//   { "Rackl": {...}, "Signal Drop": {...}, ... }
// Each puzzle object also carries `__publicId` (null when unset) so the share
// card can deep-link the shared result to the exact puzzle. Types whose row is
// missing or unusable are omitted — the component falls back to its built-in
// mock for that single game. Identical shape to the Airtable getLivePuzzles.
export async function getLivePuzzles() {
  const rows = await fetchLiveRows();
  const puzzles = {};
  for (const row of rows) {
    const type = row?.puzzle_type;
    if (!type || !PUZZLE_TYPES.includes(type)) continue;
    // First valid row per type wins; don't clobber with a later empty one.
    if (puzzles[type]) continue;
    const content = row.puzzle_content; // JSONB — already parsed, do NOT JSON.parse
    if (!content) continue;
    const rawId = row.public_id;
    const publicId = typeof rawId === "string" && rawId.trim() ? rawId.trim() : null;
    // Signal Drop's `word` (and its mirror `name`) IS the answer. Never ship it
    // to the browser pre-solve — strip it here, the single choke point between
    // the bank and the client. Guesses are validated server-side via
    // /api/challenge/guess (which reads the answer through getSignalDropAnswer).
    const clientContent =
      type === "Signal Drop" ? toPublicSignalPuzzle(content) : content;
    puzzles[type] = { ...clientContent, __publicId: publicId };
  }
  return puzzles;
}

// SERVER-SIDE ONLY. Return the plaintext answer for today's live Signal Drop
// puzzle, so /api/challenge/guess can validate a guess without the answer ever
// reaching the client. When `publicId` is given, the exact live row is matched
// (so a guess is scored against the puzzle the player is actually looking at);
// otherwise the current live Signal Drop is used. Returns
// { word, publicId, wordLength } or null when no live Signal Drop exists.
export async function getSignalDropAnswer({ publicId } = {}) {
  const rows = await fetchLiveRows();
  const wanted = typeof publicId === "string" && publicId.trim() ? publicId.trim() : null;
  let fallback = null;
  for (const row of rows) {
    if (row?.puzzle_type !== "Signal Drop") continue;
    const word = normalizeWord(row.puzzle_content?.word);
    if (!word) continue;
    const rawId = row.public_id;
    const pid = typeof rawId === "string" && rawId.trim() ? rawId.trim() : null;
    const entry = { word, publicId: pid, wordLength: word.length };
    if (wanted && pid === wanted) return entry; // exact match wins
    if (!fallback) fallback = entry;
  }
  return fallback;
}

// Tip of the Day. Same seam as the Airtable helper — no tips source exists, so
// the component falls back to its built-in tip.
export async function getTipOfTheDay() {
  return null;
}

// Kept for structured cron-route logging. With the transactional rotator the
// promote/retire halves can no longer fail independently, so `step` is always
// "rotate" — the partial-failure diagnosis the Airtable version needed is gone.
export class RotationError extends Error {
  constructor(step, recordIds, cause) {
    super(`Rotation step "${step}" failed: ${cause?.message || cause}`);
    this.name = "RotationError";
    this.step = step;
    this.recordIds = recordIds;
    this.cause = cause;
  }
}

// Daily rotation (AUTO-128). One RPC, one transaction (D3):
//   promote: published = 'Published' AND go_live_date = today  → 'Live'
//   retire:  published = 'Live'      AND go_live_date < today  → 'Retired'
// Idempotent — a same-day re-run promotes and retires nothing (the 06:00-UTC
// safety re-run stays a safe no-op). Returns the same summary object the
// Airtable rotateLiveSet returned.
export async function rotateLiveSet(todayISO) {
  const key = getServiceKey();
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/fn_dc_rotate_live_set`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
      body: JSON.stringify({ p_today: todayISO }),
    });
  } catch (cause) {
    throw new RotationError("rotate", [], cause);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new RotationError("rotate", [], new Error(`fn_dc_rotate_live_set ${res.status}: ${body.slice(0, 300)}`));
  }
  const result = await res.json();
  return {
    promoted: Number(result?.promoted) || 0,
    retired: Number(result?.retired) || 0,
    promotedIds: Array.isArray(result?.promoted_ids) ? result.promoted_ids : [],
    retiredIds: Array.isArray(result?.retired_ids) ? result.retired_ids : [],
    liveTypes: Array.isArray(result?.live_types) ? result.live_types : [],
    missingTypes: Array.isArray(result?.missing_types) ? result.missing_types : [],
  };
}
