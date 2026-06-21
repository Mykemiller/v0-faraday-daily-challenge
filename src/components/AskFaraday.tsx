"use client";

import { useState } from "react";

// Ask Faraday — conversational intelligence widget, server-backed via /api/ask.
// (The brand site called Anthropic from the browser with no key; this routes
// through the server instead.) Lives at the bottom of the homepage.
export default function AskFaraday() {
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  async function ask() {
    const question = q.trim();
    if (!question || loading) return;
    setLoading(true);
    setError(false);
    setAnswer(null);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: question }),
      });
      const data = await res.json();
      if (!res.ok || !data.answer) throw new Error(data.error || "no answer");
      setAnswer(data.answer);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-gold/35 bg-forest p-6">
      <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-gold-light">
        Ask Faraday — data center intelligence
      </div>
      <div className="mt-3 flex overflow-hidden rounded-md border border-gold/35 bg-white/5 focus-within:border-gold/70">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ask()}
          maxLength={200}
          aria-label="Ask Faraday a question"
          placeholder="Ask about power, chips, hyperscaler moves, jurisdictions…"
          className="min-w-0 flex-1 bg-transparent px-5 py-3.5 font-sans text-[15px] text-warm-white placeholder:italic placeholder:text-sage/50 focus:outline-none"
        />
        <button
          onClick={ask}
          disabled={loading || !q.trim()}
          className="shrink-0 bg-gold px-5 font-mono text-[12px] font-medium text-near-black transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {loading ? "…" : "ASK →"}
        </button>
      </div>
      {(answer || error || loading) && (
        <div className="mt-4 rounded-md border border-gold/20 bg-white/5 p-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-gold-light">✦ Faraday</div>
          <p className="mt-2 font-sans text-[14px] leading-relaxed text-warm-cream">
            {loading ? "Thinking…" : error ? "Something went wrong. Please try again." : answer}
          </p>
        </div>
      )}
    </div>
  );
}
