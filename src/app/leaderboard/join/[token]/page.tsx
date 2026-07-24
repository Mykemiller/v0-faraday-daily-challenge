"use client";

// /leaderboard/join/[token] — invite-link landing.
//
// The durable per-team join token (teams.join_token) is resolved server-side by
// /api/teams (action: join_by_token). A signed-in visitor is joined immediately
// and redirected to the team page; a signed-out visitor is asked to sign in
// first (the link still works after they return).

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import SiteHeaderNav from "@/components/SiteHeaderNav";
import { SESSION_STORAGE_KEY, HANDLE_STORAGE_KEY } from "@/lib/supabase";

export default function JoinTeamPage() {
  const { token: joinToken } = useParams<{ token: string }>();
  // undefined = session not read yet; null = read, signed out; string = signed in.
  const [session, setSession] = useState<string | null | undefined>(undefined);
  const [handle, setHandle] = useState<string | null>(null);
  const [phase, setPhase] = useState<"checking" | "need-auth" | "joining" | "error">("checking");
  const [msg, setMsg] = useState("");

  function signOut() {
    try {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      localStorage.removeItem(HANDLE_STORAGE_KEY);
    } catch { /* ignore */ }
    window.location.href = "/challenge";
  }

  // Read the session post-mount (avoids an SSR/hydration mismatch on
  // localStorage), then either join (signed in) or ask for auth. Session/handle
  // are captured in locals for the join; every state change during the network
  // round-trip happens inside the async callback, not synchronously.
  useEffect(() => {
    let cancelled = false;
    let s: string | null = null;
    let h: string | null = null;
    try {
      s = localStorage.getItem(SESSION_STORAGE_KEY);
      h = localStorage.getItem(HANDLE_STORAGE_KEY);
      if (!h) {
        const email = localStorage.getItem("dc_email");
        if (email) h = email.split("@")[0];
      }
    } catch { /* storage disabled */ }
    setSession(s);
    setHandle(h);

    (async () => {
      if (!s) { if (!cancelled) setPhase("need-auth"); return; }
      if (!cancelled) setPhase("joining");
      try {
        const res = await fetch("/api/teams", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "join_by_token", join_token: joinToken, token: s }),
        });
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok && (json as { team_id?: string }).team_id) {
          window.location.href = `/leaderboard/team/${(json as { team_id: string }).team_id}`;
          return;
        }
        const err = (json as { error?: string }).error;
        setMsg(
          err === "team_limit_reached" ? "You're already on the maximum of 5 teams. Leave one to join another."
          : err === "invalid_invite" ? "This invite link is no longer valid. Ask your captain for a fresh link."
          : err === "season_locked" ? "The season is locked — team changes are closed right now."
          : "Couldn't join the team. Please try again."
        );
        setPhase("error");
      } catch {
        if (cancelled) return;
        setMsg("Network error — please try again.");
        setPhase("error");
      }
    })();

    return () => { cancelled = true; };
    // joinToken is a stable route param; this runs once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen bg-warm-white font-sans text-near-black">
      <SiteHeaderNav current="leaderboard" authed={!!session} handle={session ? handle : null} onSignOut={signOut} />
      <main className="mx-auto max-w-md px-5 pb-16 pt-10">
        <div className="rounded-lg border border-forest/15 bg-warm-cream/50 p-8 text-center">
          {(phase === "checking" || phase === "joining") && (
            <>
              <p className="font-serif text-xl font-bold text-forest">Joining team…</p>
              <p className="mt-2 text-sm text-near-black/60">One moment.</p>
            </>
          )}

          {phase === "need-auth" && (
            <>
              <p className="font-serif text-xl font-bold text-forest">Sign in to join</p>
              <p className="mx-auto mt-2 max-w-sm text-sm text-near-black/60">
                You&apos;ll need to sign in first. This invite link will still work when you come back.
              </p>
              <Link
                href="/account"
                className="mt-5 inline-block rounded bg-gold px-5 py-2.5 font-semibold text-forest transition-colors hover:bg-gold-light focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
              >
                Sign in →
              </Link>
            </>
          )}

          {phase === "error" && (
            <>
              <p className="font-serif text-xl font-bold text-forest">Couldn&apos;t join</p>
              <p className="mx-auto mt-2 max-w-sm text-sm text-near-black/60">{msg}</p>
              <Link
                href="/leaderboard?view=teams"
                className="mt-5 inline-block rounded text-sm font-semibold text-forest underline decoration-gold underline-offset-4 hover:text-forest/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
              >
                ← Leaderboard
              </Link>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
