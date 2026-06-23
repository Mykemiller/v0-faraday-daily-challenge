"use client";

import { useState } from "react";
import { SESSION_STORAGE_KEY } from "@/lib/supabase";

// CC-06 / FAR-29 — Live Agent: retrieval-grounded subscriber Q&A widget.
// Talks to /api/live-agent. Every answer is grounded in the artifact corpus and
// shows its citations; when the corpus lacks coverage the agent declines rather
// than guessing. Entitlement + the 1-token charge are enforced server-side — the
// client never sees or trusts a balance (FAR-46: meter values stay unpublished),
// it only renders gating messages the server returns.

interface Citation {
  n: number;
  title: string;
  source: string;
  url: string;
  published_at: string | null;
}

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "answer"; answer: string; citations: Citation[]; grounded: boolean }
  | { kind: "error"; message: string; canRetry: boolean };

const GATE_MESSAGES: Record<string, string> = {
  signin: "Sign in with your Faraday subscriber email to ask the Live Agent.",
  not_entitled:
    "Live Agent is part of a paid Faraday plan. Upgrade to put the analyst on call.",
  insufficient_tokens:
    "You've used your Live Agent allowance for this cycle. It refreshes next month.",
};

export default function LiveAgent() {
  const [q, setQ] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  // Stable per-submission id → a retry after a transient upstream error never
  // double-charges (the server's debit is idempotent on request_id).
  const [requestId, setRequestId] = useState<string | null>(null);

  async function ask(retry = false) {
    const question = q.trim();
    if (!question || state.kind === "loading") return;

    const token =
      typeof window !== "undefined"
        ? window.localStorage.getItem(SESSION_STORAGE_KEY)
        : null;
    if (!token) {
      setState({ kind: "error", message: GATE_MESSAGES.signin, canRetry: false });
      return;
    }

    const rid = retry && requestId ? requestId : crypto.randomUUID();
    if (!retry) setRequestId(rid);
    setState({ kind: "loading" });

    try {
      const res = await fetch("/api/live-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: question, token, request_id: rid }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.status === 401) {
        setState({ kind: "error", message: GATE_MESSAGES.signin, canRetry: false });
        return;
      }
      if (!res.ok) {
        const gate = data?.reason && GATE_MESSAGES[data.reason];
        setState({
          kind: "error",
          message: gate || "Something went wrong. Please try again.",
          canRetry: res.status === 502,
        });
        return;
      }
      setState({
        kind: "answer",
        answer: data.answer ?? "",
        citations: Array.isArray(data.citations) ? data.citations : [],
        grounded: data.grounded !== false,
      });
    } catch {
      setState({
        kind: "error",
        message: "Network error. Please try again.",
        canRetry: true,
      });
    }
  }

  return (
    <div className="rounded-xl border border-gold/35 bg-forest p-6">
      <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-gold-light">
        Live Agent — grounded data center intelligence
      </div>

      <div className="mt-3 flex overflow-hidden rounded-md border border-gold/35 bg-white/5 focus-within:border-gold/70">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ask()}
          maxLength={500}
          aria-label="Ask the Live Agent a question"
          placeholder="Ask about power, chips, hyperscaler moves, M&A, jurisdictions…"
          className="min-w-0 flex-1 bg-transparent px-5 py-3.5 font-sans text-[15px] text-warm-white placeholder:italic placeholder:text-sage/50 focus:outline-none"
        />
        <button
          onClick={() => ask()}
          disabled={state.kind === "loading" || !q.trim()}
          className="shrink-0 bg-gold px-5 font-mono text-[12px] font-medium text-near-black transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {state.kind === "loading" ? "…" : "ASK →"}
        </button>
      </div>

      <p className="mt-2 font-mono text-[10px] text-sage/60">
        Answers are grounded in Faraday&apos;s intelligence corpus and cited. The agent
        declines when the corpus doesn&apos;t cover your question — it never guesses.
      </p>

      {state.kind === "loading" && (
        <ResultCard>
          <p className="font-sans text-[14px] text-warm-cream">Retrieving and grounding…</p>
        </ResultCard>
      )}

      {state.kind === "error" && (
        <ResultCard>
          <p className="font-sans text-[14px] text-warm-cream">{state.message}</p>
          {state.canRetry && (
            <button
              onClick={() => ask(true)}
              className="mt-3 rounded border border-gold/40 px-3 py-1 font-mono text-[11px] text-gold-light hover:bg-gold/10"
            >
              Retry
            </button>
          )}
        </ResultCard>
      )}

      {state.kind === "answer" && (
        <ResultCard>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-gold-light">
              ✦ Faraday
            </span>
            <span
              className={`rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] ${
                state.grounded
                  ? "bg-gold/15 text-gold-light"
                  : "bg-white/10 text-sage/80"
              }`}
            >
              {state.grounded
                ? `Grounded · ${state.citations.length} source${state.citations.length === 1 ? "" : "s"}`
                : "Not in corpus"}
            </span>
          </div>

          <p className="mt-2 whitespace-pre-wrap font-sans text-[14px] leading-relaxed text-warm-cream">
            {state.answer}
          </p>

          {state.citations.length > 0 && (
            <ol className="mt-4 space-y-1.5 border-t border-gold/20 pt-3">
              {state.citations.map((c) => (
                <li key={c.n} className="font-sans text-[12px] leading-snug text-sage">
                  <span className="font-mono text-gold-light">[{c.n}]</span>{" "}
                  <a
                    href={c.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-warm-cream underline decoration-gold/40 underline-offset-2 hover:decoration-gold"
                  >
                    {c.title}
                  </a>
                  <span className="text-sage/70">
                    {" "}
                    — {c.source || "source"}
                    {c.published_at ? ` · ${c.published_at.slice(0, 10)}` : ""}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </ResultCard>
      )}
    </div>
  );
}

function ResultCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 rounded-md border border-gold/20 bg-white/5 p-4">{children}</div>
  );
}
