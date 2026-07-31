"use client";

// /messages — the Daily Challenge inbox (CC-DC-MESSAGING-1.0).
// Chrome matches /leaderboard exactly: SiteHeaderNav masthead, warm-white
// shell, serif page title. All data flows through /api/messages with the
// dc_session token; signed-out visitors get the standard sign-in prompt.

import { useEffect, useState } from "react";
import Link from "next/link";
import SiteHeaderNav from "@/components/SiteHeaderNav";
import MessagesApp from "@/components/messaging/MessagesApp";
import {
  fetchUnreadTotal,
  useDcHandle,
  useDcToken,
  useHydrated,
} from "@/components/messaging/client";
import { SESSION_STORAGE_KEY, HANDLE_STORAGE_KEY } from "@/lib/supabase";

export default function MessagesPage() {
  const hydrated = useHydrated();
  const token = useDcToken();
  const handle = useDcHandle();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetchUnreadTotal(token).then(n => { if (!cancelled) setUnread(n); });
    return () => { cancelled = true; };
  }, [token]);

  function signOut() {
    try {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      localStorage.removeItem(HANDLE_STORAGE_KEY);
    } catch { /* ignore */ }
    window.location.href = "/challenge";
  }

  return (
    <div className="min-h-screen bg-warm-white font-sans text-near-black">
      <SiteHeaderNav
        current="messages"
        authed={!!token}
        handle={token ? handle : null}
        onSignOut={signOut}
        unreadCount={unread}
        onUnreadChange={setUnread}
      />

      <main className="pb-16 pt-6">
        <div className="mx-auto max-w-5xl px-5">
          <h1 className="font-serif text-3xl font-bold text-forest">Messages</h1>
          <p className="mt-1 mb-5 text-sm text-near-black/60">
            Direct messages and your team channels.
          </p>
        </div>

        {hydrated && !token && (
          <div className="mx-auto max-w-2xl px-5">
            <div className="rounded-lg border border-gold/40 bg-gold/5 p-5 text-center">
              <p className="mb-3 text-near-black/80">Sign in to send and read messages.</p>
              <Link
                href="/daily-challenge"
                className="inline-block rounded bg-gold px-5 py-2.5 font-semibold text-forest transition-colors hover:bg-gold-light"
              >
                Play &amp; join →
              </Link>
            </div>
          </div>
        )}

        {hydrated && token && <MessagesApp token={token} onUnreadChange={setUnread} />}
      </main>
    </div>
  );
}
