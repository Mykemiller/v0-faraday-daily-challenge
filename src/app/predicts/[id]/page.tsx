import Link from "next/link";
import { notFound } from "next/navigation";
import { noEvidenceLine } from "@/lib/predicts";
import { predictsGet, PREDICTS_VOTE_URL, type OneResponse } from "@/lib/predicts-api";
import {
  bandLabel,
  clampTitle,
  historyChanges,
  publicNote,
  RESOLVES_COPY,
  serializeOpenState,
  DEFAULT_OPEN_STATE,
  shortDate,
  sinceCalledText,
  statusStrip,
} from "@/lib/predicts-v3";
import ChangesTable from "../components/ChangesTable";
import CompactCard from "../components/CompactCard";
import CompanyMark from "../components/CompanyMark";
import CountUp from "../components/CountUp";
import HistoryChart from "../components/HistoryChart";
import ShareButton from "../components/ShareButton";
import { VelocityChip, VelocityEvidence } from "../components/Velocity";
import VotePills from "../components/VotePills";
import WatchStar from "../components/WatchStar";

// Faraday Predicts — one forecast (UI 3.0, FDY-274).

type P = Promise<{ id: string }>;
const ID_RE = /^[0-9a-f-]{36}$/i;

async function load(id: string): Promise<OneResponse | null> {
  if (!ID_RE.test(id)) return null;
  return predictsGet<OneResponse>(`view=one&id=${encodeURIComponent(id)}`);
}

export async function generateMetadata({ params }: { params: P }) {
  const { id } = await params;
  const data = await load(id);
  if (!data) return { title: "Forecast not found — Faraday Predicts" };
  const r = data.prediction;
  const sector = r.taxonomy?.sector ?? r.sector_name;
  const desc = [`${r.probability_score}%`, r.target_resolution_date ? `resolves ${shortDate(r.target_resolution_date)}` : null, sector]
    .filter(Boolean)
    .join(" · ");
  const title = `${clampTitle(r.prediction_text)} — Faraday Predicts`;
  return { title, description: desc, openGraph: { title, description: desc }, twitter: { card: "summary_large_image", title, description: desc } };
}

const TONE_BAR: Record<string, string> = {
  open: "border-forest bg-warm-white text-forest",
  right: "border-forest bg-sage-light/30 text-forest",
  partly: "border-amber-dark bg-warm-cream text-amber-dark",
  miss: "border-brick bg-warm-cream text-brick",
  undetermined: "border-cream-border bg-cream-line text-near-black/70",
};

