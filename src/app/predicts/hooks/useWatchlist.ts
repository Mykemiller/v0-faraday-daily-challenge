"use client";

import { useCallback, useSyncExternalStore } from "react";
import { parseWatchlist, toggleWatch, WATCH_KEY } from "@/lib/predicts-v3";

// Device-local watchlist (localStorage faraday_predicts_watch). Every storage
// access is wrapped: private mode / blocked storage must never break the page.
// Cross-tab sync via the `storage` event; same-tab sync via a local event.

const EVT = "faraday-predicts-watch";
const EMPTY: string[] = [];
let cacheRaw: string | null = null;
let cacheVal: string[] = EMPTY;

function read(): string[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(WATCH_KEY);
  } catch {
    raw = null;
  }
  if (raw !== cacheRaw) {
    cacheRaw = raw;
    cacheVal = parseWatchlist(raw);
  }
  return cacheVal;
}

function subscribe(cb: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === WATCH_KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(EVT, cb);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(EVT, cb);
  };
}

export function useWatchlist() {
  const list = useSyncExternalStore(subscribe, read, () => EMPTY);
  const toggle = useCallback((id: string) => {
    const next = toggleWatch(read(), id);
    try {
      window.localStorage.setItem(WATCH_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable — the star simply does not persist */
    }
    window.dispatchEvent(new Event(EVT));
  }, []);
  const has = useCallback((id: string) => list.includes(id), [list]);
  return { list, has, toggle };
}
