import { sparkDeltaText } from "@/lib/predicts-v3";

// Forest line, gold end dot, drawn in on first paint (off under reduced motion).
// Fixed 0–100 vertical scale — the line never exaggerates a small move. Nothing
// renders when the series is absent or a single point.

type Props = { points?: number[] | null; width?: number; height?: number; showDelta?: boolean; label?: string };

export default function Sparkline({ points, width = 96, height = 28, showDelta = true, label }: Props) {
  if (!points || points.length < 2) return null;
  const pad = 3;
  const step = (width - pad * 2) / (points.length - 1);
  const y = (p: number) => pad + (1 - p / 100) * (height - pad * 2);
  const d = points.map((p, i) => `${i ? "L" : "M"}${(pad + i * step).toFixed(1)} ${y(p).toFixed(1)}`).join(" ");
  const lastX = pad + (points.length - 1) * step;
  const delta = showDelta ? sparkDeltaText(points) : null;
  return (
    <span className="inline-flex items-center gap-2">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={label ?? `Faraday's probability over the last ${points.length} days, from ${points[0]} to ${points[points.length - 1]}`}
      >
        <path d={d} fill="none" stroke="#1C3424" strokeWidth="1.6" strokeLinejoin="round" className="fp-draw" pathLength={1} />
        <circle cx={lastX} cy={y(points[points.length - 1])} r="2.6" fill="#C4922A" />
      </svg>
      {delta && <span className="font-mono text-[12px] text-near-black">{delta}</span>}
    </span>
  );
}
