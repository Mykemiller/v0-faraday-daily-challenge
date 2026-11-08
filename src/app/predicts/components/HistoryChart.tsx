import { contiguousRuns, shortDate, type HistoryPoint } from "@/lib/predicts-v3";

// Faraday's published probability over time (FDY-274).
//
// Fixed 0–100 axis so a 4-point move never looks like a cliff. Only recorded
// days are drawn: a gap in the log is a gap in the line (contiguousRuns), never
// an interpolated slope. The first point is hollow ("Called"), the last gold.

const W = 640;
const H = 220;
const PAD = { l: 36, r: 16, t: 16, b: 28 };

type Props = { history: HistoryPoint[]; called: number; resolutionDate?: string | null };

function dayNum(iso: string): number {
  return Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86_400_000;
}

export default function HistoryChart({ history, called, resolutionDate }: Props) {
  if (history.length < 2) {
    return (
      <p className="rounded-lg border border-cream-border bg-warm-white p-4 font-sans text-[15px] text-near-black/80">
        Faraday’s probability has not changed since it was called.
      </p>
    );
  }
  const first = dayNum(history[0].date);
  const lastDay = history[history.length - 1].date;
  const endDay = resolutionDate && resolutionDate > lastDay ? resolutionDate : lastDay;
  const span = Math.max(1, dayNum(endDay) - first);
  const x = (iso: string) => PAD.l + ((dayNum(iso) - first) / span) * (W - PAD.l - PAD.r);
  const y = (p: number) => PAD.t + (1 - p / 100) * (H - PAD.t - PAD.b);

  const months: { iso: string; label: string }[] = [];
  const seen = new Set<string>();
  for (const p of history) {
    const m = p.date.slice(0, 7);
    if (!seen.has(m)) {
      seen.add(m);
      months.push({ iso: `${m}-01` < history[0].date ? history[0].date : `${m}-01`, label: new Date(`${m}-15T12:00:00Z`).toLocaleString("en-US", { month: "short", timeZone: "UTC" }) });
    }
  }
  const last = history[history.length - 1];
  const head = history[0];
  const showResolution = !!resolutionDate && resolutionDate >= head.date;

  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Faraday's probability: called at ${called}, now ${last.probability}`} className="h-auto w-full">
        {[0, 25, 50, 75, 100].map((g) => (
          <g key={g}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(g)} y2={y(g)} stroke="currentColor" className={g === 0 || g === 100 ? "text-cream-border" : "text-cream-line"} strokeWidth={1} />
            <text x={PAD.l - 6} y={y(g) + 4} textAnchor="end" className="fill-near-black/60 font-mono text-[11px]">{g}</text>
          </g>
        ))}
        {months.map((m) => (
          <text key={m.iso} x={x(m.iso)} y={H - 8} className="fill-near-black/60 font-mono text-[11px]">{m.label}</text>
        ))}
        {showResolution && (
          <line x1={x(resolutionDate!)} x2={x(resolutionDate!)} y1={PAD.t} y2={H - PAD.b} stroke="currentColor" strokeDasharray="3 3" className="text-near-black/40" strokeWidth={1} />
        )}
        {contiguousRuns(history).map((run, i) =>
          run.length > 1 ? (
            <polyline key={i} fill="none" stroke="currentColor" className="text-forest" strokeWidth={2} strokeLinejoin="round"
              points={run.map((p) => `${x(p.date)},${y(p.probability)}`).join(" ")} />
          ) : (
            <circle key={i} cx={x(run[0].date)} cy={y(run[0].probability)} r={2.5} className="fill-forest" />
          ),
        )}
        <circle cx={x(head.date)} cy={y(head.probability)} r={5} fill="var(--color-warm-white, #F8F5F0)" stroke="currentColor" strokeWidth={2} className="text-forest" />
        <text x={x(head.date) + 8} y={y(head.probability) - 8} className="fill-forest font-mono text-[11px] font-semibold">Called · {head.probability}</text>
        <circle cx={x(last.date)} cy={y(last.probability)} r={5} className="fill-gold" />
      </svg>
      <figcaption className="mt-1 font-sans text-[13px] text-near-black/70">
        Daily record from {shortDate(head.date)} to {shortDate(last.date)}{showResolution ? `; dashed line marks the resolve-by date` : ""}. Days with no record are left blank.
      </figcaption>
    </figure>
  );
}
