"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import BrandMark from "@/components/BrandMark";
import { SESSION_STORAGE_KEY } from "@/lib/supabase";

// Leaderboard — Global + per-team tabs backed by /api/leaderboard/season.
// Currency: total_points from score_events (season-scoped).
// Authenticated player row always highlighted; pinned below list if outside top N.

interface LeaderboardRow {
  rank: number | null;
  subscriber_id: string;
  handle: string | null;
  total_points: number;
  today_points: number;
  is_you: boolean;
  teams?: Array<{ team_id: string; team_name: string }>;
}

interface TeamTotal {
  team_id: string;
  team_name: string;
  total: number;
  today: number;
}

interface Season {
  id: string;
  name: string;
  starts_on: string;
  ends_on: string;
  free_agency_start: string | null;
  free_agency_notice_start: string | null;
  locked_at: string | null;
}

interface MyTeam {
  team_id: string;
  team_name: string;
}

interface GlobalData {
  season: Season;
  you: LeaderboardRow | null;
  my_teams: MyTeam[];
  leaderboard: LeaderboardRow[];
}

interface TeamData {
  season: Season;
  team_id: string;
  team_total: number;
  team_today_total: number;
  leaderboard: LeaderboardRow[];
}

const NUM = { fontVariantNumeric: "tabular-nums" } as const;

function medal(rank: number | null): string {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return rank == null ? "—" : `#${rank}`;
}

function StandingsRow({ row }: { row: LeaderboardRow }) {
  const display = row.handle || "anonymous";
  const teamNames = (row.teams ?? []).map(t => t.team_name);
  return (
    <div
      className={`grid grid-cols-[2.5rem_1fr_4rem_4.75rem] items-center gap-2 px-3 py-2.5 rounded ${
        row.is_you ? "bg-gold/15 ring-1 ring-gold" : "odd:bg-warm-cream/50"
      }`}
    >
      <span className="text-sm font-semibold text-forest self-start pt-0.5" style={NUM}>
        {medal(row.rank)}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm text-near-black">{display}</span>
          {row.is_you && (
            <span className="text-[10px] uppercase tracking-wide text-amber-600">you</span>
          )}
        </span>
        {teamNames.length > 0 && (
          <span className="block truncate font-mono text-[10px] text-near-black/45 mt-0.5">
            {teamNames.slice(0, 2).join(" · ")}
            {teamNames.length > 2 ? ` +${teamNames.length - 2}` : ""}
          </span>
        )}
      </span>
      <span className="text-right text-sm text-near-black/70 self-start pt-0.5" style={NUM}>
        {row.today_points.toLocaleString()}
      </span>
      <span className="text-right text-sm font-semibold text-near-black self-start pt-0.5" style={NUM}>
        {row.total_points.toLocaleString()}
      </span>
    </div>
  );
}

function TeamTotalRow({ team, rank }: { team: TeamTotal; rank: number }) {
  return (
    <div className="grid grid-cols-[2.5rem_1fr_4rem_4.75rem] items-center gap-2 px-3 py-3 rounded odd:bg-warm-cream/50">
      <span className="text-sm font-semibold text-forest" style={NUM}>
        #{rank}
      </span>
      <span className="truncate text-sm font-semibold text-near-black">
        {team.team_name}
      </span>
      <span className="text-right text-sm text-near-black/70" style={NUM}>
        {team.today.toLocaleString()}
      </span>
      <span className="text-right text-sm font-semibold text-near-black" style={NUM}>
        {team.total.toLocaleString()}
      </span>
    </div>
  );
}

function SkeletonRows() {
  return (
    <div aria-hidden className="animate-pulse space-y-0.5">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="grid grid-cols-[2.5rem_1fr_4rem_4.75rem] items-center gap-2 px-3 py-2.5">
          <span className="h-4 w-6 rounded bg-warm-gray/50" />
          <span className="h-4 w-32 rounded bg-warm-gray/50" />
          <span className="h-4 w-8 justify-self-end rounded bg-warm-gray/50" />
          <span className="h-4 w-10 justify-self-end rounded bg-warm-gray/50" />
        </div>
      ))}
    </div>
  );
}

