// Faraday Predicts mark (Brand Bible S8): one stem branching into three futures
// — gold upper, solid middle, dashed lower — with the bolt at the branch point.
// Hand-drawn SVG; legible at 28px.

type Props = { size?: number; onDark?: boolean; className?: string };

export default function PredictsMark({ size = 28, onDark = false, className }: Props) {
  const line = onDark ? "#F8F5F0" : "#1C3424";
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden className={className} fill="none">
      <path d="M3 21 L11 14" stroke={line} strokeWidth="2.2" strokeLinecap="round" />
      <path d="M13 13 L25 5" stroke="#C4922A" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M13 14 L25 14" stroke={line} strokeWidth="2.2" strokeLinecap="round" />
      <path d="M13 15 L25 23" stroke={line} strokeWidth="2" strokeLinecap="round" strokeDasharray="2.4 2.4" />
      <polygon points="12.6,9.6 9.8,14.6 12.2,14.6 11.2,18.4 14.6,12.8 12.2,12.8" fill="#C4922A" />
    </svg>
  );
}
