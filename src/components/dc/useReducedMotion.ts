"use client";
import { useEffect, useState } from "react";

/**
 * SSR-safe `prefers-reduced-motion` hook. Defaults to `false` on the server and
 * first client render, then syncs to the media query. Every DC primitive that
 * renders motion reads this so the shared components honor the user setting the
 * same way the injected `.dc-*` stylesheets already do.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener?.("change", sync);
    return () => mq.removeEventListener?.("change", sync);
  }, []);
  return reduced;
}
