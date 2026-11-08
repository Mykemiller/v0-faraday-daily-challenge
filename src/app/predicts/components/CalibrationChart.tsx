import { CAL_TICKS, dotRadius, type CalibrationBand } from "@/lib/predicts-v3";

// Reliability chart: how often calls in each probability band came true.
// Diagonal = perfect calibration. Ticks are bare numbers (no % sign).

const S = 320;
const P = { l: 34, r: 12, t: 12, b: 30 };

export default function CalibrationChart({ bands }: { bands: CalibrationBand[] }) {
  const w = S - P.l - P.r;
  const h = S - P.t - P.b;
  const x = (v: number) => P.l + (v / 100) * w;
  const y = (v: number) => P.t + (1 - v / 100) * h;
  const maxN = Math.max(...bands.map((b) => b.n));
  const top = bands.find((b) => b.n === maxN);
  return (
    <figure className="m-0 max-w-[360px]">
      <svg viewBox={`0 0 ${S} ${S}`} role="img" aria-label="Calibration: Faraday's probability against how often the call came true" className="h-auto w-full">
        {CAL_TICKS.map((t) => (
          <g key={t}>
            <line x1={P.l} x2={S - P.r} y1={y(+t)} y2={y(+t)} stroke="currentColor" className="text-cream-line" />
            <text x={P.l - 6} y={y(+t) + 4} textAnchor="end" className="fill-near-black/60 font-mono text-[11px]">{t}</text>
            <text x={x(+t)} y={S - 12} textAnchor="middle" className="fill-near-black/60 font-mono text-[11px]">{t}</text>
          </g>
        ))}
        <line x1={x(0)} y1={y(0)} x2={x(100)} y2={y(100)} stroke="currentColor" strokeDasharray="4 4" className="text-warm-gray" strokeWidth={1.5} />
        <text x={x(14)} y={y(8)} transform={`rotate(-45 ${x(14)} ${y(8)})`} className="fill-near-black/55 font-sans text-[11px]">perfect calibration</text>
        {bands.map((b) => (
          <circle key={b.band} cx={x(b.predicted_mid)} cy={y(b.observed_rate)} r={dotRadius(b.n, maxN)} className="fill-forest" fillOpacity={0.85}
            stroke={b === top ? "#C4922A" : "none"} strokeWidth={b === top ? 2 : 0} />
        ))}
      </svg>
      <figcaption className="mt-1 font-sans text-[13px] text-near-black/70">
        Across: Faraday’s probability · Up: how often it happened · Dot size = graded calls in that band
      </figcaption>
    </figure>
  );
}
