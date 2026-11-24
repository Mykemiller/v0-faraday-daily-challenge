import { permanentRedirect } from "next/navigation";
import {
  predictsGet,
  PREDICTS_VOTE_URL,
  type CompaniesResponse,
  type OpenResponse,
  type RecordResponse,
} from "@/lib/predicts-api";
import { legacyRedirect, parseOpenState } from "@/lib/predicts-v3";
import OpenBoard from "./OpenBoard";

// Faraday Predicts — the Open board (UI 3.0, FDY-273).
//
// Server-rendered from live data so the first paint (and every crawler) sees
// real forecasts; the client then filters the same set in place, with the URL
// as state. Pre-3.0 ?view= links are permanently redirected first.

const INTRO =
  "Faraday turns the Signals it reads every day into specific, dated forecasts — each with a probability, a resolves-by date and a named Sector. When the date arrives, Faraday grades itself in public.";

export const metadata = {
  title: "Faraday Predicts — Calls you can hold us to",
  description: INTRO,
};

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function Page({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const legacy = legacyRedirect(sp);
  if (legacy) permanentRedirect(legacy);

  const [open, companies, record] = await Promise.all([
    predictsGet<OpenResponse>("view=open&horizon=all"),
    predictsGet<CompaniesResponse>("view=companies"),
    predictsGet<RecordResponse>("view=record"),
  ]);

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 md:py-8">
      <h1 className="font-display text-[clamp(28px,5vw,40px)] font-bold leading-tight tracking-tight text-near-black">Faraday Predicts</h1>
      <p className="mt-1 font-serif text-[clamp(17px,2.4vw,20px)] italic text-forest">Calls you can hold us to.</p>
      <div className="double-rule" aria-hidden />
      <details className="mt-3 md:hidden">
        <summary className="min-h-[44px] cursor-pointer font-sans text-[14px] font-medium text-forest">About these forecasts</summary>
        <p className="mt-1 font-sans text-[15px] leading-relaxed text-near-black/80">{INTRO}</p>
      </details>
      <p className="mt-3 hidden max-w-3xl font-sans text-[16px] leading-relaxed text-near-black/80 md:block">{INTRO}</p>

      <OpenBoard
        initialState={parseOpenState(sp)}
        rows={open?.predictions ?? []}
        theaters={open?.theaters ?? []}
        sectors={open?.sectors ?? []}
        horizonCounts={open?.horizon_counts ?? {}}
        companies={companies?.companies ?? []}
        gradedThisWeek={record?.graded_this_week ?? []}
        votesEnabled={open?.capabilities?.votes ?? false}
        voteUrl={PREDICTS_VOTE_URL}
        failed={!open}
      />
    </main>
  );
}
