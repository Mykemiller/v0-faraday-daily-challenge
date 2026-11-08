import Link from "next/link";
import { shortDate, type V3Row } from "@/lib/predicts-v3";
import { BOLD_CALL_TOOLTIP } from "@/lib/predicts";
import Breadcrumb from "./Breadcrumb";
import CountUp from "./CountUp";
import Sparkline from "./Sparkline";
import VotePills from "./VotePills";
import WatchStar from "./WatchStar";

// One forecast: search results, Movers, rails and one-row Thread groups.
type Props = { row: V3Row; voteUrl: string; votesEnabled: boolean; badge?: React.ReactNode };

export default function ForecastCard({ row, voteUrl, votesEnabled, badge }: Props) {
  const resolves = shortDate(row.target_resolution_date);
  return (
    <article className="rounded-xl border border-cream-border bg-warm-white p-4 transition-shadow duration-200 hover:shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <Breadcrumb taxonomy={row.taxonomy} sector={row.sector_name} />
        <div className="flex items-center gap-2">
          {badge}
          {row.is_bold && (
            <span title={BOLD_CALL_TOOLTIP} className="rounded-full border border-gold px-2 py-0.5 font-mono text-[11px] text-amber-dark">
              Bold Call
            </span>
          )}
        </div>
      </div>
      <Link href={`/predicts/${row.prediction_id}`} className="mt-2 block">
        <h3 className="font-serif text-[17px] font-semibold leading-snug text-near-black hover:text-forest">{row.prediction_text}</h3>
      </Link>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div>
          <span className="font-mono text-[30px] font-semibold leading-none text-near-black">
            <CountUp value={row.probability_score} />%
          </span>
          {row.probability_band && <span className="ml-2 font-sans text-[14px] text-near-black/70">{row.probability_band}</span>}
        </div>
        <Sparkline points={row.sparkline} />
        {resolves && <span className="font-mono text-[12px] text-near-black/70">Resolves {resolves}</span>}
        <span className="ml-auto">
          <WatchStar id={row.prediction_id} />
        </span>
      </div>
      <div className="mt-2">
        <VotePills id={row.prediction_id} votes={row.votes} voteUrl={voteUrl} enabled={votesEnabled && row.status === "active"} />
      </div>
    </article>
  );
}
