import Link from "next/link";
import { noEvidenceLine, receiptBadge } from "@/lib/predicts";
import { publicNote, shortDate, type V3Row } from "@/lib/predicts-v3";
import Breadcrumb from "./Breadcrumb";
import CompanyMark from "./CompanyMark";
import OutcomeBadge from "./OutcomeBadge";

// One graded call: what Faraday said, when, and how it came out.
export default function ReceiptCard({ row }: { row: V3Row }) {
  const badge = receiptBadge(row.outcome);
  const note = publicNote(row.resolution_note);
  return (
    <article data-row className="rounded-xl border border-cream-border bg-warm-white p-4">
      <div className="flex items-start justify-between gap-2">
        <Breadcrumb taxonomy={row.taxonomy} sector={row.sector_name} />
        {badge && <OutcomeBadge label={badge.label} tone={badge.tone} />}
      </div>
      <Link href={`/predicts/${row.prediction_id}`} className="mt-2 block">
        <h3 data-claim className="font-serif text-[17px] font-semibold leading-snug text-near-black hover:text-forest">{row.prediction_text}</h3>
      </Link>
      <p className="mt-2 font-mono text-[13px] text-near-black">
        Called {shortDate(row.date_created)} at {row.probability_score}%
      </p>
      <p className="font-mono text-[12px] text-near-black/70">
        Due {shortDate(row.target_resolution_date)} · Graded {shortDate(row.resolution_date)}
      </p>
      {!!row.companies?.length && (
        <ul className="mt-2 flex flex-wrap gap-2">
          {row.companies.map((c) => (
            <li key={c.slug}>
              <Link href={`/predicts/company/${c.slug}`} className="inline-flex min-h-[32px] items-center gap-1.5 rounded-full border border-cream-border px-2 font-sans text-[13px] hover:border-forest">
                <CompanyMark name={c.name} slug={c.slug} size={18} />
                {c.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {note && <p data-claim className="mt-2 line-clamp-2 font-sans text-[14px] leading-relaxed text-near-black/75">{note}</p>}
      {row.evidence_url ? (
        <a href={row.evidence_url} target="_blank" rel="noopener noreferrer nofollow" className="mt-1 inline-flex min-h-[44px] items-center font-sans text-[14px] font-medium text-forest underline">
          Evidence
        </a>
      ) : (
        row.outcome === "didnt_happen" && <p className="mt-1 font-sans text-[13px] text-near-black/70">{noEvidenceLine(row.target_resolution_date)}</p>
      )}
    </article>
  );
}
