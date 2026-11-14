"use client";

import Link from "next/link";
import { useState } from "react";
import { velocityChip } from "@/lib/predicts";
import { monogram, shortDate, THREAD_CARD_MAX_ROWS, type ThreadGroup } from "@/lib/predicts-v3";
import Breadcrumb from "./Breadcrumb";
import CompanyMark, { Monogram } from "./CompanyMark";
import ForecastCard from "./ForecastCard";
import { VelocityChip } from "./Velocity";

// The board unit (Founder decision 6): one card per Thread, one row per call.
type Props = { group: ThreadGroup; gradedCount?: number; voteUrl: string; votesEnabled: boolean };

export default function ThreadCard({ group, gradedCount, voteUrl, votesEnabled }: Props) {
  const [expanded, setExpanded] = useState(false);
  if (group.rows.length === 1) return <ForecastCard row={group.rows[0]} voteUrl={voteUrl} votesEnabled={votesEnabled} />;
  const rows = expanded ? group.rows : group.rows.slice(0, THREAD_CARD_MAX_ROWS);
  const more = group.rows.length - rows.length;
  const top = group.rows[0];
  return (
    <article className="rounded-xl border border-cream-border bg-warm-white p-4">
      <div className="flex items-start gap-3">
        {group.sharedCompany ? (
          <CompanyMark name={group.sharedCompany.name} slug={group.sharedCompany.slug} />
        ) : (
          <Monogram text={monogram(group.sector)} />
        )}
        <div className="min-w-0">
          <Breadcrumb taxonomy={top.taxonomy} sector={top.sector_name} />
          <h3 className="mt-0.5 font-serif text-[17px] font-semibold leading-snug text-near-black">{group.title}</h3>
        </div>
      </div>
      <ul className="mt-3 divide-y divide-cream-line">
        {rows.map((r) => (
          <li key={r.prediction_id}>
            <Link data-row href={`/predicts/${r.prediction_id}`} className="flex items-center gap-3 py-2.5 hover:bg-warm-panel">
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 font-sans text-[14px] leading-snug text-near-black">
                  <span data-claim>{r.prediction_text}</span>
                  {shortDate(r.target_resolution_date) && (
                    <span className="whitespace-nowrap font-mono text-[12px] text-near-black/60"> · by {shortDate(r.target_resolution_date)}</span>
                  )}
                </p>
                {/* FDY-262: thread rows are links, so they carry the chip only; the evidence
                    line and "What we looked at" live on the full card and the forecast page. */}
                {velocityChip(r.velocity_tag) && (
                  <div className="mt-1">
                    <VelocityChip tag={r.velocity_tag} />
                  </div>
                )}
                <div className="mt-1.5 h-[3px] w-full rounded bg-cream-line" aria-hidden>
                  <div className={`h-[3px] rounded ${r.is_bold ? "bg-gold" : "bg-forest"}`} style={{ width: `${r.probability_score}%` }} />
                </div>
              </div>
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 font-mono text-[14px] font-semibold text-near-black ${
                  r.is_bold ? "border-[1.5px] border-gold" : "border-[1.5px] border-forest"
                }`}
              >
                {r.probability_score}%
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {more > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-1 min-h-[44px] font-sans text-[14px] font-medium text-forest hover:underline"
        >
          +{more} more →
        </button>
      )}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-cream-line pt-2">
        <span className="font-mono text-[12px] text-sage-dark">
          {group.rows.length} open{typeof gradedCount === "number" ? ` · ${gradedCount} graded` : ""}
        </span>
        <Link
          href={`/predicts?thread=${encodeURIComponent(group.key)}`}
          className="font-sans text-[14px] font-medium text-forest hover:underline"
        >
          All {group.title} calls →
        </Link>
      </div>
    </article>
  );
}
