import Link from "next/link";
import { receiptBadge } from "@/lib/predicts";
import { shortDate, type V3Row } from "@/lib/predicts-v3";
import OutcomeBadge from "./OutcomeBadge";

// Rail card: claim (2 lines), probability and the date that matters.
export default function CompactCard({ row }: { row: V3Row }) {
  const graded = row.status !== "active";
  const badge = graded ? receiptBadge(row.outcome) : null;
  const date = shortDate(graded ? row.resolution_date : row.target_resolution_date);
  return (
    <Link
      href={`/predicts/${row.prediction_id}`}
      className="flex w-[260px] shrink-0 snap-start flex-col gap-2 rounded-xl border border-cream-border bg-warm-white p-3 hover:border-forest"
    >
      <p className="line-clamp-2 font-serif text-[14px] leading-snug text-near-black">{row.prediction_text}</p>
      <div className="mt-auto flex items-center gap-2">
        <span className="font-mono text-[14px] font-semibold text-near-black">{row.probability_score}%</span>
        {badge && <OutcomeBadge label={badge.label} tone={badge.tone} />}
        {date && (
          <span className="ml-auto font-mono text-[12px] text-near-black/70">
            {graded ? "Graded" : "by"} {date}
          </span>
        )}
      </div>
    </Link>
  );
}
