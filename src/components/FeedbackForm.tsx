"use client";

// Shared submit form for /help/report-a-bug (type="bug") and /help/feedback
// (type="idea"). Posts to /api/feedback, which emails via Resend (FAR-408).
// No auth — a public contact form. Optional email so we can reply.

import { useState } from "react";

export default function FeedbackForm({
  type,
  placeholder,
  cta,
}: {
  type: "bug" | "idea";
  placeholder: string;
  cta: string;
}) {
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (message.trim().length < 3 || state === "sending") return;
    setState("sending");
    setErr("");
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          message: message.trim(),
          email: email.trim() || undefined,
          path: typeof window !== "undefined" ? window.location.pathname : undefined,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(d?.error || "Could not send — please try again.");
        setState("idle");
        return;
      }
      setState("sent");
      setMessage("");
      setEmail("");
    } catch {
      setErr("Network error — please try again.");
      setState("idle");
    }
  }

  if (state === "sent") {
    return (
      <div className="mt-8 rounded-lg border border-green-700/30 bg-green-50 px-5 py-6 text-center">
        <p className="font-serif text-lg font-bold text-forest">Thank you — got it.</p>
        <p className="mt-1 text-[14px] text-near-black/70">
          {type === "bug"
            ? "We'll take a look. If you left an email, we may follow up."
            : "We read every note. If you left an email, we may follow up."}
        </p>
        <button
          type="button"
          onClick={() => setState("idle")}
          className="mt-4 rounded border border-forest/20 px-4 py-2 font-mono text-[12px] text-forest hover:border-forest/40"
        >
          Send another
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-4">
      <div>
        <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.14em] text-near-black/40">
          {type === "bug" ? "What went wrong?" : "What's on your mind?"}
        </label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={placeholder}
          rows={6}
          maxLength={4000}
          className="w-full resize-y rounded-lg border border-forest/20 bg-white px-4 py-3 text-[14px] leading-relaxed text-near-black outline-none focus:border-gold"
        />
      </div>
      <div>
        <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.14em] text-near-black/40">
          Email (optional — so we can reply)
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          maxLength={200}
          className="w-full rounded-lg border border-forest/20 bg-white px-4 py-2.5 font-mono text-[13px] text-near-black outline-none focus:border-gold"
        />
      </div>
      {err && <p className="font-mono text-[12px] text-red-600">{err}</p>}
      <button
        type="submit"
        disabled={message.trim().length < 3 || state === "sending"}
        className="rounded-lg border border-gold/50 bg-gold/10 px-5 py-2.5 font-mono text-[13px] text-forest transition-colors hover:bg-gold/20 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {state === "sending" ? "Sending…" : cta}
      </button>
    </form>
  );
}
