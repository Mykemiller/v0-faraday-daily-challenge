// Puzzle Bank source selector (CC-DC-SUPABASE-SERVING-1.0, D6).
//
// DC_PUZZLE_SOURCE = "airtable" (default) | "supabase"
//
// Both implementations expose the same four functions with identical
// signatures and return shapes; this facade picks one PER CALL, so flipping
// the env var in Vercel is the whole cutover — no logic redeploy. Anything
// other than the exact string "supabase" (unset, empty, typo) serves the
// Airtable path, so the flag fails safe to today's behavior.
//
// The Airtable path is deleted in Phase 5 (after parity is proven and one
// rotation cycle is watched on the supabase source) — at that point this file
// collapses to a re-export of supabase-puzzle-bank.js and the flag goes away.

import * as airtableBank from "./airtable-puzzle-bank.js";
import * as supabaseBank from "./supabase-puzzle-bank.js";

// Resolved at call time (not module load) so tests and previews can vary it.
export function puzzleSource() {
  const raw = (process.env.DC_PUZZLE_SOURCE || "airtable").trim().toLowerCase();
  return raw === "supabase" ? "supabase" : "airtable";
}

function impl() {
  return puzzleSource() === "supabase" ? supabaseBank : airtableBank;
}

export const getLivePuzzles = (...args) => impl().getLivePuzzles(...args);
export const getSignalDropAnswer = (...args) => impl().getSignalDropAnswer(...args);
export const getTipOfTheDay = (...args) => impl().getTipOfTheDay(...args);
export const rotateLiveSet = (...args) => impl().rotateLiveSet(...args);

// Shared canonical list (identical in both implementations). Re-exported from
// the supabase lib so deleting the Airtable path in Phase 5 doesn't orphan
// this import.
export { PUZZLE_TYPES } from "./supabase-puzzle-bank.js";
