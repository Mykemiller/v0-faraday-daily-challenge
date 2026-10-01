"use client";
// Faraday Academy — the "Go deeper" panel.
//
// Everything the model writes lands here, on the sage ground, under the words
// "Supplementary AI material". It is never merged into the lesson column, and the
// lesson text above it is unaffected by anything that happens in here.
//
// The panel always states how many requests are left and when they reset — a limit
// the reader cannot see is just an unexplained failure.

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { AiMaterialLabel, CitationChip } from "./primitives";

const DiagramFrame = lazy(() => import("./DiagramFrame"));
const ChartFrame = lazy(() => import("./ChartFrame"));

const CHIPS = [
  "Explain this simply",
  "Show me a diagram",
  "Chart the numbers",
  "What's the latest?",
  "Find primary sources",
];

const PERSONAS = ["Curious reader", "Operator", "Investor", "Policy maker", "Engineer"];

type Source = { title: string; url: string; publisher?: string; published_on?: string };
type Paragraph = { text: string; cites: number[] };
type Answer = {
  paragraphs?: Paragraph[];
  sources?: Source[];
  diagram?: { mermaid: string; caption?: string };
  chart?: { spec: Record<string, unknown>; caption?: string };
};

type Reply =
  | { kind: "answer"; answer: Answer; notes: string[]; remaining: number; limit: number; resets_at: string; retrieved_on: string }
  | { kind: "refusal"; refusal_reason: string; notes: string[]; remaining: number; limit: number; resets_at: string }
  | { kind: "limited"; reason: string; remaining: number; limit: number; resets_at: string }
  | { kind: "turnstile_required"; remaining: number; limit: number; resets_at: string }
  | { kind: "error"; message: string };