export default async function ForecastPage({ params }: { params: P }) {
  const { id } = await params;
  const data = await load(id);
  if (!data) notFound();
  const r = data.prediction;
  const caps = data.capabilities;
  const graded = r.status !== "active";
  const strip = statusStrip(r);
  const history = r.history ?? [];
  const since = sinceCalledText(history, r.probability_score);
  const band = bandLabel(r.probability_band);
  const sector = r.taxonomy?.sector ?? r.sector_name;
  const theater = r.taxonomy?.theater ?? null;
  const related = data.related ?? [];

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 md:py-8">
      <nav data-claim aria-label="Breadcrumb" className="font-mono text-[11px] uppercase tracking-wide text-sage-dark">
        <Link href="/predicts" className="underline-offset-2 hover:underline">Predicts</Link>
        {theater && (
          <>
            {" › "}
            <Link href={serializeOpenState({ ...DEFAULT_OPEN_STATE, theater })} className="underline-offset-2 hover:underline">{theater}</Link>
          </>
        )}
        {sector && (
          <>
            {" › "}
            <Link href={serializeOpenState({ ...DEFAULT_OPEN_STATE, theater, sector })} className="underline-offset-2 hover:underline">{sector}</Link>
          </>
        )}
      </nav>

      {!!r.companies?.length && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {r.companies.map((c) => (
            <li key={c.slug}>
              <Link href={`/predicts/company/${c.slug}`} className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-cream-border px-3 font-sans text-[14px] text-near-black hover:border-forest">
                <CompanyMark name={c.name} slug={c.slug} size={24} />
                {c.name}
              </Link>
            </li>
          ))}
        </ul>
      )}

      <h1 data-claim className="mt-3 font-serif text-[clamp(22px,3.6vw,30px)] leading-snug text-near-black">{r.prediction_text}</h1>

      <div data-row className={`mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border-l-4 px-3 py-2 font-sans text-[14px] font-medium ${TONE_BAR[strip.tone]}`}>
        <span>{strip.label}</span>
        <span className="text-near-black/70">Called {shortDate(r.date_created)}</span>
        {r.is_bold && <span className="rounded-full bg-gold/15 px-2 py-0.5 font-mono text-[12px] font-semibold text-near-black">Bold call</span>}
        <VelocityChip tag={r.velocity_tag} />
        <span className="sr-only">{r.probability_score}% · {shortDate(r.target_resolution_date)}</span>
      </div>

      <section aria-labelledby="prob-h" className="mt-6 rounded-xl border border-cream-border bg-warm-white p-4">
        <h2 id="prob-h" className="font-sans text-[13px] font-medium uppercase tracking-wide text-near-black/70">
          {graded ? "Faraday called it at" : "Faraday’s probability"}
        </h2>
        <p className="mt-1 flex items-baseline gap-3">
          <span className="font-mono text-[56px] font-semibold leading-none text-near-black">
            <CountUp value={r.probability_score} />%
          </span>
          {band && <span className="font-sans text-[16px] text-near-black/80">{band}</span>}
          {since && !graded && <span className="font-mono text-[14px] text-forest">{since}</span>}
        </p>
        <VelocityEvidence posture={r.evidence_posture} layers={r.source_layers} className="mt-3" />
        {caps?.history !== false && (
          <div className="mt-4">
            <HistoryChart history={history} called={history[0]?.probability ?? r.probability_score} resolutionDate={graded ? r.resolution_date : null} />
          </div>
        )}
      </section>

      {historyChanges(history).length > 0 && (
        <section aria-labelledby="changes-h" className="mt-6">
          <h2 id="changes-h" className="font-display text-[20px] font-bold text-near-black">Changes</h2>
          <div className="mt-2">
            <ChangesTable changes={historyChanges(history)} />
          </div>
        </section>
      )}

      <section aria-labelledby="resolves-h" className="mt-6">
        <h2 id="resolves-h" className="font-display text-[20px] font-bold text-near-black">How this resolves</h2>
        <p className="mt-2 font-sans text-[15px] leading-relaxed text-near-black/80">{RESOLVES_COPY}</p>
        {graded && (
          <div className="mt-3 rounded-lg border border-cream-border bg-warm-white p-3 font-sans text-[15px] leading-relaxed text-near-black/85">
            {publicNote(r.resolution_note) ? <p data-claim>{publicNote(r.resolution_note)}</p> : r.outcome === "didnt_happen" ? <p>{noEvidenceLine(r.target_resolution_date)}</p> : null}
            {r.evidence_url && (
              <a href={r.evidence_url} rel="noopener noreferrer nofollow" target="_blank" className="mt-2 inline-flex min-h-[44px] items-center font-medium text-forest underline">
                Evidence
              </a>
            )}
          </div>
        )}
      </section>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        {!graded && <VotePills id={r.prediction_id} votes={r.votes} voteUrl={PREDICTS_VOTE_URL} enabled={caps?.votes ?? false} />}
        <WatchStar id={r.prediction_id} />
        <ShareButton title={clampTitle(r.prediction_text)} />
      </div>

      {related.length > 0 && (
        <section aria-labelledby="related-h" className="mt-8">
          <h2 id="related-h" className="font-display text-[20px] font-bold text-near-black">More in this Thread</h2>
          <div className="mt-3 flex snap-x gap-3 overflow-x-auto pb-2">
            {related.map((x) => (
              <CompactCard key={x.prediction_id} row={x} />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
