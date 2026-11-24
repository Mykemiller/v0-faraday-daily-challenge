"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CompanyIndexEntry, V3Row } from "@/lib/predicts-v3";
import CompanyMark from "./CompanyMark";

// Typeahead over Companies › Threads › Forecasts, debounced 250ms. A listbox
// with aria-activedescendant; Enter opens the active option, Esc closes.
// Companies come from view=companies (fetched once); Threads and Forecasts from
// the open set already on the page — same match rule as the API's q=.

type Option =
  | { kind: "company"; id: string; label: string; href: string; company: CompanyIndexEntry }
  | { kind: "thread"; id: string; label: string; href: string; sector: string }
  | { kind: "forecast"; id: string; label: string; href: string; prob: number };

type Props = {
  rows: V3Row[];
  companies: CompanyIndexEntry[];
  initial: string | null;
  onSubmit: (q: string | null) => void;
};

function highlight(text: string, q: string) {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0 || !q) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark className="bg-gold-light/50 text-near-black">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

export default function SearchBox({ rows, companies, initial, onSubmit }: Props) {
  const router = useRouter();
  const [value, setValue] = useState(initial ?? "");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setQ(value.trim()), 250);
    return () => clearTimeout(t);
  }, [value]);

  const options = useMemo<Option[]>(() => {
    if (q.length < 2) return [];
    const ql = q.toLowerCase();
    const cos: Option[] = companies
      .filter((c) => c.name.toLowerCase().includes(ql))
      .slice(0, 4)
      .map((c) => ({ kind: "company", id: `c-${c.slug}`, label: c.name, href: `/predicts/company/${c.slug}`, company: c }));
    const seen = new Set<string>();
    const threads: Option[] = [];
    for (const r of rows) {
      const name = r.taxonomy?.thread;
      if (!name || seen.has(name) || !name.toLowerCase().includes(ql)) continue;
      seen.add(name);
      threads.push({ kind: "thread", id: `t-${threads.length}`, label: name, href: `/predicts?thread=${encodeURIComponent(name)}`, sector: r.taxonomy?.sector ?? "" });
      if (threads.length >= 4) break;
    }
    const forecasts: Option[] = rows
      .filter((r) => r.prediction_text.toLowerCase().includes(ql))
      .slice(0, 6)
      .map((r) => ({ kind: "forecast", id: `f-${r.prediction_id}`, label: r.prediction_text, href: `/predicts/${r.prediction_id}`, prob: r.probability_score }));
    return [...cos, ...threads, ...forecasts];
  }, [q, rows, companies]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const go = (o: Option) => {
    setOpen(false);
    router.push(o.href);
  };

  const showPanel = open && q.length >= 2;
  const groups: { title: string; kind: Option["kind"] }[] = [
    { title: "Companies", kind: "company" },
    { title: "Threads", kind: "thread" },
    { title: "Forecasts", kind: "forecast" },
  ];

  return (
    <div ref={wrap} className="relative">
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          if (showPanel && options[active]) go(options[active]);
          else {
            setOpen(false);
            onSubmit(value.trim() || null);
          }
        }}
      >
        <label htmlFor={`${listId}-input`} className="sr-only">
          Search forecasts, companies, Threads
        </label>
        <input
          id={`${listId}-input`}
          type="search"
          role="combobox"
          aria-expanded={showPanel}
          aria-controls={`${listId}-list`}
          aria-autocomplete="list"
          aria-activedescendant={showPanel && options[active] ? options[active].id : undefined}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setOpen(true);
            setActive(0);
            if (!e.target.value) onSubmit(null);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            else if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, Math.max(options.length - 1, 0)));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            }
          }}
          placeholder="Search forecasts, companies, Threads"
          className="h-12 w-full rounded-xl border border-cream-border bg-warm-panel px-4 font-sans text-[16px] text-near-black placeholder:font-mono placeholder:text-[14px] placeholder:text-near-black/55 focus:border-forest"
        />
      </form>
      {showPanel && (
        <div
          id={`${listId}-list`}
          role="listbox"
          aria-label="Search results"
          className="absolute left-0 right-0 top-[52px] z-30 max-h-[60vh] overflow-y-auto rounded-xl border border-cream-border bg-warm-white p-2 shadow-lg"
        >
          {options.length === 0 && <p className="px-2 py-3 font-sans text-[14px] text-near-black/70">No matches. Press Enter to filter the board.</p>}
          {groups.map((g) => {
            const items = options.filter((o) => o.kind === g.kind);
            if (!items.length) return null;
            return (
              <div key={g.kind} role="group" aria-label={g.title} className="py-1">
                <p className="px-2 pb-1 font-mono text-[11px] uppercase tracking-wide text-sage-dark">{g.title}</p>
                {items.map((o) => {
                  const idx = options.indexOf(o);
                  return (
                    <div
                      key={o.id}
                      id={o.id}
                      role="option"
                      aria-selected={idx === active}
                      onMouseEnter={() => setActive(idx)}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        go(o);
                      }}
                      className={`flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 ${idx === active ? "bg-warm-cream" : ""}`}
                    >
                      {o.kind === "company" && (
                        <>
                          <CompanyMark name={o.company.name} slug={o.company.slug} size={28} />
                          <span className="font-sans text-[14px] font-medium text-near-black">{highlight(o.label, q)}</span>
                          <span className="ml-auto font-mono text-[12px] text-sage-dark">
                            {o.company.open_count} open · {o.company.graded_count} graded
                          </span>
                        </>
                      )}
                      {o.kind === "thread" && (
                        <>
                          <span className="font-serif text-[14px] font-semibold text-near-black">{highlight(o.label, q)}</span>
                          <span className="ml-auto font-mono text-[12px] text-sage-dark">{o.sector}</span>
                        </>
                      )}
                      {o.kind === "forecast" && (
                        <>
                          <span data-claim className="line-clamp-2 font-serif text-[14px] text-near-black">{highlight(o.label, q)}</span>
                          <span className="ml-auto shrink-0 font-mono text-[14px] font-semibold text-near-black">{o.prob}%</span>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
