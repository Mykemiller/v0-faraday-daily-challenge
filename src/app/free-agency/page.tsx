import Link from "next/link";
import SiteHeaderNav from "@/components/SiteHeaderNav";
import SiteFooter from "@/components/SiteFooter";
import DcStubPage from "@/components/DcStubPage";
import { fetchActiveSeason, type PlayoffSeason } from "@/lib/league-playoffs/server";
import {
  isRosterFrozen,
  moveWindows,
  rosterMoveState,
  seasonToday,
  type DateWindow,
} from "@/lib/league-playoffs/phase";

export const metadata = { title: "Free Agency · Faraday Daily Challenge" };
export const dynamic = "force-dynamic";

// Compete → Free Agency. Season-scoped: teams lock during the season and players
// move only inside an open period — the opening trading window, the closing
// trading window, or free agency itself (CC-LO-FA-WINDOWS-1.0).
//
// This page is READ-ONLY. It answers "can I move right now, and if not, when?"
// The roster editor itself lives on /account; sending players there keeps one
// picker rather than a second half-implementation.
//
// Falls back to the original stub whenever it cannot answer honestly: no
// service key, no active season, or an active season that stores no windows
// (which is every season created before 2026-09-07 — those are never gated, so
// promising a schedule would be a lie).

function svcHeaders(): Record<string, string> | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return { apikey: key, Authorization: `Bearer ${key}` };
}

function fmt(d: string): string {
  const t = new Date(d + "T12:00:00Z");
  return t.toLocaleDateString("en-US", {
    timeZone: "UTC", month: "long", day: "numeric", year: "numeric",
  });
}

function windowLabel(w: DateWindow, season: PlayoffSeason): string {
  const isFa = season.free_agency_start === w.from;
  return isFa ? "Free agency" : w.from === season.trading_open_starts_on
    ? "Opening trading window"
    : "Closing trading window";
}

export default async function FreeAgencyPage() {
  const h = svcHeaders();
  const season = h ? await fetchActiveSeason(h) : null;
  const state = season ? rosterMoveState(season, seasonToday(season.tz)) : null;

  // Not gated (or unknowable) → the honest stub, unchanged.
  if (!season || !state?.gated) {
    return (
      <DcStubPage
        title="Free Agency"
        blurb="Move between teams during the season's trading window. Season-scoped — outside the window, rosters stay locked."
      >
        <p className="font-mono text-[13px] text-forest">Trade window: TBD</p>
        <p>
          When the window opens you&rsquo;ll be able to leave a team and join another without
          losing your season score. Details land here before the first window.
        </p>
      </DcStubPage>
    );
  }

  const today = seasonToday(season.tz);
  const frozen = isRosterFrozen(season, today);
  const windows = moveWindows(season);
  const open = state.open && !frozen;

  return (
    <div className="min-h-screen bg-warm-white font-sans text-near-black">
      <SiteHeaderNav />
      <main className="mx-auto max-w-2xl px-5 pb-16 pt-10">
        <span
          className={`inline-block rounded px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] ${
            open ? "bg-forest/15 text-forest" : "bg-gold/20 text-amber-dark"
          }`}
        >
          {frozen ? "Rosters frozen" : open ? "Open now" : "Closed"}
        </span>

        <h1 className="mt-4 font-serif text-3xl font-bold text-forest">Free Agency</h1>

        <p className="mt-3 max-w-[52ch] text-[15px] leading-relaxed text-near-black/70">
          {frozen
            ? "Rosters are frozen for the playoffs. No moves for the rest of the season — free agency does not reopen them."
            : open
              ? "You can move between teams right now, without losing your season score."
              : "Rosters are locked outside the trading windows. Your season score is unaffected while you wait."}
        </p>

        {!open && !frozen && state.nextWindow ? (
          <p className="mt-3 font-mono text-[13px] text-forest">
            Next window opens {fmt(state.nextWindow.from)}.
          </p>
        ) : null}

        <div className="mt-8">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-near-black/45">
            {season.name ?? "This season"} · move schedule
          </div>
          <ul className="mt-3 space-y-2">
            {windows.map((w) => {
              const isNow = today >= w.from && today <= w.to;
              const isPast = today > w.to;
              return (
                <li
                  key={`${w.from}-${w.to}`}
                  className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded border px-3 py-2 text-[14px] ${
                    isNow && !frozen
                      ? "border-forest/40 bg-forest/5"
                      : "border-near-black/10 bg-white"
                  } ${isPast ? "opacity-55" : ""}`}
                >
                  <span className="font-semibold text-near-black/85">
                    {windowLabel(w, season)}
                  </span>
                  <span className="font-mono text-[12.5px] text-near-black/60">
                    {fmt(w.from)} – {fmt(w.to)}
                  </span>
                  {isNow && !frozen ? (
                    <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-forest">
                      open
                    </span>
                  ) : isPast ? (
                    <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-near-black/40">
                      closed
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-[12.5px] leading-relaxed text-near-black/55">
            Joining your first team is never blocked — these windows govern moving once
            you already hold one.
          </p>
        </div>

        <p className="mt-8 text-[14px] leading-relaxed text-near-black/70">
          <Link href="/account" className="underline hover:text-forest">
            Manage your teams on your account page
          </Link>
          .
        </p>

        <p className="mt-10 font-mono text-[11px] text-near-black/50">
          <Link href="/challenge" className="underline hover:text-forest">
            ← Back to the Daily Challenge
          </Link>
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
