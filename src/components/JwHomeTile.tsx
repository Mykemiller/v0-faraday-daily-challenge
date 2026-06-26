"use client";
// Client tile for Jurisdiction Watch on the homepage (FAR-250).
// Fires map_view consumption event with referrer=faraday-intelligence.ai on click.
import Link from "next/link";

const SUPABASE_URL = "https://ycadmmngkdhvpcsrcuaq.supabase.co";
const SESSION_KEY = "jw_session_id";

function logJwTileClick() {
  if (typeof window === "undefined") return;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!anon) return;
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) { id = crypto.randomUUID(); sessionStorage.setItem(SESSION_KEY, id); }
    fetch(`${SUPABASE_URL}/rest/v1/consumption_events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": anon,
        "Authorization": `Bearer ${anon}`,
        "Prefer": "return=minimal",
      },
      body: JSON.stringify({ session_id: id, event_type: "map_view", referrer: "faraday-intelligence.ai" }),
    }).catch(() => {});
  } catch {
    // never block navigation
  }
}

export function JwHomeTile() {
  return (
    <Link
      href="/jurisdiction-watch"
      onClick={logJwTileClick}
      className="group flex h-full flex-col rounded-xl border border-warm-gray bg-warm-white p-5 transition-colors hover:border-gold focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-serif font-semibold text-near-black text-[17px]">Jurisdiction Watch</span>
        <span className="shrink-0 font-mono text-[11px] uppercase tracking-[0.1em] text-amber-dark">Metered</span>
      </div>
      <p className="mt-2 font-sans leading-relaxed text-near-black/70 text-[13px]">
        Jurisdiction-level posture and permitting risk on a live choropleth.
      </p>
      <span className="mt-3 font-mono text-[11px] uppercase tracking-[0.1em] text-amber-dark group-hover:text-gold">Open →</span>
    </Link>
  );
}
