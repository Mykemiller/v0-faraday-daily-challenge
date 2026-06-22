"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import BrandMark from "@/components/BrandMark";
import { EDGE_FUNCTIONS_BASE, SESSION_STORAGE_KEY } from "@/lib/supabase";

// Leaderboard V2 — Global + group-scoped board (§3, §7.4). Period-scoped ranking
// from get-leaderboard (global) and get-team-leaderboard (team/company). Currency
// is "Signals" everywhere. Bands: A (You) · B (Standings) · C (Group bar). No
// fabricated zero rows; no raw emails.

type Period = "daily" | "season";
type MovementValue = number | null;

interface Row {
  rank: number | null;
  handle: string;
  signals: number;
  playStreak: number;
  fullSetStreak: number;
  movement: MovementValue;
  isYou: boolean;
}
interface You {
  rank: number | null;
  percentile: number | null;
  signals: number;
  playStreak: number;
  fullSetStreak: number;
  movement: MovementValue;
  handle: string;
}
interface GroupRef { code: string; name: string; groupType: "company" | "team" | "custom"; parentCode: string | null; memberCount: number }
interface GroupBar extends GroupRef {
  parentName: string | null;
  teamVsTeam: { rank: number; of: number } | null;
  companyVsCompany: { rank: number; of: number; beatsPct: number } | null;
}
interface Board {
  period: Period;
  seasonName?: string;
  dayLabel?: string;
  you: You | null;
  leaderboard: Row[];
  totalPlayers: number;
  count: number;
  myGroups?: GroupRef[];
  group?: GroupBar;
}

const GRID = "grid grid-cols-[2.75rem_1fr_5rem_3.25rem] items-center gap-2";
const NUM = { fontVariantNumeric: "tabular-nums" } as const;

function medal(rank: number | null): string {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return rank == null ? "—" : `#${rank}`;
}

function Movement({ value }: { value: MovementValue }) {
  if (value == null || value === 0) return <span className="text-near-black/30">—</span>;
  const up = value > 0;
  return (
    <span className={up ? "text-green-600" : "text-red-600"} style={NUM}>
      {up ? "▲" : "▼"}{Math.abs(value)}
    </span>
  );
}

function StreakPip({ days }: { days: number }) {
  if (!days) return null;
  return <span className="ml-2 text-[11px] text-near-black/50 whitespace-nowrap" style={NUM}>🔥{days}</span>;
}

function topPercentLabel(p: number | null): string | null {
  if (p == null) return null;
  return `Top ${Math.max(1, 100 - p)}%`;
}

function StandingsRow({ row }: { row: Row }) {
  return (
    <div className={`${GRID} px-3 py-2.5 rounded ${row.isYou ? "bg-gold/15 ring-1 ring-gold" : "odd:bg-warm-cream/50"}`}>
      <span className="text-sm font-semibold text-forest" style={NUM}>{medal(row.rank)}</span>
      <span className="min-w-0 flex items-center">
        <span className="truncate text-sm text-near-black">{row.handle}</span>
        {row.isYou && <span className="ml-1.5 text-[10px] uppercase tracking-wide text-amber-dark">you</span>}
        <StreakPip days={row.playStreak} />
      </span>
      <span className="text-right text-sm font-semibold text-near-black" style={NUM}>{row.signals.toLocaleString()}</span>
      <span className="text-right text-xs"><Movement value={row.movement} /></span>
    </div>
  );
}

function SkeletonRows() {
  return (
    <div aria-hidden className="animate-pulse">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className={`${GRID} px-3 py-2.5`}>
          <span className="h-4 w-6 rounded bg-warm-gray/50" />
          <span className="h-4 w-32 rounded bg-warm-gray/50" />
          <span className="h-4 w-10 justify-self-end rounded bg-warm-gray/50" />
          <span className="h-4 w-6 justify-self-end rounded bg-warm-gray/50" />
        </div>
      ))}
    </div>
  );
}

