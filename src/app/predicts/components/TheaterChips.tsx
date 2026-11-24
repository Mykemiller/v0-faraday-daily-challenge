"use client";

// "All" + Theater names (no counts). Horizontal scroll with snap.
type Props = { theaters: string[]; value: string | null; onChange: (t: string | null) => void };

export default function TheaterChips({ theaters, value, onChange }: Props) {
  const chip = (label: string, selected: boolean, on: () => void) => (
    <button
      key={label}
      type="button"
      aria-pressed={selected}
      onClick={on}
      className={`min-h-[44px] shrink-0 snap-start whitespace-nowrap rounded-full border px-4 font-sans text-[14px] font-medium transition-colors duration-200 ${
        selected ? "border-forest bg-forest text-warm-white" : "border-cream-border bg-warm-white text-near-black hover:border-forest"
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1" role="group" aria-label="Theaters">
      {chip("All", value === null, () => onChange(null))}
      {theaters.map((t) => chip(t, value?.toLowerCase() === t.toLowerCase(), () => onChange(t)))}
    </div>
  );
}
