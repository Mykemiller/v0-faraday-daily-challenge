"use client";

// New Message: debounced handle search, keyboard navigable
// (CC-DC-MESSAGING-1.0; extracted from MessagesApp.tsx in CC-DC-MSG-DOCK-1.0
// so the /messages inbox and the masthead message dock embed the identical
// directory search).

import { useEffect, useState } from "react";
import { type DirectoryHit } from "./client";

export const SEARCH_DEBOUNCE_MS = 300;

export default function NewMessageSearch({
  token,
  onPick,
}: {
  token: string;
  onPick: (hit: DirectoryHit) => void;
}) {
  const [q, setQ] = useState("");
  // Results are keyed to the query that produced them — stale results (from a
  // previous query, or after clearing the input) simply stop rendering instead
  // of being reset with setState inside the effect.
  const [result, setResult] = useState<{ q: string; hits: DirectoryHit[] } | null>(null);
  const [sel, setSel] = useState(0);

  const query = q.trim();
  const active = query.length >= 2;
  const searched = active && result?.q === query;
  const hits = searched ? result.hits : [];

  useEffect(() => {
    if (!active) return;
    const id = setTimeout(async () => {
      try {
        const r = await fetch(
          `/api/messages/directory?token=${encodeURIComponent(token)}&q=${encodeURIComponent(query)}`
        );
        const j = r.ok ? await r.json() : [];
        setResult({ q: query, hits: Array.isArray(j) ? j : [] });
        setSel(0);
      } catch {
        setResult({ q: query, hits: [] });
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [active, query, token]);

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel(s => Math.min(s + 1, hits.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel(s => Math.max(s - 1, 0)); }
    else if (e.key === "Enter" && hits[sel]) { e.preventDefault(); onPick(hits[sel]); }
  }

  return (
    <div className="border-y border-forest/10 bg-warm-cream/40 px-4 py-3">
      <label htmlFor="dc-msg-search" className="font-mono text-[10px] uppercase tracking-widest text-near-black/45">
        To: search players by handle
      </label>
      <input
        id="dc-msg-search"
        autoFocus
        value={q}
        onChange={e => setQ(e.target.value)}
        onKeyDown={onKey}
        placeholder="@handle (min 2 characters)"
        role="combobox"
        aria-expanded={hits.length > 0}
        aria-controls="dc-msg-search-results"
        aria-activedescendant={hits[sel] ? `dc-msg-hit-${hits[sel].subscriber_id}` : undefined}
        className="mt-1.5 w-full rounded border border-forest/20 bg-white px-2.5 py-1.5 font-mono text-sm text-near-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-gold"
      />
      <div id="dc-msg-search-results" role="listbox" aria-label="Matching players">
        {hits.map((h, i) => (
          <button
            key={h.subscriber_id}
            id={`dc-msg-hit-${h.subscriber_id}`}
            type="button"
            role="option"
            aria-selected={i === sel}
            onMouseEnter={() => setSel(i)}
            onClick={() => onPick(h)}
            className={`mt-1 block w-full rounded px-2.5 py-1.5 text-left font-mono text-sm text-near-black hover:bg-gold/15 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold ${
              i === sel ? "bg-gold/15" : ""
            }`}
          >
            @{h.handle}
          </button>
        ))}
        {searched && hits.length === 0 && (
          <p className="mt-1.5 text-xs text-near-black/50">No players match that handle.</p>
        )}
      </div>
    </div>
  );
}
