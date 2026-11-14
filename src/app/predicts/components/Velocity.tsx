import { evidenceLine, sourceNames, velocityChip, WHAT_WE_LOOKED_AT, type VelocityTone } from "@/lib/predicts";

// Velocity 3.0 on a forecast (FDY-262). Every element renders only when the
// forecast carries its field (D4): a legacy forecast keeps today's card.

// D3: brand palette only, and never colour alone — the label and the arrow
// carry the meaning. Gold and Sage text use their AA-ratified dark variants.
const CHIP_TONE: Record<VelocityTone, string> = {
  accelerating: "border-gold text-amber-dark",
  stable: "border-sage text-sage-dark",
  decelerating: "border-near-black text-near-black",
};

export function VelocityChip({ tag }: { tag: unknown }) {
  const chip = velocityChip(tag);
  if (!chip) return null;
  return (
    <span
      data-velocity={chip.tone}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border bg-warm-white px-2 py-0.5 font-mono text-[11px] ${CHIP_TONE[chip.tone]}`}
    >
      <span aria-hidden>{chip.glyph}</span>
      {chip.label}
    </span>
  );
}

/** The evidence line and the "What we looked at" disclosure. Native
 *  <details>/<summary>: keyboard and screen-reader accessible with no script. */
export function VelocityEvidence({ posture, layers, className = "" }: { posture: unknown; layers: unknown; className?: string }) {
  const line = evidenceLine(posture);
  const names = sourceNames(layers);
  if (!line && names.length === 0) return null;
  return (
    <div data-velocity-evidence className={className}>
      {line && <p className="font-mono text-[12px] text-near-black/70">{line}</p>}
      {names.length > 0 && (
        <details className="group mt-1">
          <summary className="inline-flex min-h-[32px] cursor-pointer list-none items-center gap-1 font-sans text-[13px] font-medium text-forest hover:underline [&::-webkit-details-marker]:hidden">
            <svg aria-hidden viewBox="0 0 12 12" className="h-3 w-3 transition-transform group-open:rotate-90">
              <path d="M4 2.5 7.5 6 4 9.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {WHAT_WE_LOOKED_AT}
          </summary>
          <ul className="mt-1 flex flex-wrap gap-1.5 pl-3">
            {names.map((n) => (
              <li key={n} className="rounded-full border border-cream-border px-2 py-0.5 font-sans text-[12px] text-near-black/80">
                {n}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
