"use client";

// /leaderboard/team/[teamId] — team roster + light team management.
//
// Reached from the Leaderboard "Teams" tab (clickable team rows) and the
// "View team →" link in the highlighted personal score card. Shares the exact
// leaderboard chrome: SiteHeaderNav masthead, cream shell, serif page title,
// the 4-column rank/member/today/season table styling, and the gold "you"
// highlight. Route key is teams.id (uuid) — the identifier the leaderboard data
// layer already uses. Data + all mutations go through
// /api/leaderboard/team/[teamId] (server-side authorization).

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import SiteHeaderNav from "@/components/SiteHeaderNav";
import { SESSION_STORAGE_KEY, HANDLE_STORAGE_KEY } from "@/lib/supabase";

interface RosterMember {
  rank: number | null;
  subscriber_id: string;
  handle: string;
  today_points: number | null;
  season_points: number | null;
  is_you: boolean;
  is_captain: boolean;
}

interface TeamData {
  season: { id: string; name: string };
  team: { id: string; name: string; code: string; group_type: string; captain_id: string | null };
  member_count: number;
  team_total: number;
  team_today_total: number;
  team_rank: number | null;
  team_count: number;
  viewer: { authed: boolean; subscriber_id: string | null; is_member: boolean; is_captain: boolean };
  join_token: string | null;
  roster: RosterMember[];
}

const NUM = { fontVariantNumeric: "tabular-nums" } as const;

// "—" for members who haven't scored (reads as "hasn't played", not "scored 0").
function fmt(n: number | null): string {
  return n == null ? "—" : n.toLocaleString();
}
function srScore(today: number | null, season: number | null): string {
  const t = today == null ? "no score" : today.toLocaleString();
  const s = season == null ? "no score" : season.toLocaleString();
  return `${t} today, ${s} this season`;
}

