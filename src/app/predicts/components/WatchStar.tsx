"use client";

import { useWatchlist } from "../hooks/useWatchlist";

// 44×44 hit area, aria-pressed, gold when watched. Stops propagation so a star
// inside a linked card never navigates.
export default function WatchStar({ id }: { id: string }) {
  const { has, toggle } = useWatchlist();
  const on = has(id);
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={on ? "Stop watching this forecast" : "Watch this forecast"}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle(id);
      }}
      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-warm-cream"
    >
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
        <path
          d="M10 2.2l2.35 4.9 5.35.62-3.95 3.67 1.05 5.3L10 14.06 5.2 16.69l1.05-5.3L2.3 7.72l5.35-.62z"
          fill={on ? "#C4922A" : "none"}
          stroke={on ? "#C4922A" : "#141210"}
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
