"use client";

import { useCallback, useSyncExternalStore } from "react";
import { applyVote, parseMyVotes, VOTES_KEY, type MyVotes, type VoteChoice, type Votes } from "@/lib/predicts-v3";

// Agree / disagree: an opinion tap, never a stake. Own votes live on this device
// (localStorage faraday_predicts_votes); counts update optimistically and are
// then replaced by the server's. 429 → a gentle toast; 503 → pills hide.

const EVT = "faraday-predicts-votes";
const EMPTY: MyVotes = {};
let cacheRaw: string | null = null;
let cacheVal: MyVotes = EMPTY;

function read(): MyVotes {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(VOTES_KEY);
  } catch {
    raw = null;
  }
  if (raw !== cacheRaw) {
    cacheRaw = raw;
    cacheVal = parseMyVotes(raw);
  }
  return cacheVal;
}

function write(v: MyVotes) {
  try {
    window.localStorage.setItem(VOTES_KEY, JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
  window.dispatchEvent(new Event(EVT));
}

function subscribe(cb: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === VOTES_KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(EVT, cb);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(EVT, cb);
  };
}

// Server-confirmed / optimistic counts, shared across cards in this tab.
const counts = new Map<string, Votes>();
const COUNTS_EVT = "faraday-predicts-vote-counts";
let countsVersion = 0;
let unavailable = false;

function setCounts(id: string, v: Votes) {
  counts.set(id, v);
  countsVersion++;
  window.dispatchEvent(new Event(COUNTS_EVT));
}

function subscribeCounts(cb: () => void): () => void {
  window.addEventListener(COUNTS_EVT, cb);
  return () => window.removeEventListener(COUNTS_EVT, cb);
}

export type VoteResult = "ok" | "rate_limited" | "unavailable" | "error";

export function useVotes(voteUrl: string) {
  const mine = useSyncExternalStore(subscribe, read, () => EMPTY);
  const version = useSyncExternalStore(subscribeCounts, () => countsVersion, () => 0);

  const countsFor = useCallback(
    (id: string, fallback: Votes | null | undefined): Votes | null => {
      void version;
      return counts.get(id) ?? fallback ?? null;
    },
    [version],
  );

  const vote = useCallback(
    async (id: string, choice: VoteChoice, base: Votes | null | undefined): Promise<VoteResult> => {
      const prev = read()[id];
      if (prev === choice) return "ok";
      const before = counts.get(id) ?? base ?? { agree: 0, disagree: 0 };
      setCounts(id, applyVote(before, prev, choice));
      write({ ...read(), [id]: choice });
      try {
        const r = await fetch(voteUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prediction_id: id, vote: choice }),
        });
        if (r.ok) {
          const d = await r.json();
          if (typeof d?.agree === "number" && typeof d?.disagree === "number") {
            setCounts(id, { agree: d.agree, disagree: d.disagree });
          }
          return "ok";
        }
        // roll back the optimistic tap
        setCounts(id, before);
        const restored = { ...read() };
        if (prev) restored[id] = prev;
        else delete restored[id];
        write(restored);
        if (r.status === 429) return "rate_limited";
        if (r.status === 503) {
          unavailable = true;
          window.dispatchEvent(new Event(COUNTS_EVT));
          return "unavailable";
        }
        return "error";
      } catch {
        setCounts(id, before);
        return "error";
      }
    },
    [voteUrl],
  );

  const isUnavailable = version >= 0 && unavailable;
  return { mine, countsFor, vote, unavailable: isUnavailable };
}
