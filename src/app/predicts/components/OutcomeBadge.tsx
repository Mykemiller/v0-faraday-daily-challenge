// Outcome colours always travel with a text label (never colour alone).
const TONE: Record<string, string> = {
  right: "bg-sage-light/40 text-forest",
  partly: "bg-warm-cream text-amber-dark",
  miss: "bg-warm-cream text-brick",
  undetermined: "bg-cream-line text-near-black/60",
};

export default function OutcomeBadge({ label, tone }: { label: string; tone: string }) {
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 font-mono text-[12px] font-semibold ${TONE[tone] ?? TONE.undetermined}`}>{label}</span>;
}
