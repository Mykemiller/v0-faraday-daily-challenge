"use client";

import { useState } from "react";
import { shortDate, type HistoryChange } from "@/lib/predicts-v3";

// Dated changes in Faraday's published probability, newest first.
export default function ChangesTable({ changes }: { changes: HistoryChange[] }) {
  const [all, setAll] = useState(false);
  if (!changes.length) return null;
  const newest = [...changes].reverse();
  const shown = all ? newest : newest.slice(0, 8);
  return (
    <div>
      <table className="w-full border-collapse font-sans text-[14px]">
        <caption className="sr-only">Changes in Faraday’s probability</caption>
        <thead>
          <tr className="border-b border-cream-border text-left text-near-black/70">
            <th scope="col" className="py-2 font-medium">Date</th>
            <th scope="col" className="py-2 font-medium">From</th>
            <th scope="col" className="py-2 font-medium">To</th>
            <th scope="col" className="py-2 font-medium">Change</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((c) => (
            <tr key={c.date} className="border-b border-cream-line">
              <td className="py-2 font-mono">{shortDate(c.date)}</td>
              <td className="py-2 font-mono">{c.from}%</td>
              <td className="py-2 font-mono">{c.to}%</td>
              <td className="py-2 font-mono">{c.delta > 0 ? `▲ ${c.delta}` : `▼ ${Math.abs(c.delta)}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {changes.length > 8 && (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-2 min-h-[44px] font-sans text-[14px] font-medium text-forest underline">
          {all ? "Show fewer" : `Show all ${changes.length} changes`}
        </button>
      )}
    </div>
  );
}
