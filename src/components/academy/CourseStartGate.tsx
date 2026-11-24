"use client";
// Faraday Academy — the daily course allowance on the lesson page (FDY-392).
//
// On every lesson load this asks /api/academy/start, which records the course as
// started for today on the server (service role, usage_consume). Lessons of a
// course already started today come back allowed at no cost.
//
// Why a client gate and not a server render check: the lesson route is ISR
// (revalidate 300) and indexed for search. Reading cookies or headers in the page
// would opt every lesson out of the cache, and blocking in the server render
// would hide lessons from crawlers too. So the lesson HTML stays as it is and the
// verdict decides, in the reader's browser, whether the reader sees the lesson
// or the notice. The COUNT is server-side; only the display is here.
//
// Optimistic: the lesson shows while the check is in flight, because almost every
// load is allowed. Fails closed (D8): an error, a non-OK answer or no answer
// within CLIENT_TIMEOUT_MS shows the notice.

import { useEffect, useState } from "react";
import UsageNotice from "./UsageNotice";

/** The server caps its own database call at 1.5 s; this covers the whole round trip. */
const CLIENT_TIMEOUT_MS = 6000;

/** Courses already allowed in this tab, until their reset, so in-course navigation stays instant. */
const allowedUntil = new Map<string, number>();

type Verdict = { state: "pending" } | { state: "allowed" } | { state: "blocked"; resetAt: string | null };

export default function CourseStartGate({ slug, children }: { slug: string; children: React.ReactNode }) {
  const [verdict, setVerdict] = useState<Verdict>({ state: "pending" });

  useEffect(() => {
    const until = allowedUntil.get(slug);
    if (until && until > Date.now()) {
      setVerdict({ state: "allowed" });
      return;
    }

    let cancelled = false;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), CLIENT_TIMEOUT_MS);

    (async () => {
      try {
        const res = await fetch("/api/academy/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug }),
          credentials: "same-origin",
          cache: "no-store",
          signal: ctl.signal,
        });
        const body = (await res.json().catch(() => null)) as { allowed?: unknown; reset_at?: unknown } | null;
        if (cancelled) return;
        const resetAt = typeof body?.reset_at === "string" ? body.reset_at : null;
        if (res.ok && body?.allowed === true) {
          const reset = resetAt ? Date.parse(resetAt) : NaN;
          if (Number.isFinite(reset)) allowedUntil.set(slug, reset);
          setVerdict({ state: "allowed" });
        } else {
          setVerdict({ state: "blocked", resetAt });
        }
      } catch {
        if (!cancelled) setVerdict({ state: "blocked", resetAt: null });
      } finally {
        clearTimeout(timer);
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      ctl.abort();
    };
  }, [slug]);

  if (verdict.state === "blocked") return <UsageNotice resetAt={verdict.resetAt} />;
  return <>{children}</>;
}
