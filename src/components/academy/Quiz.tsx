"use client";
// Faraday Academy — the course quiz.
//
// Phone: one question at a time. Desktop: all ten on one page. The split is a real
// layout difference, so it is driven by matchMedia rather than CSS alone — one
// question at a time means the others are not in the DOM to tab into.
//
// Feedback is immediate and uses the explanation stored with the item; nothing
// here is generated. Correct and incorrect differ by icon and by words, not by
// colour alone, and every verdict lands in a role="status" region.

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { recordQuizScore } from "@/lib/academy/progress";
import type { QuizItem } from "@/lib/academy/types";

const DESKTOP_QUERY = "(min-width: 1024px)";

/**
 * Subscribes to the breakpoint as the external system it is. The server snapshot
 * is false, so the server renders the single-question layout and a phone never
 * flashes ten questions before hydrating.
 */
function useDesktop(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(DESKTOP_QUERY);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => false,
  );
}

function OptionButton({
  option,
  index,
  chosen,
  correctIndex,
  answered,
  onChoose,
}: {
  option: string;
  index: number;
  chosen: number | null;
  correctIndex: number;
  answered: boolean;
  onChoose: (i: number) => void;
}) {
  const isChosen = chosen === index;
  const isCorrect = index === correctIndex;
  // After answering, mark the chosen option and reveal the correct one.
  const reveal = answered && (isChosen || isCorrect);
  const tone = !reveal
    ? { border: "var(--ac-rule-strong)", color: "var(--ac-text)" }
    : isCorrect
      ? { border: "var(--ac-correct)", color: "var(--ac-correct)" }
      : { border: "var(--ac-incorrect)", color: "var(--ac-incorrect)" };

  return (
    <li>
      <button
        type="button"
        disabled={answered}
        onClick={() => onChoose(index)}
        aria-pressed={isChosen}
        className="flex w-full items-start gap-2 px-3 py-2.5 text-left text-sm disabled:cursor-default"
        style={{ border: `2px solid ${tone.border}`, color: tone.color, backgroundColor: "var(--ac-panel)" }}
      >
        <span className="academy-meta mt-0.5 shrink-0" style={{ color: "inherit" }}>
          {/* Icon, not colour, carries the verdict. */}
          {reveal ? (isCorrect ? "✓" : "✕") : String.fromCharCode(65 + index)}
        </span>
        <span className="flex-1">{option}</span>
        {reveal ? (
          <span className="academy-meta shrink-0" style={{ color: "inherit" }}>
            {isCorrect ? "Correct" : "Not this one"}
          </span>
        ) : null}
      </button>
    </li>
  );
}

function Question({
  item,
  number,
  total,
  chosen,
  onChoose,
}: {
  item: QuizItem;
  number: number;
  total: number;
  chosen: number | null;
  onChoose: (i: number) => void;
}) {
  const answered = chosen !== null;
  const correct = chosen === item.correct_index;
  return (
    <section aria-labelledby={`q-${item.position}`} className="py-6">
      <p className="academy-meta">
        Question {number} of {total}
      </p>
      <h2
        id={`q-${item.position}`}
        className="mt-1 font-serif text-lg font-bold"
        style={{ color: "var(--ac-text)" }}
      >
        {item.question}
      </h2>
      <ul className="mt-4 space-y-2">
        {item.options.map((o, i) => (
          <OptionButton
            key={i}
            option={o}
            index={i}
            chosen={chosen}
            correctIndex={item.correct_index}
            answered={answered}
            onChoose={onChoose}
          />
        ))}
      </ul>
      {/* The verdict and the stored explanation, announced once answered. */}
      <div role="status" className="mt-3">
        {answered ? (
          <div className="px-3 py-2" style={{ backgroundColor: "var(--ac-panel-2)" }}>
            <p className="text-sm font-medium" style={{ color: correct ? "var(--ac-correct)" : "var(--ac-incorrect)" }}>
              <span aria-hidden="true">{correct ? "✓ " : "✕ "}</span>
              {correct ? "Correct." : "Not quite."}
            </p>
            {item.explanation ? (
              <p className="mt-1 text-sm" style={{ color: "var(--ac-text)" }}>
                {item.explanation}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

export default function Quiz({ quiz, slug }: { quiz: QuizItem[]; slug: string }) {
  const desktop = useDesktop();
  const items = useMemo(() => [...quiz].sort((a, b) => a.position - b.position), [quiz]);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [index, setIndex] = useState(0);

  const answeredCount = Object.keys(answers).length;
  const score = items.reduce((n, it) => (answers[it.position] === it.correct_index ? n + 1 : n), 0);
  const done = answeredCount === items.length && items.length > 0;

  useEffect(() => {
    if (done) recordQuizScore(slug, score);
  }, [done, score, slug]);

  function choose(position: number, option: number) {
    setAnswers((prev) => (position in prev ? prev : { ...prev, [position]: option }));
  }

  if (items.length === 0) {
    return (
      <p className="py-10 text-sm" style={{ color: "var(--ac-muted)" }}>
        This course has no quiz yet.
      </p>
    );
  }

  const summary = (
    <div role="status">
      {done ? (
        <div className="mt-8 px-4 py-6 text-center" style={{ border: "1px solid var(--ac-rule-strong)" }}>
          <p className="academy-meta">Your score</p>
          {/* A large numeral is one of the three places gold is allowed. */}
          <p className="font-serif text-5xl font-bold" style={{ color: "var(--ac-accent)" }}>
            {score}/{items.length}
          </p>
          <p className="mt-2 text-sm" style={{ color: "var(--ac-muted)" }}>
            {score === items.length
              ? "A clean sweep."
              : "The explanation under each question is the fastest way back into the material."}
          </p>
        </div>
      ) : null}
    </div>
  );

  if (desktop) {
    return (
      <div>
        {items.map((it, i) => (
          <Question
            key={it.position}
            item={it}
            number={i + 1}
            total={items.length}
            chosen={answers[it.position] ?? null}
            onChoose={(o) => choose(it.position, o)}
          />
        ))}
        {summary}
      </div>
    );
  }

  const current = items[Math.min(index, items.length - 1)];
  const currentAnswered = current.position in answers;
  return (
    <div>
      <Question
        item={current}
        number={index + 1}
        total={items.length}
        chosen={answers[current.position] ?? null}
        onChoose={(o) => choose(current.position, o)}
      />
      <div className="mt-4 flex items-center justify-between">
        <button
          type="button"
          disabled={index === 0}
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
          className="px-3 py-2 text-sm disabled:opacity-40"
          style={{ border: "1px solid var(--ac-rule-strong)", color: "var(--ac-text)" }}
        >
          Previous
        </button>
        {index < items.length - 1 ? (
          <button
            type="button"
            disabled={!currentAnswered}
            onClick={() => setIndex((i) => Math.min(items.length - 1, i + 1))}
            className="px-4 py-2 text-sm font-medium disabled:opacity-40"
            style={{ backgroundColor: "var(--ac-forest)", color: "var(--ac-bg)" }}
          >
            Next question
          </button>
        ) : null}
      </div>
      {summary}
    </div>
  );
}
