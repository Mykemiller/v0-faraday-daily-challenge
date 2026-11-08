"use client";

import { useMemo } from "react";
import { groupByThread, matchesOpenState, resolvingSoon, todayCentral, type OpenState, type V3Row } from "@/lib/predicts-v3";

// The Open board's derived data: filter → group into Thread cards → rails.
// Pure functions from predicts-v3; this hook only memoises them.
export function usePredictsData(rows: V3Row[], state: OpenState, watched: readonly string[]) {
  return useMemo(() => {
    const set = new Set(watched);
    const filtered = rows.filter((r) => matchesOpenState(r, state, set));
    const groups = groupByThread(filtered, state.sort);
    const soon = resolvingSoon(rows, todayCentral()).slice(0, 12);
    return { filtered, groups, soon };
  }, [rows, state, watched]);
}
