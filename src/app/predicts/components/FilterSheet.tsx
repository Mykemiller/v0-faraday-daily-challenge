"use client";

import { useEffect, useRef, useState } from "react";
import {
  activeFilterCount,
  HORIZON_CHOICES,
  SORT_CHOICES,
  type CompanyIndexEntry,
  type OpenState,
} from "@/lib/predicts-v3";

// Native <dialog> (focus trapped by showModal): a bottom sheet on phones, a
// panel on desktop. Edits apply live; "Done" closes.

type Props = {
  state: OpenState;
  sectors: string[];
  companies: CompanyIndexEntry[];
  horizonCounts: Record<string, number>;
  onChange: (next: OpenState) => void;
};

export default function FilterSheet({ state, sectors, companies, horizonCounts, onChange }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [companyQuery, setCompanyQuery] = useState("");
  const count = activeFilterCount(state);
  const total = Object.values(horizonCounts).reduce((a, b) => a + (Number(b) || 0), 0);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const onClick = (e: MouseEvent) => {
      if (e.target === d) d.close();
    };
    d.addEventListener("click", onClick);
    return () => d.removeEventListener("click", onClick);
  }, []);

  const set = (patch: Partial<OpenState>) => onChange({ ...state, ...patch });
  const opt = (selected: boolean, label: string, on: () => void, key?: string) => (
    <button
      key={key ?? label}
      type="button"
      aria-pressed={selected}
      onClick={on}
      className={`min-h-[44px] rounded-full border px-3 font-sans text-[14px] ${
        selected ? "border-forest bg-forest text-warm-white" : "border-cream-border bg-warm-white text-near-black hover:border-forest"
      }`}
    >
      {label}
    </button>
  );
  const shownCompanies = companies.filter((c) => c.name.toLowerCase().includes(companyQuery.trim().toLowerCase())).slice(0, 30);

  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.showModal()}
        className="relative inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-cream-border bg-warm-white px-4 font-sans text-[14px] font-medium text-near-black hover:border-forest"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <path d="M2 4h12M4.5 8h7M7 12h2" />
        </svg>
        Filters
        {count > 0 && (
          <span className="rounded-full bg-gold px-1.5 font-mono text-[12px] font-semibold text-near-black" aria-label={`${count} active`}>
            {count}
          </span>
        )}
      </button>
      <dialog ref={ref} aria-label="Filter forecasts" className="fp-sheet bg-warm-white p-0 text-near-black backdrop:bg-near-black/40">
        <div className="max-h-[80vh] overflow-y-auto p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-serif text-[20px] font-bold">Filters</h2>
            <button type="button" onClick={() => ref.current?.close()} className="min-h-[44px] px-3 font-sans text-[14px] font-semibold text-forest">
              Done
            </button>
          </div>

          <fieldset className="mt-4">
            <legend className="font-mono text-[11px] uppercase tracking-wide text-sage-dark">Horizon</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {HORIZON_CHOICES.map((h) => {
                const n = h.value === "all" ? total : horizonCounts[h.value] ?? 0;
                return opt(state.h === h.value, `${h.label} · ${n}`, () => set({ h: h.value }), h.value);
              })}
            </div>
          </fieldset>

          <fieldset className="mt-5">
            <legend className="font-mono text-[11px] uppercase tracking-wide text-sage-dark">Sector</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {opt(!state.sector, "Any Sector", () => set({ sector: null }), "__any")}
              {sectors.map((s) => opt(state.sector?.toLowerCase() === s.toLowerCase(), s, () => set({ sector: s })))}
            </div>
          </fieldset>

          <fieldset className="mt-5">
            <legend className="font-mono text-[11px] uppercase tracking-wide text-sage-dark">Company</legend>
            <input
              type="search"
              value={companyQuery}
              onChange={(e) => setCompanyQuery(e.target.value)}
              placeholder="Type a company name"
              aria-label="Filter the company list"
              className="mt-2 h-11 w-full rounded-lg border border-cream-border bg-warm-panel px-3 font-sans text-[15px]"
            />
            <div className="mt-2 flex flex-wrap gap-2">
              {opt(!state.company, "Any company", () => set({ company: null }), "__anyco")}
              {shownCompanies.map((c) => opt(state.company === c.slug, c.name, () => set({ company: c.slug }), c.slug))}
            </div>
          </fieldset>

          <fieldset className="mt-5">
            <legend className="font-mono text-[11px] uppercase tracking-wide text-sage-dark">Show</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {opt(state.bold, "Bold Calls only", () => set({ bold: !state.bold }))}
              {opt(state.watching, "Watching only", () => set({ watching: !state.watching }))}
            </div>
          </fieldset>

          <fieldset className="mt-5">
            <legend className="font-mono text-[11px] uppercase tracking-wide text-sage-dark">Sort</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {SORT_CHOICES.map((s) => opt(state.sort === s.value, s.label, () => set({ sort: s.value }), s.value))}
            </div>
          </fieldset>
        </div>
      </dialog>
    </>
  );
}