export default function TeamPage() {
  const { teamId } = useParams<{ teamId: string }>();

  const [data, setData] = useState<TeamData | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "notfound" | "error">("loading");
  const [token, setToken] = useState<string | null>(null);
  const [handle, setHandle] = useState<string | null>(null);

  // Management UI state
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [nameErr, setNameErr] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [copyMsg, setCopyMsg] = useState("");
  const [rotating, setRotating] = useState(false);
  const [actionErr, setActionErr] = useState("");

  const getToken = () => {
    try { return localStorage.getItem(SESSION_STORAGE_KEY); } catch { return null; }
  };

  useEffect(() => {
    try {
      setToken(localStorage.getItem(SESSION_STORAGE_KEY));
      const h = localStorage.getItem(HANDLE_STORAGE_KEY);
      if (h) setHandle(h);
      else {
        const email = localStorage.getItem("dc_email");
        if (email) setHandle(email.split("@")[0]);
      }
    } catch { /* storage disabled */ }
  }, []);

  function signOut() {
    try {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      localStorage.removeItem(HANDLE_STORAGE_KEY);
    } catch { /* ignore */ }
    window.location.href = "/challenge";
  }

  const load = useCallback(async () => {
    setStatus("loading");
    const t = getToken();
    const qs = t ? `?token=${encodeURIComponent(t)}` : "";
    try {
      const res = await fetch(`/api/leaderboard/team/${encodeURIComponent(teamId)}${qs}`);
      if (res.status === 404) { setStatus("notfound"); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as TeamData;
      setData(json);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [teamId]);

  useEffect(() => { if (teamId) load(); }, [teamId, load]);

  const inviteUrl = data?.join_token && typeof window !== "undefined"
    ? `${window.location.origin}/leaderboard/join/${data.join_token}`
    : "";

  async function copyInvite() {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopyMsg("Copied ✓");
      setTimeout(() => setCopyMsg(""), 2500);
    } catch { setCopyMsg("Copy failed — select and copy the link."); }
  }

  async function saveName() {
    const name = draftName.trim();
    setNameErr("");
    if (name.length < 2 || name.length > 40) { setNameErr("Team name must be 2–40 characters."); return; }
    if (!data) return;
    if (name === data.team.name) { setEditingName(false); return; }
    const prev = data.team.name;
    // Optimistic update
    setData({ ...data, team: { ...data.team, name } });
    setSavingName(true);
    try {
      const res = await fetch(`/api/leaderboard/team/${encodeURIComponent(teamId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: getToken(), action: "rename", name }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Roll back
        setData(d => (d ? { ...d, team: { ...d.team, name: prev } } : d));
        setNameErr((json as { message?: string }).message || "Couldn't rename the team.");
        return;
      }
      setEditingName(false);
    } catch {
      setData(d => (d ? { ...d, team: { ...d.team, name: prev } } : d));
      setNameErr("Network error — try again.");
    } finally {
      setSavingName(false);
    }
  }

  async function doLeave() {
    setActionErr("");
    setLeaving(true);
    try {
      const res = await fetch(`/api/leaderboard/team/${encodeURIComponent(teamId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: getToken(), action: "leave" }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setActionErr((json as { error?: string }).error === "season_locked"
          ? "The season is locked — you can't leave right now."
          : "Couldn't leave the team. Try again.");
        setLeaving(false);
        setConfirmLeave(false);
        return;
      }
      window.location.href = "/leaderboard?view=teams";
    } catch {
      setActionErr("Network error — try again.");
      setLeaving(false);
      setConfirmLeave(false);
    }
  }

  async function rotateLink() {
    setActionErr("");
    setRotating(true);
    try {
      const res = await fetch(`/api/leaderboard/team/${encodeURIComponent(teamId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: getToken(), action: "rotate-token" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !(json as { join_token?: string }).join_token) {
        setActionErr("Couldn't rotate the link. Try again.");
        return;
      }
      setData(d => (d ? { ...d, join_token: (json as { join_token: string }).join_token } : d));
      setCopyMsg("Link rotated — old link disabled.");
      setTimeout(() => setCopyMsg(""), 3500);
    } catch {
      setActionErr("Network error — try again.");
    } finally {
      setRotating(false);
    }
  }

  return (
    <div className="min-h-screen bg-warm-white font-sans text-near-black">
      <SiteHeaderNav
        current="leaderboard"
        authed={!!token}
        handle={token ? handle : null}
        onSignOut={signOut}
      />

      <main className="mx-auto max-w-2xl px-5 pb-16 pt-6">
        {/* Back navigation — returns to the Leaderboard with the Teams tab selected. */}
        <Link
          href="/leaderboard?view=teams"
          className="inline-flex items-center gap-1 rounded text-sm text-forest hover:text-forest/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
        >
          ← Leaderboard
        </Link>

        {status === "loading" && (
          <div className="mt-8 space-y-3" aria-hidden>
            <div className="h-9 w-56 animate-pulse rounded bg-warm-gray/40" />
            <div className="h-4 w-40 animate-pulse rounded bg-warm-gray/40" />
            <div className="mt-6 h-40 animate-pulse rounded-lg bg-warm-gray/30" />
          </div>
        )}

        {status === "notfound" && (
          <div className="mt-12 rounded-lg border border-forest/15 bg-warm-cream/50 p-8 text-center">
            <p className="font-serif text-xl font-bold text-forest">Team not found</p>
            <p className="mx-auto mt-2 max-w-sm text-sm text-near-black/60">
              This team doesn&apos;t exist, or the link is no longer valid.
            </p>
            <Link
              href="/leaderboard?view=teams"
              className="mt-5 inline-block rounded text-sm font-semibold text-forest underline decoration-gold underline-offset-4 hover:text-forest/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
            >
              ← Leaderboard
            </Link>
          </div>
        )}

        {status === "error" && (
          <div className="mt-12 py-10 text-center">
            <p className="mb-3 text-near-black/70">Couldn&apos;t load this team.</p>
            <button
              onClick={load}
              className="rounded border border-warm-gray px-4 py-2 text-sm hover:bg-warm-cream focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
            >
              Retry
            </button>
          </div>
        )}

        {status === "ready" && data && (
          <TeamBody
            data={data}
            editingName={editingName}
            setEditingName={setEditingName}
            draftName={draftName}
            setDraftName={setDraftName}
            nameErr={nameErr}
            savingName={savingName}
            onSaveName={saveName}
            confirmLeave={confirmLeave}
            setConfirmLeave={setConfirmLeave}
            leaving={leaving}
            onLeave={doLeave}
            inviteUrl={inviteUrl}
            copyMsg={copyMsg}
            onCopy={copyInvite}
            rotating={rotating}
            onRotate={rotateLink}
            actionErr={actionErr}
          />
        )}
      </main>
    </div>
  );
}

function TeamBody({
  data, editingName, setEditingName, draftName, setDraftName, nameErr, savingName, onSaveName,
  confirmLeave, setConfirmLeave, leaving, onLeave, inviteUrl, copyMsg, onCopy, rotating, onRotate, actionErr,
}: {
  data: TeamData;
  editingName: boolean;
  setEditingName: (v: boolean) => void;
  draftName: string;
  setDraftName: (v: string) => void;
  nameErr: string;
  savingName: boolean;
  onSaveName: () => void;
  confirmLeave: boolean;
  setConfirmLeave: (v: boolean) => void;
  leaving: boolean;
  onLeave: () => void;
  inviteUrl: string;
  copyMsg: string;
  onCopy: () => void;
  rotating: boolean;
  onRotate: () => void;
  actionErr: string;
}) {
  const { team, season, roster, viewer } = data;
  const isCaptain = viewer.is_captain;
  const isMember = viewer.is_member;
  const solo = data.member_count <= 1;

  const memberLabel = `${data.member_count} member${data.member_count === 1 ? "" : "s"}`;

  return (
    <>
      {/* Title block */}
      <section className="mt-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            {editingName ? (
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    autoFocus
                    value={draftName}
                    maxLength={60}
                    onChange={(e) => setDraftName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") onSaveName();
                      if (e.key === "Escape") setEditingName(false);
                    }}
                    aria-label="Team name"
                    className="min-w-0 rounded border border-forest/30 bg-white px-2 py-1 font-serif text-2xl font-bold text-forest focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-gold"
                  />
                  <button
                    onClick={onSaveName}
                    disabled={savingName}
                    className="rounded bg-gold/15 border border-gold/50 px-3 py-1 font-mono text-[11px] text-forest hover:bg-gold/25 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
                  >
                    {savingName ? "Saving…" : "Save"}
                  </button>
                  <button
                    onClick={() => setEditingName(false)}
                    disabled={savingName}
                    className="rounded border border-forest/20 px-3 py-1 font-mono text-[11px] text-near-black/60 hover:border-forest/40 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
                  >
                    Cancel
                  </button>
                </div>
                {nameErr && <p className="mt-1.5 text-xs text-brick">{nameErr}</p>}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <h1 className="font-serif text-3xl font-bold text-forest break-words">{team.name}</h1>
                {/* Rename affordance — captain only; hidden (not disabled) for everyone else. */}
                {isCaptain && (
                  <button
                    onClick={() => { setDraftName(team.name); setEditingName(true); }}
                    aria-label="Rename team"
                    title="Rename team"
                    className="shrink-0 rounded border border-forest/20 px-2 py-1 font-mono text-[10px] text-near-black/50 hover:border-forest/40 hover:text-forest focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
                  >
                    Rename
                  </button>
                )}
              </div>
            )}
            <p className="mt-1 text-sm text-near-black/60">
              {season.name} · {memberLabel}
            </p>
          </div>

          {/* Team totals — same numeral/label treatment as the leaderboard card. */}
          <div className="flex shrink-0 items-start gap-5">
            <div className="text-right">
              <div className="text-xl font-bold text-forest" style={NUM}>
                {data.team_today_total.toLocaleString()}
              </div>
              <div className="text-[11px] uppercase tracking-wide text-near-black/50">today</div>
            </div>
            <div className="text-right">
              <div className="text-xl font-bold text-near-black" style={NUM}>
                {data.team_total.toLocaleString()}
              </div>
              <div className="text-[11px] uppercase tracking-wide text-near-black/50">season</div>
            </div>
          </div>
        </div>

        {/* Rank badge */}
        <div className="mt-3">
          {data.team_rank != null ? (
            <span className="inline-block rounded-full border border-forest/25 bg-warm-cream/60 px-3 py-1 text-xs font-semibold text-forest" style={NUM}>
              #{data.team_rank} of {data.team_count} team{data.team_count === 1 ? "" : "s"}
            </span>
          ) : (
            <span className="inline-block rounded-full border border-forest/20 bg-warm-cream/50 px-3 py-1 text-xs text-near-black/55">
              Unranked — no team scores yet
            </span>
          )}
        </div>
      </section>

      {/* Roster */}
      <section className="mt-7">
        {/* Column header — desktop grid; hidden on mobile where rows stack. */}
        <div className="hidden grid-cols-[2.5rem_1fr_4rem_4.75rem] items-center gap-2 px-3 pb-2 text-[11px] uppercase tracking-wide text-near-black/40 sm:grid">
          <span>Rank</span>
          <span>Member</span>
          <span className="text-right">Today</span>
          <span className="text-right">Season</span>
        </div>

        <div className="space-y-0.5">
          {roster.map((m) => (
            <RosterRow key={m.subscriber_id} m={m} />
          ))}
        </div>

        {solo && (
          <p className="mt-4 text-center text-sm text-near-black/55">
            You&apos;re the only one here — invite a teammate.
          </p>
        )}
      </section>

      {/* Management — quiet, below the roster, above the same thin rule the
          leaderboard uses for its admin block. Members only. */}
      {isMember && (
        <section className="mt-9 border-t border-forest/10 pt-6">
          <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-near-black/40">Manage team</p>

          {/* Invite / Share */}
          <div className="rounded-lg border border-forest/10 bg-white px-4 py-4">
            <p className="text-sm font-semibold text-forest">Invite / Share team</p>
            <p className="mt-0.5 text-xs text-near-black/55">
              Anyone with this link can join {team.name}.
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                readOnly
                value={inviteUrl}
                onFocus={(e) => e.currentTarget.select()}
                aria-label="Team invite link"
                className="min-w-0 flex-1 rounded border border-forest/15 bg-warm-panel px-2 py-1.5 font-mono text-xs text-near-black/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-gold"
              />
              <button
                onClick={onCopy}
                className="w-full rounded border border-forest/20 px-4 py-2 font-mono text-[12px] text-near-black/70 hover:border-forest/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold sm:w-auto"
              >
                Copy link
              </button>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              {copyMsg && <span className="text-xs text-forest" role="status">{copyMsg}</span>}
              {/* Rotate — captain only. */}
              {isCaptain && (
                <button
                  onClick={onRotate}
                  disabled={rotating}
                  className="rounded font-mono text-[11px] text-near-black/45 underline decoration-forest/30 underline-offset-2 hover:text-forest disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
                >
                  {rotating ? "Rotating…" : "Rotate link"}
                </button>
              )}
            </div>
          </div>

          {/* Leave */}
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            {!confirmLeave ? (
              <button
                onClick={() => setConfirmLeave(true)}
                className="w-full rounded border border-red-300 bg-red-50 px-4 py-2 font-mono text-[12px] text-red-700 hover:bg-red-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold sm:w-auto"
              >
                Leave team
              </button>
            ) : (
              <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center">
                <span className="text-xs text-near-black/60">Your past scores stay; future scores stop counting for this team.</span>
                <div className="flex gap-2">
                  <button
                    onClick={onLeave}
                    disabled={leaving}
                    className="w-full rounded border border-red-300 bg-red-50 px-4 py-2 font-mono text-[12px] text-red-700 hover:bg-red-100 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold sm:w-auto"
                  >
                    {leaving ? "Leaving…" : "Confirm leave?"}
                  </button>
                  <button
                    onClick={() => setConfirmLeave(false)}
                    disabled={leaving}
                    className="w-full rounded border border-forest/20 px-4 py-2 font-mono text-[12px] text-near-black/60 hover:border-forest/40 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold sm:w-auto"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {actionErr && <p className="mt-3 text-xs text-brick" role="status">{actionErr}</p>}
        </section>
      )}

      {/* Non-member note — read-only roster, matching how the app already shows
          any team's standings to any signed-in player on the leaderboard. */}
      {!isMember && (
        <section className="mt-8 border-t border-forest/10 pt-5">
          <p className="text-sm text-near-black/55">
            {viewer.authed
              ? "You're not on this team — this is a read-only view."
              : "Sign in to manage teams and see your own standing."}
          </p>
        </section>
      )}
    </>
  );
}

function RosterRow({ m }: { m: RosterMember }) {
  const rankLabel = m.rank == null ? "—" : `#${m.rank}`;
  return (
    <div
      className={`flex flex-wrap items-center gap-x-2 gap-y-1 rounded px-3 py-2.5 sm:grid sm:grid-cols-[2.5rem_1fr_4rem_4.75rem] sm:gap-2 ${
        m.is_you ? "bg-gold/15 ring-1 ring-gold" : "odd:bg-warm-cream/50"
      }`}
    >
      <span className="w-8 text-sm font-semibold text-forest sm:w-auto" style={NUM}>
        {rankLabel}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm text-near-black">@{m.handle}</span>
          {m.is_captain && (
            <span className="shrink-0 rounded bg-forest/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-forest">captain</span>
          )}
          {m.is_you && (
            <span className="shrink-0 text-[10px] uppercase tracking-wide text-amber-600">you</span>
          )}
        </span>
      </span>
      {/* Scores — one aria-labelled group so a screen reader hears the pair as a
          sentence, not two bare numbers. On mobile this wraps to its own line. */}
      <span
        className="ml-auto flex items-center gap-4 sm:contents"
        aria-label={srScore(m.today_points, m.season_points)}
      >
        <span className="w-16 text-right text-sm text-near-black/70 sm:w-auto" style={NUM} aria-hidden>
          <span className="mr-1 text-[9px] uppercase tracking-wide text-near-black/35 sm:hidden">today</span>
          {fmt(m.today_points)}
        </span>
        <span className="w-16 text-right text-sm font-semibold text-near-black sm:w-auto" style={NUM} aria-hidden>
          <span className="mr-1 text-[9px] uppercase tracking-wide text-near-black/35 sm:hidden">season</span>
          {fmt(m.season_points)}
        </span>
      </span>
    </div>
  );
}
