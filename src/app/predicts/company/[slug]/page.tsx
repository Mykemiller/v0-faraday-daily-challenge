import { notFound } from "next/navigation";
import { predictsGet, PREDICTS_VOTE_URL, type CompanyResponse } from "@/lib/predicts-api";
import { companyCountLine, groupByThread } from "@/lib/predicts-v3";
import CompactCard from "../../components/CompactCard";
import CompanyMark from "../../components/CompanyMark";
import ThreadCard from "../../components/ThreadCard";

// Faraday Predicts — every call that names one company (UI 3.0, FDY-274).
// Counts only; never a rate.

type P = Promise<{ slug: string }>;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;

async function load(slug: string) {
  return SLUG_RE.test(slug) ? predictsGet<CompanyResponse>(`view=company&company=${slug}`) : null;
}

export async function generateMetadata({ params }: { params: P }) {
  const { slug } = await params;
  const data = await load(slug);
  if (!data) return { title: "Company not found — Faraday Predicts" };
  const title = `${data.company.name} — Faraday Predicts`;
  const description = `Faraday’s dated forecasts that name ${data.company.name}: ${companyCountLine(data.open.length, data.graded.length)}.`;
  return { title, description, openGraph: { title, description } };
}

export default async function CompanyPage({ params }: { params: P }) {
  const { slug } = await params;
  const data = await load(slug);
  if (!data) notFound();
  const { company, open, graded, company_record: rec } = data;
  const groups = groupByThread(open, "probability");
  const tiles = [
    { label: "Right", n: rec.right },
    { label: "Partly right", n: rec.partly },
    { label: "Missed", n: rec.missed },
  ];

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 md:py-8">
      <div className="flex items-center gap-4">
        <CompanyMark name={company.name} slug={company.slug} size={56} />
        <div>
          <h1 className="font-display text-[clamp(26px,4.4vw,36px)] font-bold leading-tight text-near-black">{company.name}</h1>
          <p className="font-mono text-[14px] text-near-black/70">{companyCountLine(open.length, graded.length)}</p>
        </div>
      </div>
      <div className="double-rule" aria-hidden />

      {rec.graded > 0 && (
        <ul className="mt-4 grid max-w-md grid-cols-3 gap-2" aria-label="Graded calls">
          {tiles.map((t) => (
            <li key={t.label} className="rounded-lg border border-cream-border bg-warm-white p-3 text-center">
              <span className="block font-mono text-[24px] font-semibold text-near-black">{t.n}</span>
              <span className="block font-sans text-[13px] text-near-black/70">{t.label}</span>
            </li>
          ))}
        </ul>
      )}

      <section aria-labelledby="open-h" className="mt-8">
        <h2 id="open-h" className="font-display text-[22px] font-bold text-near-black">Open calls</h2>
        {groups.length ? (
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            {groups.map((g) => (
              <ThreadCard key={g.key} group={g} voteUrl={PREDICTS_VOTE_URL} votesEnabled={data.capabilities?.votes ?? false} />
            ))}
          </div>
        ) : (
          <p className="mt-2 font-sans text-[15px] text-near-black/80">No open calls name {company.name} right now.</p>
        )}
      </section>

      {graded.length > 0 && (
        <section aria-labelledby="graded-h" className="mt-8">
          <h2 id="graded-h" className="font-display text-[22px] font-bold text-near-black">Graded calls</h2>
          <div className="mt-3 flex flex-wrap gap-3">
            {graded.map((r) => (
              <CompactCard key={r.prediction_id} row={r} />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
