import Link from "next/link";
import { OUTCOME_CHIPS } from "@/lib/predicts";
import {
  predictsGet,
  PREDICTS_API_URL,
  type CompaniesResponse,
  type OpenResponse,
  type ReceiptsResponse,
} from "@/lib/predicts-api";
import {
  HORIZON_LABEL,
  missedCount,
  parseReceiptsState,
  publicCaveat,
  receiptsQuery,
  serializeReceiptsState,
  type ReceiptsState,
} from "@/lib/predicts-v3";
import ReceiptCard from "../components/ReceiptCard";
import LoadMore from "./LoadMore";

// Faraday Predicts — Receipts on the 3.0 shell (FDY-275): every graded call,
// hits and misses on the same footing, newest graded first.

export const metadata = {
  title: "Receipts — Faraday Predicts",
  description: "Every graded Faraday forecast, hits and misses alike, with the evidence.",
};

type SP = Promise<Record<string, string | string[] | undefined>>;

const chip = (on: boolean) =>
  `inline-flex min-h-[44px] items-center gap-1.5 whitespace-nowrap rounded-full border px-4 font-sans text-[14px] font-medium ${
    on ? "border-forest bg-forest text-warm-white" : "border-cream-border bg-warm-white text-near-black hover:border-forest"
  }`;

export default async function ReceiptsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const s = parseReceiptsState(sp);
  const rawCursor = typeof sp.cursor === "string" && sp.cursor.length <= 200 ? sp.cursor : null;
  const [data, open, companies] = await Promise.all([
    predictsGet<ReceiptsResponse>(receiptsQuery(s, rawCursor)),
    predictsGet<OpenResponse>("view=open&horizon=all"),
    predictsGet<CompaniesResponse>("view=companies"),
  ]);
  const rec = data?.record;
  const counts: Record<string, number | null> = rec
    ? { all: rec.graded, right: rec.confirmed, partly: rec.partial, missed: missedCount(rec) }
    : {};
  const theaters = open?.theaters ?? [];
  const sectors = open?.sectors ?? [];
  const at = (patch: Partial<ReceiptsState>) => serializeReceiptsState({ ...s, ...patch });
  const rows = data?.predictions ?? [];

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 md:py-8">
      <h1 className="font-display text-[clamp(28px,5vw,40px)] font-bold leading-tight text-near-black">Receipts</h1>
      <p className="mt-1 font-serif text-[clamp(17px,2.4vw,20px)] italic text-forest">Every graded call, hits and misses on the same footing.</p>
      <div className="double-rule" aria-hidden />

      <nav aria-label="Outcome" className="mt-4 flex gap-2 overflow-x-auto pb-1">
        {OUTCOME_CHIPS.map((c) => (
          <Link key={c.outcome} href={at({ outcome: c.outcome })} aria-current={s.outcome === c.outcome ? "page" : undefined} className={chip(s.outcome === c.outcome)}>
            {c.label}
            {typeof counts[c.outcome] === "number" && <span className="font-mono text-[12px] opacity-80">{counts[c.outcome]}</span>}
          </Link>
        ))}
      </nav>

      {publicCaveat(rec?.caveat) && <p className="mt-2 max-w-3xl font-serif text-[14px] italic text-sage-dark">{publicCaveat(rec?.caveat)}</p>}

      {theaters.length > 0 && (
        <nav data-claim aria-label="Theater" className="mt-2 flex gap-2 overflow-x-auto pb-1">
          <Link href={at({ theater: null, sector: null })} aria-current={!s.theater ? "page" : undefined} className={chip(!s.theater)}>All Theaters</Link>
          {theaters.map((t) => (
            <Link key={t} href={at({ theater: t, sector: null })} aria-current={s.theater === t ? "page" : undefined} className={chip(s.theater === t)}>{t}</Link>
          ))}
        </nav>
      )}

      <details className="mt-3 rounded-xl border border-cream-border bg-warm-white p-3" open={!!(s.sector || s.company || s.h)}>
        <summary className="min-h-[44px] cursor-pointer font-sans text-[15px] font-medium text-forest">Filters</summary>
        <form method="get" action="/predicts/receipts" className="mt-2 grid gap-3 sm:grid-cols-4">
          {s.outcome !== "all" && <input type="hidden" name="outcome" value={s.outcome} />}
          {s.theater && <input type="hidden" name="theater" value={s.theater} />}
          <label className="font-sans text-[14px] text-near-black/80">
            Sector
            <select data-claim name="sector" defaultValue={s.sector ?? ""} className="mt-1 block min-h-[44px] w-full rounded-lg border border-cream-border bg-warm-white px-2">
              <option value="">Any</option>
              {sectors.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </label>
          <label className="font-sans text-[14px] text-near-black/80">
            Company
            <select name="company" defaultValue={s.company ?? ""} className="mt-1 block min-h-[44px] w-full rounded-lg border border-cream-border bg-warm-white px-2">
              <option value="">Any</option>
              {(companies?.companies ?? []).map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
            </select>
          </label>
          <label className="font-sans text-[14px] text-near-black/80">
            Horizon
            <select name="h" defaultValue={s.h ?? ""} className="mt-1 block min-h-[44px] w-full rounded-lg border border-cream-border bg-warm-white px-2">
              <option value="">Any</option>
              {Object.entries(HORIZON_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <div className="flex items-end gap-2">
            <button type="submit" className="min-h-[44px] rounded-full bg-forest px-5 font-sans text-[14px] font-medium text-warm-white">Apply</button>
            <Link href={at({ sector: null, company: null, h: null })} className="inline-flex min-h-[44px] items-center font-sans text-[14px] text-forest underline">Clear</Link>
          </div>
        </form>
      </details>

      {!data ? (
        <p className="mt-6 font-sans text-[15px] text-near-black/80">Receipts are unavailable right now. Please try again shortly.</p>
      ) : rows.length ? (
        <>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {rows.map((r) => (
              <ReceiptCard key={r.prediction_id} row={r} />
            ))}
          </div>
          {data.next_cursor && (
            <LoadMore
              apiUrl={PREDICTS_API_URL}
              query={receiptsQuery(s)}
              cursor={data.next_cursor}
              fallbackHref={`/predicts/receipts?${new URLSearchParams({ ...Object.fromEntries(new URL(`http://x${at({})}`).searchParams), cursor: data.next_cursor })}`}
            />
          )}
        </>
      ) : (
        <p className="mt-6 font-sans text-[15px] text-near-black/80">No graded calls match these filters.</p>
      )}
    </main>
  );
}