export default function LeaderboardPage() {
  const [period, setPeriod] = useState<Period>("daily");
  const [scope, setScope] = useState<string>("global"); // "global" | group code
  const [data, setData] = useState<Board | null>(null);
  const [groups, setGroups] = useState<GroupRef[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [shareMsg, setShareMsg] = useState("");

  const load = useCallback(async (sc: string, p: Period) => {
    setStatus("loading");
    let token: string | null = null;
    try { token = localStorage.getItem(SESSION_STORAGE_KEY); } catch { /* storage disabled */ }
    const qs = new URLSearchParams({ period: p, limit: "50" });
    if (token) qs.set("token", token);
    const endpoint = sc === "global"
      ? `${EDGE_FUNCTIONS_BASE}/get-leaderboard?scope=global&${qs.toString()}`
      : `${EDGE_FUNCTIONS_BASE}/get-team-leaderboard?teamCode=${encodeURIComponent(sc)}&${qs.toString()}`;
    try {
      const res = await fetch(endpoint);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as Board;
      setData(json);
      if (json.myGroups) setGroups(json.myGroups); // only the global call carries the group list
      setStatus("ready");
    } catch (e) {
      console.error("Leaderboard load failed:", e);
      setStatus("error");
    }
  }, []);

  useEffect(() => { load(scope, period); }, [scope, period, load]);

  const you = data?.you ?? null;
  const youInList = !!data?.leaderboard.some((r) => r.isYou);
  const companies = groups.filter((g) => g.groupType === "company");
  const teams = groups.filter((g) => g.groupType === "team");

  async function share() {
    if (!you) return;
    const tp = topPercentLabel(you.percentile) ?? "Unranked";
    const groupName = data?.group?.name;
    const text = `${you.signals.toLocaleString()} Signals · #${you.rank} (${tp}) · ${you.playStreak}-day streak${groupName ? ` · ${groupName}` : ""} — faraday-intelligence.ai/leaderboard`;
    if (typeof navigator !== "undefined" && navigator.share) {
      try { await navigator.share({ text }); } catch { /* user cancelled */ }
    } else {
      try { await navigator.clipboard.writeText(text); setShareMsg("Copied to clipboard ✓"); setTimeout(() => setShareMsg(""), 2500); } catch { /* clipboard blocked */ }
    }
  }

  async function leaveGroup(code: string) {
    let token: string | null = null;
    try { token = localStorage.getItem(SESSION_STORAGE_KEY); } catch { /* */ }
    if (!token) return;
    try {
      await fetch(`${EDGE_FUNCTIONS_BASE}/team-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionToken: token, action: "leave", code }),
      });
    } catch (e) { console.error("Leave failed:", e); }
    setScope("global");
  }

  const subhead = scope !== "global" && data?.group
    ? `${data.group.name}${data.group.parentName ? ` · ${data.group.parentName}` : ""}`
    : period === "season"
      ? data?.seasonName ?? "Season"
      : "Today · resets midnight Central";

  return (
    <div className="min-h-screen bg-warm-white font-sans text-near-black">
      <div className="h-0.5 bg-gold" />
      <header className="bg-forest">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-5 py-3">
          <Link href="/daily-challenge" className="flex items-center gap-3" aria-label="Daily Challenge">
            <BrandMark size={20} framed />
            <span className="font-serif text-[15px] font-bold tracking-wide text-warm-white">Faraday</span>
          </Link>
          <Link href="/daily-challenge" className="ml-auto font-mono text-[11px] text-warm-cream hover:text-gold-light">
            ← Daily Challenge
          </Link>
        </div>
      </header>
      <div className="h-0.5 bg-gold" />

      <main className="mx-auto max-w-2xl px-5 pb-16 pt-8">
        <h1 className="font-serif text-3xl font-bold text-forest">Leaderboard</h1>
        <p className="mb-5 mt-1 text-sm text-near-black/60">{subhead}</p>

        {/* Scope selector: Global · My Team(s) · My Company */}
        {groups.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            <ScopeChip label="Global" active={scope === "global"} onClick={() => setScope("global")} />
            {teams.map((g) => (
              <ScopeChip key={g.code} label={g.name} active={scope === g.code} onClick={() => setScope(g.code)} />
            ))}
            {companies.map((g) => (
              <ScopeChip key={g.code} label={`🏢 ${g.name}`} active={scope === g.code} onClick={() => setScope(g.code)} />
            ))}
          </div>
        )}

        {/* Period selector */}
        <div className="mb-6 inline-flex rounded-lg border border-warm-gray p-0.5" role="tablist">
          {(["daily", "season"] as Period[]).map((p) => (
            <button
              key={p} role="tab" aria-selected={period === p} onClick={() => setPeriod(p)}
              className={`rounded-md px-4 py-1.5 text-sm transition-colors ${period === p ? "bg-gold font-semibold text-forest" : "text-near-black/60 hover:text-near-black"}`}
            >
              {p === "daily" ? "Today" : "Season"}
            </button>
          ))}
        </div>

        {/* Band C — Group bar */}
        {status === "ready" && scope !== "global" && data?.group && (
          <section className="mb-6 rounded-lg border border-forest/20 bg-warm-cream/60 p-4">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-serif text-lg font-bold text-forest">{data.group.name}</span>
              <span className="text-xs text-near-black/50">{data.group.memberCount} member{data.group.memberCount === 1 ? "" : "s"}</span>
            </div>
            <div className="mt-2 space-y-1 text-sm text-near-black/75">
              {data.group.teamVsTeam && (
                <p>#{data.group.teamVsTeam.rank} of {data.group.teamVsTeam.of} {data.group.parentName ?? "company"} teams</p>
              )}
              {data.group.companyVsCompany && (
                <p>{data.group.name} beats {data.group.companyVsCompany.beatsPct}% of companies (#{data.group.companyVsCompany.rank} of {data.group.companyVsCompany.of})</p>
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                onClick={() => { navigator.clipboard?.writeText(data.group!.code).then(() => { setShareMsg(`Invite code ${data.group!.code} copied ✓`); setTimeout(() => setShareMsg(""), 2500); }); }}
                className="rounded border border-forest/30 px-3 py-1 text-xs text-forest hover:bg-warm-white"
              >
                Invite code: {data.group.code}
              </button>
              {you && (
                <button
                  onClick={() => leaveGroup(data.group!.code)}
                  className="rounded border border-warm-gray px-3 py-1 text-xs text-near-black/60 hover:text-red-600"
                >
                  Leave
                </button>
              )}
            </div>
          </section>
        )}

        {/* Band A — You */}
        <section className="mb-6">
          {status === "ready" && !you && (
            <div className="rounded-lg border border-gold/40 bg-gold/5 p-5 text-center">
              <p className="mb-3 text-near-black/80">Claim your spot on the leaderboard.</p>
              <Link href="/daily-challenge" className="inline-block rounded bg-gold px-5 py-2.5 font-semibold text-forest transition-colors hover:bg-gold-light">
                Play &amp; join →
              </Link>
            </div>
          )}
          {status === "ready" && you && data && (
            <div className="rounded-lg border-2 border-gold bg-gold/10 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold text-forest">{you.handle}</span>
                    <Movement value={you.movement} />
                  </div>
                  <div className="mt-0.5 text-xs text-near-black/60" style={NUM}>
                    {you.rank == null
                      ? "Unranked — play to join"
                      : `${topPercentLabel(you.percentile)} · #${you.rank.toLocaleString()} of ${data.totalPlayers.toLocaleString()}`}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <div className="text-right">
                    <div className="text-xl font-bold text-near-black" style={NUM}>{you.signals.toLocaleString()}</div>
                    <div className="text-[11px] uppercase tracking-wide text-near-black/50">Signals</div>
                  </div>
                  <button onClick={share} aria-label="Share" className="rounded border border-forest/30 px-3 py-2 text-sm text-forest hover:bg-warm-white">
                    Share
                  </button>
                </div>
              </div>
              {shareMsg && <p className="mt-2 text-xs text-forest">{shareMsg}</p>}
            </div>
          )}
          {status === "loading" && <div className="h-[76px] animate-pulse rounded-lg bg-warm-gray/40" />}
        </section>

        {/* Band B — Standings */}
        <section>
          <div className={`${GRID} px-3 pb-2 text-[11px] uppercase tracking-wide text-near-black/40`}>
            <span>Rank</span><span>Player</span><span className="text-right">Signals</span><span className="text-right">Move</span>
          </div>

          {status === "loading" && <SkeletonRows />}

          {status === "error" && (
            <div className="py-10 text-center">
              <p className="mb-3 text-near-black/70">Couldn’t load the leaderboard.</p>
              <button onClick={() => load(scope, period)} className="rounded border border-warm-gray px-4 py-2 text-sm hover:bg-warm-cream">Retry</button>
            </div>
          )}

          {status === "ready" && data && data.leaderboard.length === 0 && (
            <div className="py-10 text-center text-near-black/60">
              {period === "season" && !data.seasonName ? "No active season right now." : "Be the first to play today."}
            </div>
          )}

          {status === "ready" && data && data.leaderboard.length > 0 && (
            <div className="space-y-0.5">
              {data.leaderboard.map((r) => (<StandingsRow key={`${r.rank}-${r.handle}`} row={r} />))}
              {you && !youInList && (
                <>
                  <div className="select-none py-1 text-center text-near-black/30">···</div>
                  <StandingsRow row={{ rank: you.rank, handle: you.handle, signals: you.signals, playStreak: you.playStreak, fullSetStreak: you.fullSetStreak, movement: you.movement, isYou: true }} />
                </>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function ScopeChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs transition-colors ${active ? "border-forest bg-forest text-warm-white" : "border-warm-gray text-near-black/70 hover:border-forest/40"}`}
    >
      {label}
    </button>
  );
}
