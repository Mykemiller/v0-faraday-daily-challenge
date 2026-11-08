import Link from "next/link";
import { redirect } from "next/navigation";
import { predictsGet, type MoversResponse } from "@/lib/predicts-api";
import { moverBadge, shortDate, sortMovers, type MoverWindow } from "@/lib/predicts-v3";
import Sparkline from "../components/Sparkline";

// Faraday Predicts — Movers (UI 3.0, FDY-274): open calls whose published
// probability changed in the last 7 or 14 days, biggest move first.

export const metadata = {
  title: "Movers — Faraday Predicts",
  description: "Open Faraday forecasts whose probability changed in the last week or two.",
};

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function MoversPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const win: MoverWindow = sp.w === "14" ? 14 : 7;
  const data = await predictsGet<MoversResponse>("view=movers");
  if (!data?.capabilities?.movers) redirect("/predicts");
  const rows = sortMovers(data.predictions ?? [], win);

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 md:py-8">
      <h1 className="font-display text-[clamp(26px,4.4vw,36px)] font-bold leading-tight text-near-black">Movers</h1>
      <p className="mt-1 font-serif text-[18px] italic text-forest">Where Faraday changed its mind, and by how much.</p>
      <div className="double-rule" aria-hidden />

      <div role="group" aria-label="Window" className="mt-4 inline-flex rounded-full border border-cream-border p-1">
        {([7, 14] as const).map((w) => (
          <Link
            key={w}
            href={w === 7 ? "/predicts/movers" : "/predicts/movers?w=14"}
            aria-current={w === win ? "page" : undefined}
            className={`inline-flex min-h-[44px] items-center rounded-full px-4 font-sans text-[14px] font-medium ${w === win ? "bg-forest text-warm-white" : "text-forest"}`}
          >
            {w} days
          </Link>
        ))}
      </div>

      {rows.length ? (
        <ol className="mt-5 flex flex-col gap-3">
          {rows.map((r) => (
            <li key={r.prediction_id}>
              <Link data-row href={`/predicts/${r.prediction_id}`} className="flex items-center gap-4 rounded-xl border border-cream-border bg-warm-white p-3 hover:border-forest">
                <div className="min-w-0 flex-1">
                  <p data-claim className="line-clamp-2 font-serif text-[15px] leading-snug text-near-black">{r.prediction_text}</p>
                  <p className="mt-1 font-mono text-[12px] text-near-black/70">by {shortDate(r.target_resolution_date)}</p>
                </div>
                {r.sparkline && r.sparkline.length > 1 && <Sparkline points={r.sparkline} showDelta={false} />}
                <div className="text-right">
                  <span className="block font-mono text-[18px] font-semibold text-near-black">{r.probability_score}%</span>
                  <span className="block whitespace-nowrap font-mono text-[12px] text-forest">{moverBadge(win === 7 ? r.delta_7d : r.delta_14d, win)}</span>
                </div>
              </Link>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-5 font-sans text-[15px] text-near-black/80">No forecast has moved in the last {win} days.</p>
      )}
    </main>
  );
}
