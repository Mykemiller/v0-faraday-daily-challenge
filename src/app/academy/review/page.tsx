"use client";
// Faraday Academy — the editor review queue.
//
// Grouped by course, newest first. The only action here is an author withdrawing
// their own proposal; nothing on this page can move a proposal toward `accepted`
// or merge it into lesson text. Argus and Myke's acceptance tool are the seams:
// Argus writes argus_verdict, and only Myke's tool sets academy.proposal_owner,
// which the database trigger requires before `accepted` is reachable at all.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ProposalDiffCard from "@/components/academy/ProposalDiffCard";
import { DoubleRule } from "@/components/academy/primitives";
import { accessToken, type Proposal } from "@/lib/academy/editor";

type Load =
  | { state: "loading" }
  | { state: "signed_out" }
  | { state: "forbidden" }
  | { state: "error"; message: string }
  | { state: "ready"; proposals: Proposal[] };

export default function ReviewQueuePage() {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchQueue = useCallback(async () => {
    const token = accessToken();
    if (!token) {
      setLoad({ state: "signed_out" });
      return;
    }
    try {
      const res = await fetch("/api/academy/propose", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 404 || res.status === 403) {
        setLoad({ state: "forbidden" });
        return;
      }
      if (!res.ok) {
        setLoad({ state: "error", message: "The queue could not be loaded." });
        return;
      }
      const data = (await res.json()) as { proposals: Proposal[] };
      setLoad({ state: "ready", proposals: data.proposals ?? [] });
    } catch {
      setLoad({ state: "error", message: "The queue could not be loaded." });
    }
  }, []);

  useEffect(() => {
    void fetchQueue();
  }, [fetchQueue]);

  const withdraw = useCallback(
    async (id: string) => {
      const token = accessToken();
      if (!token) return;
      setBusyId(id);
      try {
        await fetch("/api/academy/propose", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ action: "withdraw", proposal_id: id }),
        });
        await fetchQueue();
      } finally {
        setBusyId(null);
      }
    },
    [fetchQueue],
  );

  const grouped = useMemo(() => {
    if (load.state !== "ready") return [];
    const byCourse = new Map<string, { title: string; items: Proposal[] }>();
    for (const p of load.proposals) {
      const title = p.course?.title ?? "Unknown course";
      const entry = byCourse.get(title) ?? { title, items: [] };
      entry.items.push(p);
      byCourse.set(title, entry);
    }
    return [...byCourse.values()].sort((a, b) => a.title.localeCompare(b.title));
  }, [load]);

  return (
    <main id="academy-main" className="mx-auto max-w-4xl px-5 py-10">
      <p className="academy-meta">
        <Link href="/academy" style={{ color: "inherit" }}>
          Academy
        </Link>
      </p>
      <h1 className="mt-1 font-serif text-3xl font-bold" style={{ color: "var(--ac-text)" }}>
        Proposal review
      </h1>
      <DoubleRule className="mt-3" />

      {load.state === "loading" ? (
        <p className="mt-8 text-sm" style={{ color: "var(--ac-muted)" }}>
          Loading the queue…
        </p>
      ) : null}

      {load.state === "signed_out" || load.state === "forbidden" ? (
        <div className="mt-8 px-4 py-5" style={{ border: "1px solid var(--ac-rule-strong)" }}>
          <p className="font-serif text-lg font-bold" style={{ color: "var(--ac-text)" }}>
            This queue is for editors
          </p>
          <p className="mt-2 text-sm" style={{ color: "var(--ac-muted)" }}>
            It needs a Faraday Academy editor account. Nothing on the learner side of the
            Academy requires signing in — every lesson, quiz and glossary is open.
          </p>
        </div>
      ) : null}

      {load.state === "error" ? (
        <p className="mt-8 text-sm" style={{ color: "var(--ac-muted)" }}>
          {load.message}
        </p>
      ) : null}

      {load.state === "ready" && load.proposals.length === 0 ? (
        <p className="mt-8 text-sm" style={{ color: "var(--ac-muted)" }}>
          No proposals yet.
        </p>
      ) : null}

      {grouped.map((group) => (
        <section key={group.title} className="mt-10">
          <h2 className="font-serif text-xl font-bold" style={{ color: "var(--ac-text)" }}>
            {group.title}
          </h2>
          <ul className="mt-2">
            {group.items.map((p) => (
              <ProposalDiffCard
                key={p.id}
                proposal={p}
                onWithdraw={withdraw}
                busy={busyId === p.id}
              />
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
