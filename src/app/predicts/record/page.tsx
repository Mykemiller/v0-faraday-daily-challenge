import { NO_MISSES_LINE } from "@/lib/predicts";
import { predictsGet, type RecordResponse } from "@/lib/predicts-api";
import {
  bandLabel,
  brierText,
  publicCaveat,
  HORIZON_LABEL,
  missedCount,
  recordTiles,
  shortDate,
  showCalibration,
} from "@/lib/predicts-v3";
import CalibrationChart from "../components/CalibrationChart";
import CountUp from "../components/CountUp";
import ReceiptCard from "../components/ReceiptCard";
import Sparkline from "../components/Sparkline";

// Faraday Predicts — the record (UI 3.0, FDY-275). Counts, the Brier score and
// its caveat, and a reliability chart when the API says there is enough to
// draw one. Never a hit rate.

export const metadata = {
  title: "Faraday’s record — Faraday Predicts",
  description: "Every Faraday forecast is graded when its date arrives — misses included.",
};

export default async function RecordPage() {
  const data = await predictsGet<RecordResponse>("view=record");
  const rec = data?.record ?? null;
  const caps = data?.capabilities;
  const bands = data?.calibration ?? [];
  const brier = brierText(rec?.brier);
  const history = data?.brier_history ?? [];
  const graded = data?.graded_this_week ?? [];

  return (
    <main className="mx-auto max-w-4xl px-4 py-6 md:py-8">
      <h1 className="font-display text-[clamp(28px,5vw,40px)] font-bold leading-tight text-near-black">Faraday’s record</h1>
      <p className="mt-1 font-serif text-[clamp(17px,2.4vw,20px)] italic text-forest">Every call is graded when its date arrives — misses included.</p>
      <div className="double-rule" aria-hidden />

      {!rec ? (
        <p className="mt-6 font-sans text-[15px] text-near-black/80">The record is unavailable right now. Please try again shortly.</p>
      ) : (
        <>
          <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Graded calls">
            {recordTiles(rec).map((t) => (
              <li key={t.label} className="rounded-xl bg-warm-cream p-4">
                <span className="block font-mono text-[38px] font-semibold leading-none text-near-black">
                  <CountUp value={t.value} />
                </span>
                <span className="mt-2 block font-mono text-[12px] uppercase tracking-wide text-near-black/75">{t.label}</span>
                {t.sub && <span className="mt-1 block font-mono text-[11px] text-amber-dark">{t.sub}</span>}
              </li>
            ))}
          </ul>
          {rec.inconclusive > 0 && (
            <p className="mt-2 font-mono text-[12px] text-near-black/70">{rec.inconclusive} undetermined</p>
          )}

          <section aria-labelledby="brier-h" className="mt-6 rounded-xl border border-cream-border bg-warm-white p-4">
            <h2 id="brier-h" className="font-display text-[20px] font-bold text-near-black">
              Brier score {brier ?? "—"}
            </h2>
            <p className="mt-1 font-sans text-[15px] text-near-black/80">0 is perfect; 0.25 is what guessing 50% on every call would score.</p>
            {publicCaveat(rec.caveat) ? (
              <p className="mt-2 font-serif text-[15px] italic text-sage-dark">{publicCaveat(rec.caveat)}</p>
            ) : (
              missedCount(rec) === 0 && <p className="mt-2 font-serif text-[15px] italic text-sage-dark">{NO_MISSES_LINE}</p>
            )}
            {history.length >= 3 && (
              <div className="mt-4 [&>span]:flex [&>span]:w-full">
                <Sparkline points={history.map((p) => Math.min(100, Math.max(0, p.brier * 400)))} width={600} height={48} showDelta={false} className="h-12 w-full" label={`Brier score by week, from ${brierText(history[0].brier)} to ${brierText(history[history.length - 1].brier)}; lower is better`} />
                <div className="mt-1 flex justify-between font-mono text-[11px] text-near-black/60">
                  <span>{shortDate(history[0].date)}</span>
                  <span>Lower is better.</span>
                  <span>{shortDate(history[history.length - 1].date)}</span>
                </div>
              </div>
            )}
          </section>

          <section aria-labelledby="cal-h" className="mt-8">
            <h2 id="cal-h" className="font-display text-[22px] font-bold text-near-black">Calibration</h2>
            {showCalibration(caps, bands) ? (
              <div className="mt-3 grid gap-6 md:grid-cols-[360px_1fr]">
                <CalibrationChart bands={bands} />
                <table className="w-full self-start border-collapse font-sans text-[14px]">
                  <caption className="sr-only">Calibration by probability band</caption>
                  <thead>
                    <tr className="border-b border-cream-border text-left text-near-black/70">
                      <th scope="col" className="py-2 font-medium">Band</th>
                      <th scope="col" className="py-2 font-medium">Faraday said</th>
                      <th scope="col" className="py-2 font-medium">Happened (per 100)</th>
                      <th scope="col" className="py-2 font-medium">Calls</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bands.map((b) => (
                      <tr key={b.band} className="border-b border-cream-line font-mono">
                        <td className="py-2 font-sans">{bandLabel(b.band) ?? b.band}</td>
                        <td className="py-2">{b.predicted_mid}</td>
                        <td className="py-2">{b.observed_rate}</td>
                        <td className="py-2">{b.n}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-2 font-sans text-[15px] text-near-black/80">Faraday’s calibration chart appears once enough calls have been graded.</p>
            )}
          </section>

          {(data?.by_horizon?.length ?? 0) > 0 && (
            <section aria-labelledby="hz-h" className="mt-8">
              <h2 id="hz-h" className="font-display text-[22px] font-bold text-near-black">By horizon</h2>
              <table className="mt-3 w-full max-w-2xl border-collapse font-sans text-[14px]">
                <caption className="sr-only">Graded calls by horizon</caption>
                <thead>
                  <tr className="border-b border-cream-border text-left text-near-black/70">
                    <th scope="col" className="py-2 font-medium">Horizon</th>
                    <th scope="col" className="py-2 font-medium">Graded</th>
                    <th scope="col" className="py-2 font-medium">Right</th>
                    <th scope="col" className="py-2 font-medium">Partly right</th>
                    <th scope="col" className="py-2 font-medium">Missed</th>
                  </tr>
                </thead>
                <tbody>
                  {data!.by_horizon!.map((r) => (
                    <tr key={r.horizon_bucket} className="border-b border-cream-line font-mono">
                      <td className="py-2 font-sans">{HORIZON_LABEL[r.horizon_bucket] ?? "Other"}</td>
                      <td className="py-2">{r.graded}</td>
                      <td className="py-2">{r.right}</td>
                      <td className="py-2">{r.partly}</td>
                      <td className="py-2">{r.missed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {graded.length > 0 && (
            <section aria-labelledby="wk-h" className="mt-8">
              <h2 id="wk-h" className="font-display text-[22px] font-bold text-near-black">Graded this week</h2>
              <div className="mt-3 grid gap-4 md:grid-cols-2">
                {graded.map((r) => (
                  <ReceiptCard key={r.prediction_id} row={r} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}