function resetWording(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      hour: "numeric",
      minute: "2-digit",
      month: "short",
      day: "numeric",
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

export default function DeeperPanel({
  courseCode,
  lessonId,
  selection,
  onClose,
}: {
  courseCode: string;
  lessonId: string;
  /** The reader's current text selection, if any. */
  selection: string | null;
  onClose: () => void;
}) {
  const [question, setQuestion] = useState("");
  const [persona, setPersona] = useState(PERSONAS[0]);
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<Reply | null>(null);
  const [quota, setQuota] = useState<{ remaining: number | null; limit: number; resets_at: string | null }>({
    remaining: null,
    limit: 5,
    resets_at: null,
  });
  const panel = useRef<HTMLDivElement>(null);
  const closer = useRef<HTMLButtonElement>(null);

  // Esc closes the panel and hands focus back, same contract as the outline sheet.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    closer.current?.focus();
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/academy/deeper")
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) {
          setQuota({ remaining: d.remaining ?? null, limit: d.limit ?? 5, resets_at: d.resets_at ?? null });
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const ask = useCallback(
    async (text: string) => {
      if (!text.trim() || busy) return;
      setBusy(true);
      setReply(null);
      try {
        const res = await fetch("/api/academy/deeper", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            course_code: courseCode,
            lesson_id: lessonId,
            selection: selection ?? undefined,
            ask: text,
            persona,
          }),
        });
        const data = (await res.json()) as Reply;
        setReply(data);
        if ("remaining" in data && typeof data.remaining === "number") {
          setQuota((q) => ({
            remaining: data.remaining,
            limit: data.limit ?? q.limit,
            resets_at: data.resets_at ?? q.resets_at,
          }));
        }
      } catch {
        setReply({ kind: "error", message: "That didn't come back. Try again in a moment." });
      } finally {
        setBusy(false);
      }
    },
    [busy, courseCode, lessonId, persona, selection],
  );

  const left = quota.remaining;
  const exhausted = left !== null && left <= 0;

  return (
    <aside
      ref={panel}
      role="dialog"
      aria-modal="false"
      aria-label="Go deeper — supplementary AI material"
      className="academy-ai mt-10 px-4 py-4"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <AiMaterialLabel />
          <p className="academy-meta mt-0.5" style={{ color: "var(--ac-sage-text)" }}>
            Written by a model, sourced from the open web, and never part of the lesson.
          </p>
        </div>
        <button
          ref={closer}
          type="button"
          onClick={onClose}
          className="px-2 py-1 text-sm"
          style={{ border: "1px solid var(--ac-sage-rule)", color: "var(--ac-sage-text)" }}
        >
          Close
        </button>
      </div>

      {selection ? (
        <blockquote
          className="mt-3 px-3 py-2 text-sm italic"
          style={{ borderLeft: "2px solid var(--ac-sage-rule)", color: "var(--ac-sage-text)" }}
        >
          {selection.length > 240 ? `${selection.slice(0, 240)}…` : selection}
        </blockquote>
      ) : null}

      {/* The allowance, always visible. */}
      <p className="academy-meta mt-3" style={{ color: "var(--ac-sage-text)" }} role="status">
        {left === null
          ? `Up to ${quota.limit} requests a day.`
          : `${left} of ${quota.limit} requests left today${quota.resets_at ? ` · resets ${resetWording(quota.resets_at)} Central` : ""}.`}
      </p>

      {!exhausted ? (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            {CHIPS.map((c) => (
              <button
                key={c}
                type="button"
                disabled={busy}
                onClick={() => ask(c)}
                className="px-2.5 py-1 text-sm disabled:opacity-50"
                style={{ border: "1px solid var(--ac-sage-rule)", color: "var(--ac-sage-text)" }}
              >
                {c}
              </button>
            ))}
          </div>

          <form
            className="mt-3 flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void ask(question);
            }}
          >
            <label className="flex-1" style={{ minWidth: "14rem" }}>
              <span className="sr-only">Ask a question about this lesson</span>
              <input
                type="text"
                value={question}
                maxLength={500}
                onChange={(e) => setQuestion(e.currentTarget.value)}
                placeholder="Or ask your own question"
                className="w-full px-3 py-2 text-sm"
                style={{
                  backgroundColor: "var(--ac-bg)",
                  border: "1px solid var(--ac-sage-rule)",
                  color: "var(--ac-text)",
                }}
              />
            </label>
            <label>
              <span className="sr-only">Reading for</span>
              <select
                value={persona}
                onChange={(e) => setPersona(e.currentTarget.value)}
                className="academy-meta px-2 py-2"
                style={{ backgroundColor: "var(--ac-bg)", border: "1px solid var(--ac-sage-rule)", color: "var(--ac-sage-text)" }}
              >
                {PERSONAS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              disabled={busy || !question.trim()}
              className="px-4 py-2 text-sm font-medium disabled:opacity-50"
              style={{ backgroundColor: "var(--ac-forest)", color: "var(--ac-bg)" }}
            >
              Ask
            </button>
          </form>
        </>
      ) : null}

      <div role="status" aria-live="polite" className="mt-4">
        {busy ? (
          <p className="text-sm" style={{ color: "var(--ac-sage-text)" }}>
            Searching and reading sources…
          </p>
        ) : null}

        {/* AI rate-limited. */}
        {reply?.kind === "limited" || exhausted ? (
          <div className="px-3 py-3" style={{ border: "1px dashed var(--ac-sage-rule)" }}>
            <p className="text-sm font-medium" style={{ color: "var(--ac-sage-text)" }}>
              {reply?.kind === "limited" && reply.reason === "spend_cap"
                ? "Go deeper is resting for today."
                : "You've used today's Go deeper requests."}
            </p>
            <p className="mt-1 text-sm" style={{ color: "var(--ac-sage-text)" }}>
              {quota.resets_at
                ? `They come back at ${resetWording(quota.resets_at)} Central.`
                : "They reset at midnight Central."}{" "}
              The lesson, the quiz and the glossary are all still open.
            </p>
          </div>
        ) : null}

        {reply?.kind === "turnstile_required" ? (
          <div className="px-3 py-3" style={{ border: "1px dashed var(--ac-sage-rule)" }}>
            <p className="text-sm" style={{ color: "var(--ac-sage-text)" }}>
              That was a lot of requests at once. Give it a moment and try again.
            </p>
          </div>
        ) : null}

        {/* AI refused. */}
        {reply?.kind === "refusal" ? (
          <div className="px-3 py-3" style={{ border: "1px dashed var(--ac-sage-rule)" }}>
            <p className="text-sm font-medium" style={{ color: "var(--ac-sage-text)" }}>
              Nothing solid enough to show
            </p>
            <p className="mt-1 text-sm" style={{ color: "var(--ac-sage-text)" }}>
              {reply.refusal_reason ??
                "I couldn't support an answer from sources I can name, so I'd rather show nothing."}
            </p>
          </div>
        ) : null}

        {reply?.kind === "error" ? (
          <p className="text-sm" style={{ color: "var(--ac-sage-text)" }}>
            {reply.message}
          </p>
        ) : null}

        {reply?.kind === "answer" ? (
          <div>
            {(reply.answer.paragraphs ?? []).map((p, i) => (
              <p key={i} className="mt-3 text-base" style={{ color: "var(--ac-sage-text)" }}>
                {p.text}
                {p.cites.length > 0 ? (
                  <span className="academy-meta" style={{ color: "inherit" }}>
                    {" "}
                    [{p.cites.join(", ")}]
                  </span>
                ) : null}
              </p>
            ))}

            {reply.answer.diagram ? (
              <Suspense fallback={<p className="academy-meta mt-3">Loading the diagram renderer…</p>}>
                <DiagramFrame source={reply.answer.diagram.mermaid} caption={reply.answer.diagram.caption} />
              </Suspense>
            ) : null}

            {reply.answer.chart ? (
              <Suspense fallback={<p className="academy-meta mt-3">Loading the chart renderer…</p>}>
                <ChartFrame spec={reply.answer.chart.spec} caption={reply.answer.chart.caption} />
              </Suspense>
            ) : null}

            {(reply.answer.sources ?? []).length > 0 ? (
              <div className="mt-5">
                <p className="academy-meta font-medium" style={{ color: "var(--ac-sage-text)" }}>
                  Sources
                </p>
                <ol className="mt-1 space-y-1">
                  {(reply.answer.sources ?? []).map((s, i) => (
                    <CitationChip
                      key={`${s.url}-${i}`}
                      index={i + 1}
                      title={s.title}
                      url={s.url}
                      retrieved={reply.retrieved_on}
                    />
                  ))}
                </ol>
              </div>
            ) : null}

            {/* What the guards removed, said out loud rather than hidden. */}
            {reply.notes.length > 0 ? (
              <ul className="mt-4 space-y-1">
                {reply.notes.map((n, i) => (
                  <li key={i} className="academy-meta" style={{ color: "var(--ac-sage-text)" }}>
                    {n}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </aside>
  );
}