export default function LeaderboardPage() {
  const [activeTab, setActiveTab] = useState<"global" | string>("global");
  const [teamsView, setTeamsView] = useState(false);
  const [globalData, setGlobalData] = useState<GlobalData | null>(null);
  const [teamData, setTeamData] = useState<TeamData | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [shareMsg, setShareMsg] = useState("");

  const getToken = () => {
    try { return localStorage.getItem(SESSION_STORAGE_KEY); } catch { return null; }
  };

  const loadGlobal = useCallback(async () => {
    setStatus("loading");
    const token = getToken();
    const qs = token ? `?token=${encodeURIComponent(token)}` : "";
    try {
      const res = await fetch(`/api/leaderboard/season${qs}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as GlobalData;
      setGlobalData(json);
      setTeamData(null);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);

  const loadTeam = useCallback(async (teamId: string) => {
    setStatus("loading");
    const token = getToken();
    const qs = new URLSearchParams({ team_id: teamId });
    if (token) qs.set("token", token);
    try {
      const res = await fetch(`/api/leaderboard/season?${qs.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as TeamData;
      setTeamData(json);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    if (activeTab === "global") {
      loadGlobal();
    } else {
      loadTeam(activeTab);
    }
  }, [activeTab, loadGlobal, loadTeam]);

  // Deep-link: /leaderboard?view=teams opens the Teams tab (header "Compete →
  // Teams" targets this). Runs once on mount; window.location keeps it out of
  // the useSearchParams/Suspense contract.
  useEffect(() => {
    try {
      if (new URLSearchParams(window.location.search).get("view") === "teams") setTeamsView(true);
    } catch { /* no search */ }
  }, []);

  const myTeams = globalData?.my_teams ?? [];
  const season = globalData?.season ?? teamData?.season ?? null;

  const leaderboard = activeTab === "global"
    ? (globalData?.leaderboard ?? [])
    : (teamData?.leaderboard ?? []);

  const you = activeTab === "global"
    ? (globalData?.you ?? null)
    : (leaderboard.find(r => r.is_you) ?? null);

  const youInList = leaderboard.some(r => r.is_you);

  // Team aggregate totals — computed from global leaderboard rows (each row now carries teams[])
  const teamTotals: TeamTotal[] = (() => {
    if (!globalData) return [];
    const map = new Map<string, TeamTotal>();
    for (const row of globalData.leaderboard) {
      for (const t of row.teams ?? []) {
        const e = map.get(t.team_id);
        if (e) {
          e.total += row.total_points;
          e.today += row.today_points;
        } else {
          map.set(t.team_id, {
            team_id: t.team_id,
            team_name: t.team_name,
            total: row.total_points,
            today: row.today_points,
          });
        }
      }
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  })();

  async function share() {
    if (!you) return;
    const text = `${you.total_points.toLocaleString()} pts · #${you.rank} on the Faraday season leaderboard — faraday-intelligence.ai/leaderboard`;
    if (typeof navigator !== "undefined" && navigator.share) {
      try { await navigator.share({ text }); } catch { /* cancelled */ }
    } else {
      try {
        await navigator.clipboard.writeText(text);
        setShareMsg("Copied ✓");
        setTimeout(() => setShareMsg(""), 2500);
      } catch { /* clipboard blocked */ }
    }
  }

  return (
    <div className="min-h-screen bg-warm-white font-sans text-near-black">
      <div className="h-0.5 bg-gold" />
      <header className="bg-forest">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-5 py-3">
          <Link href="/daily-challenge" className="flex items-center gap-3" aria-label="Daily Challenge">
            <BrandMark size={20} framed />
            <span className="leading-tight">
              <span className="block font-serif text-[15px] font-bold tracking-wide text-warm-white">Faraday</span>
              <span className="block font-mono text-[10px] tracking-[0.18em] text-sage">DAILY CHALLENGE</span>
            </span>
          </Link>
          {/* Nav — matches the in-app masthead: white capital letters D · L · A. */}
          <nav className="ml-auto flex items-center gap-1.5">
            <NavLetter letter="D" label="Challenge" href="/daily-challenge" />
            <NavLetter letter="L" label="Leaderboard" active />
            <NavLetter letter="A" label="Account" href="/account" />
          </nav>
        </div>
      </header>
      <div className="h-0.5 bg-gold" />

      <main className="mx-auto max-w-2xl px-5 pb-16 pt-8">
        <h1 className="font-serif text-3xl font-bold text-forest">Leaderboard</h1>
        {season && (
          <p className="mb-5 mt-1 text-sm text-near-black/60">{season.name}</p>
        )}

        {/* Tab row: Global · Teams · per-team tabs */}
        <div className="mb-4 flex flex-wrap gap-1.5">
          <TabChip
            label="Global"
            active={activeTab === "global" && !teamsView}
            onClick={() => { setActiveTab("global"); setTeamsView(false); }}
          />
          <TabChip
            label="Teams"
            active={teamsView}
            onClick={() => { setActiveTab("global"); setTeamsView(true); }}
          />
          {myTeams.map(t => (
            <TabChip
              key={t.team_id}
              label={t.team_name}
              active={activeTab === t.team_id && !teamsView}
              onClick={() => { setActiveTab(t.team_id); setTeamsView(false); }}
            />
          ))}
        </div>

        {/* Team aggregate score */}
        {status === "ready" && activeTab !== "global" && teamData && (
          <div className="mb-5 rounded-lg border border-forest/20 bg-warm-cream/60 p-4">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-serif text-lg font-bold text-forest">
                {myTeams.find(t => t.team_id === activeTab)?.team_name ?? "Team"}
              </span>
              <div className="flex items-start gap-5">
                <div className="text-right">
                  <div className="text-xl font-bold text-forest" style={NUM}>
                    {(teamData.team_today_total ?? 0).toLocaleString()}
                  </div>
                  <div className="text-[10px] uppercase tracking-wide text-near-black/40">Today</div>
                </div>
                <div className="text-right">
                  <div className="text-xl font-bold text-forest" style={NUM}>
                    {teamData.team_total.toLocaleString()}
                  </div>
                  <div className="text-[10px] uppercase tracking-wide text-near-black/40">Season</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* You card */}
        <section className="mb-6">
          {status === "ready" && !you && (
            <div className="rounded-lg border border-gold/40 bg-gold/5 p-5 text-center">
              <p className="mb-3 text-near-black/80">Sign in to track your rank.</p>
              <Link
                href="/daily-challenge"
                className="inline-block rounded bg-gold px-5 py-2.5 font-semibold text-forest transition-colors hover:bg-gold-light"
              >
                Play &amp; join →
              </Link>
            </div>
          )}
          {status === "ready" && you && (
            <div className="rounded-lg border-2 border-gold bg-gold/10 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold text-forest">
                      {you.handle || "You"}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-near-black/60" style={NUM}>
                    {you.rank == null ? "Unranked — play to earn points" : `#${you.rank.toLocaleString()}`}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <div className="text-right">
                    <div className="text-xl font-bold text-forest" style={NUM}>
                      {you.today_points.toLocaleString()}
                    </div>
                    <div className="text-[11px] uppercase tracking-wide text-near-black/50">today</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xl font-bold text-near-black" style={NUM}>
                      {you.total_points.toLocaleString()}
                    </div>
                    <div className="text-[11px] uppercase tracking-wide text-near-black/50">season</div>
                  </div>
                  <button
                    onClick={share}
                    aria-label="Share your rank"
                    className="rounded border border-forest/30 px-3 py-2 text-sm text-forest hover:bg-warm-white"
                  >
                    Share
                  </button>
                </div>
              </div>
              {shareMsg && <p className="mt-2 text-xs text-forest">{shareMsg}</p>}
            </div>
          )}
          {status === "loading" && (
            <div className="h-[76px] animate-pulse rounded-lg bg-warm-gray/40" />
          )}
        </section>

        {/* Standings */}
        <section>
          <div className="grid grid-cols-[2.5rem_1fr_4rem_4.75rem] items-center gap-2 px-3 pb-2 text-[11px] uppercase tracking-wide text-near-black/40">
            <span>Rank</span>
            <span>{teamsView ? "Team" : "Player"}</span>
            <span className="text-right">Today</span>
            <span className="text-right">Season</span>
          </div>

          {status === "loading" && <SkeletonRows />}

          {status === "error" && (
            <div className="py-10 text-center">
              <p className="mb-3 text-near-black/70">Couldn&apos;t load the leaderboard.</p>
              <button
                onClick={() => activeTab === "global" ? loadGlobal() : loadTeam(activeTab)}
                className="rounded border border-warm-gray px-4 py-2 text-sm hover:bg-warm-cream"
              >
                Retry
              </button>
            </div>
          )}

          {/* Teams aggregate view */}
          {status === "ready" && teamsView && (
            teamTotals.length === 0 ? (
              <div className="py-10 text-center text-near-black/60">
                No team scores yet.
              </div>
            ) : (
              <div className="space-y-0.5">
                {teamTotals.map((t, i) => (
                  <TeamTotalRow key={t.team_id} team={t} rank={i + 1} />
                ))}
              </div>
            )
          )}

          {/* Player standings view */}
          {status === "ready" && !teamsView && leaderboard.length === 0 && (
            <div className="py-10 text-center text-near-black/60">
              No scores yet — be the first to play.
            </div>
          )}

          {status === "ready" && !teamsView && leaderboard.length > 0 && (
            <div className="space-y-0.5">
              {leaderboard.map(r => (
                <StandingsRow key={r.subscriber_id} row={r} />
              ))}
              {you && !youInList && (
                <>
                  <div className="select-none py-1 text-center text-near-black/30">···</div>
                  <StandingsRow row={you} />
                </>
              )}
            </div>
          )}
        </section>

        {/* Admin testing utilities */}
        <section className="mt-10 border-t border-red-200 pt-6">
          <p className="mb-3 text-[11px] uppercase tracking-wide text-red-400">Admin · Testing Only</p>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={async () => {
                if (!confirm("Reset ALL player scores? Cannot be undone.")) return;
                const res = await fetch("/api/admin/reset-scores", { method: "POST" });
                if (res.ok) { alert("All scores reset."); activeTab === "global" ? loadGlobal() : loadTeam(activeTab); }
                else { const d = await res.json().catch(() => ({})); alert(`Reset failed: ${(d as {error?: string}).error ?? res.status}`); }
              }}
              style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.3)", color: "#F87171" }}
              className="rounded px-4 py-2 text-sm font-mono"
            >
              ⚠ Reset All Scores
            </button>
            <button
              onClick={async () => {
                if (!confirm("Delete all subscribers except 'myke'? Cannot be undone.")) return;
                const res = await fetch("/api/admin/clear-subscribers", { method: "POST" });
                if (res.ok) { alert("Subscribers cleared (myke preserved)."); loadGlobal(); }
                else { const d = await res.json().catch(() => ({})); alert(`Clear failed: ${(d as {error?: string}).error ?? res.status}`); }
              }}
              style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.3)", color: "#F87171" }}
              className="rounded px-4 py-2 text-sm font-mono"
            >
              ⚠ Clear All Subscribers
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}

// Header nav mark — a white capital letter (D · L · A) mirroring the in-app
// masthead. Active tab is marked by the gold underline; non-active links navigate.
function NavLetter({ letter, label, href, active }: { letter: string; label: string; href?: string; active?: boolean }) {
  const inner = (
    <span
      className={`relative flex min-w-[52px] flex-col items-center gap-[3px] rounded-lg px-1.5 pb-1.5 pt-1.5 transition-colors ${
        active ? "bg-forest-mid/50" : "hover:bg-forest-mid/40"
      }`}
    >
      <span className="grid h-10 w-10 place-items-center font-serif text-[25px] font-extrabold leading-none text-warm-white">
        {letter}
      </span>
      <span className={`font-mono text-[8px] uppercase tracking-[0.1em] ${active ? "text-gold" : "text-sage"}`}>
        {label}
      </span>
      {active && <span aria-hidden className="absolute inset-x-[12%] bottom-0 h-0.5 rounded bg-gold" />}
    </span>
  );
  return href ? (
    <Link href={href} aria-label={label}>{inner}</Link>
  ) : (
    <span aria-label={label} aria-current="page">{inner}</span>
  );
}

function TabChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs transition-colors ${
        active
          ? "border-forest bg-forest text-warm-white"
          : "border-warm-gray text-near-black/70 hover:border-forest/40"
      }`}
    >
      {label}
    </button>
  );
}
