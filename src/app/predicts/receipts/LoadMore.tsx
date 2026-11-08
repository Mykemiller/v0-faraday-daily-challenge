"use client";

import { useState } from "react";
import type { V3Row } from "@/lib/predicts-v3";
import ReceiptCard from "../components/ReceiptCard";

// Appends the next page from the API. The link underneath works without JS.
export default function LoadMore({ apiUrl, query, cursor, fallbackHref }: { apiUrl: string; query: string; cursor: string; fallbackHref: string }) {
  const [rows, setRows] = useState<V3Row[]>([]);
  const [next, setNext] = useState<string | null>(cursor);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function more(e: React.MouseEvent) {
    e.preventDefault();
    if (!next || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const r = await fetch(`${apiUrl}?${query}&cursor=${encodeURIComponent(next)}`);
      const data = await r.json();
      if (!r.ok || !data?.ok) throw new Error("bad");
      setRows((x) => [...x, ...(data.predictions ?? [])]);
      setNext(data.next_cursor ?? null);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {rows.length > 0 && (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {rows.map((r) => (
            <ReceiptCard key={r.prediction_id} row={r} />
          ))}
        </div>
      )}
      {next && (
        <div className="mt-6 text-center">
          <a href={fallbackHref} onClick={more} aria-busy={busy} className="inline-flex min-h-[44px] items-center rounded-full border border-forest px-5 font-sans text-[15px] font-medium text-forest hover:bg-warm-cream">
            {busy ? "Loading…" : "Load more"}
          </a>
          {failed && <p role="status" className="mt-2 font-sans text-[13px] text-brick">Couldn’t load more just now. Try again.</p>}
        </div>
      )}
    </>
  );
}
