"use client";
// Faraday Academy — one proposal in the review queue.
//
// Shows what was proposed against what is there now, its sources, its rendered
// asset, and the Argus verdict when Argus has written one. Nothing here can merge a
// proposal into lesson text: the only action is an author withdrawing their own.

import { lazy, Suspense } from "react";
import { CitationChip, Meta } from "./primitives";
import { statusLabel, WITHDRAWABLE, type Proposal } from "@/lib/academy/editor";

const DiagramFrame = lazy(() => import("./DiagramFrame"));
const ChartFrame = lazy(() => import("./ChartFrame"));

function StatusPill({ status }: { status: Proposal["status"] }) {
  const terminal = ["rejected", "superseded"].includes(status);
  const settled = ["accepted", "merged"].includes(status);
  return (
    <span
      className="academy-meta px-2 py-0.5"
      style={{
        border: `1px solid ${settled ? "var(--ac-correct)" : terminal ? "var(--ac-rule-strong)" : "var(--ac-accent)"}`,
        color: settled ? "var(--ac-correct)" : "var(--ac-muted)",
      }}
    >
      {statusLabel(status)}
    </span>
  );
}

export default function ProposalDiffCard({
  proposal,
  onWithdraw,
  busy,
}: {
  proposal: Proposal;
  onWithdraw: (id: string) => void;
  busy: boolean;
}) {
  const canWithdraw = proposal.is_mine && WITHDRAWABLE.includes(proposal.status);
  const before = proposal.diff?.before_excerpt ?? "";
  const after = proposal.proposed_text ?? proposal.diff?.after_excerpt ?? "";

  return (
    <li className="py-5" style={{ borderTop: "1px solid var(--ac-rule)" }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={proposal.status} />
          <Meta>
            {proposal.target === "faradays_take" ? "Faraday's take" : "Lesson body"} · {proposal.kind.replace(/_/g, " ")}
          </Meta>
          {proposal.is_mine ? <Meta>yours</Meta> : null}
        </div>
        {canWithdraw ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onWithdraw(proposal.id)}
            className="px-3 py-1.5 text-sm disabled:opacity-50"
            style={{ border: "1px solid var(--ac-rule-strong)", color: "var(--ac-text)" }}
          >
            Withdraw
          </button>
        ) : null}
      </div>

      {/* The diff. Side by side on desktop, stacked on phones. */}
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="px-3 py-2" style={{ backgroundColor: "var(--ac-panel-2)" }}>
          <p className="academy-meta">Now</p>
          <p className="mt-1 whitespace-pre-wrap text-sm" style={{ color: "var(--ac-muted)" }}>
            {before || "(empty)"}
          </p>
        </div>
        <div className="px-3 py-2" style={{ backgroundColor: "var(--ac-panel)", borderLeft: "3px solid var(--ac-accent)" }}>
          <p className="academy-meta">Proposed</p>
          <p className="mt-1 whitespace-pre-wrap text-sm" style={{ color: "var(--ac-text)" }}>
            {after || "(empty)"}
          </p>
        </div>
      </div>

      {proposal.asset_spec?.diagram ? (
        <Suspense fallback={<p className="academy-meta mt-3">Loading the diagram renderer…</p>}>
          <DiagramFrame
            source={proposal.asset_spec.diagram.mermaid}
            caption={proposal.asset_spec.diagram.caption}
          />
        </Suspense>
      ) : null}

      {proposal.asset_spec?.chart ? (
        <Suspense fallback={<p className="academy-meta mt-3">Loading the chart renderer…</p>}>
          <ChartFrame
            spec={proposal.asset_spec.chart.spec}
            caption={proposal.asset_spec.chart.caption}
          />
        </Suspense>
      ) : null}

      {(proposal.sources ?? []).length > 0 ? (
        <div className="mt-4">
          <p className="academy-meta font-medium">Sources</p>
          <ol className="mt-1 space-y-1">
            {(proposal.sources ?? []).map((s, i) => (
              <CitationChip key={`${s.url}-${i}`} index={i + 1} title={s.title} url={s.url} />
            ))}
          </ol>
        </div>
      ) : null}

      {/* Argus writes here. Until it does, say so rather than showing an empty box. */}
      <div className="mt-4 px-3 py-2" style={{ border: "1px dashed var(--ac-rule-strong)" }}>
        <p className="academy-meta">Argus verdict</p>
        {proposal.argus_verdict ? (
          <pre
            className="mt-1 overflow-x-auto text-xs"
            style={{ fontFamily: "var(--font-mono)", color: "var(--ac-text)" }}
          >
            {JSON.stringify(proposal.argus_verdict, null, 2)}
          </pre>
        ) : (
          <p className="mt-1 text-sm" style={{ color: "var(--ac-muted)" }}>
            Not reviewed yet. Argus is not wired to this queue.
          </p>
        )}
      </div>

      {proposal.review_note ? (
        <p className="mt-3 text-sm" style={{ color: "var(--ac-muted)" }}>
          Note: {proposal.review_note}
        </p>
      ) : null}

      <p className="academy-meta mt-3">
        base {proposal.base_hash.slice(0, 12)} · opened {new Date(proposal.created_at).toLocaleString()}
      </p>
    </li>
  );
}
