"use client";

import { useState } from "react";
import { voteCountLine, type Votes } from "@/lib/predicts-v3";
import { useVotes } from "../hooks/useVotes";

// Agree / Disagree — an opinion tap, never a stake. Hidden entirely when the
// API says votes are unavailable. Counts show only once ≥5 people weighed in.

type Props = { id: string; votes: Votes | null | undefined; voteUrl: string; enabled: boolean };

export default function VotePills({ id, votes, voteUrl, enabled }: Props) {
  const { mine, countsFor, vote, unavailable } = useVotes(voteUrl);
  const [toast, setToast] = useState<string | null>(null);
  if (!enabled || unavailable) return null;
  const current = countsFor(id, votes);
  const my = mine[id];

  const tap = async (e: React.MouseEvent, choice: "agree" | "disagree") => {
    e.preventDefault();
    e.stopPropagation();
    const res = await vote(id, choice, current);
    if (res === "rate_limited") setToast("Easy — try again in a bit");
    else if (res === "error") setToast("That didn't go through — try again");
    else setToast(null);
  };

  const pill = (choice: "agree" | "disagree", label: string) => (
    <button
      type="button"
      aria-pressed={my === choice}
      onClick={(e) => tap(e, choice)}
      className={`min-h-[44px] rounded-full border px-4 font-sans text-[14px] font-medium transition-colors duration-200 ${
        my === choice
          ? "border-forest bg-forest text-warm-white"
          : "border-cream-border bg-warm-white text-near-black hover:border-forest"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      {pill("agree", "Agree")}
      {pill("disagree", "Disagree")}
      <span className="font-mono text-[12px] text-sage-dark" aria-live="polite">
        {voteCountLine(current)}
      </span>
      {toast && (
        <span role="status" className="rounded-md bg-near-black px-2 py-1 font-sans text-[13px] text-warm-white">
          {toast}
        </span>
      )}
    </div>
  );
}
