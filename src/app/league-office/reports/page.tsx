// League Office — Disputes & Flags: the player message report queue
// (CC-DC-MESSAGING-1.0). Read-mostly: open reports newest-first with the
// snapshotted message body (evidence survives the author deleting the
// message), and a per-row status control. No bulk actions, no auto-moderation.
// Reporters are never told what happened here.

import Link from "next/link";
import { requireStaff, q } from "@/lib/league-office/service";
import { PageHeading, PendingScreen, StatusChip } from "@/components/league-office/primitives";
import { DataTable, type Column } from "@/components/league-office/DataTable";
import ReportActions from "@/components/league-office/ReportActions";
import type { StatusTone } from "@/lib/league-office/constants";

interface ReportRow {
  id: string;
  message_id: string | null;
  conversation_id: string | null;
  reporter_id: string;
  reported_author_id: string;
  body_snapshot: string;
  reason: string | null;
  status: string;
  created_at: string;
  reviewed_by: string | null;
}

const REPORT_TONE: Record<string, StatusTone> = {
  open: "amber",
  reviewed: "gray",
  actioned: "red",
  dismissed: "gray",
};

const FILTERS = [
  { key: "open", label: "Open" },
  { key: "all", label: "All" },
];

function fmt(iso: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const staff = await requireStaff();
  if (!staff.ok) return <PendingScreen />;
  const { view = "open" } = await searchParams;

  const filter = view === "all" ? "" : "&status=eq.open";
  const rows = await q<ReportRow>(
    staff.s,
    `dc_message_reports?select=id,message_id,conversation_id,reporter_id,reported_author_id,body_snapshot,reason,status,created_at,reviewed_by&order=created_at.desc&limit=200${filter}`
  );

  // Handle lookup for reporter + reported (one query for both sides).
  const subIds = [...new Set(rows.flatMap(r => [r.reporter_id, r.reported_author_id]))];
  const handleById = new Map<string, string>();
  if (subIds.length > 0) {
    const subs = await q<{ id: string; handle: string | null; email: string | null }>(
      staff.s,
      `dc_subscribers?id=in.(${subIds.map(encodeURIComponent).join(",")})&select=id,handle,email`
    );
    for (const s of subs) {
      handleById.set(s.id, s.handle || (s.email ? s.email.split("@")[0] : "unknown"));
    }
  }
  const handleOf = (id: string) => `@${handleById.get(id) ?? "unknown"}`;

  const columns: Column<ReportRow>[] = [
    { head: "When", width: "110px", cell: (r) => <span className="font-mono" style={{ fontSize: 11.5, color: "#6b6257" }}>{fmt(r.created_at)}</span> },
    { head: "Reporter", width: "130px", cell: (r) => <span className="font-mono" style={{ fontSize: 11.5 }}>{handleOf(r.reporter_id)}</span> },
    { head: "Reported", width: "130px", cell: (r) => <span className="font-mono" style={{ fontSize: 11.5, fontWeight: 700 }}>{handleOf(r.reported_author_id)}</span> },
    {
      head: "Message (snapshot)",
      width: "1.9fr",
      cell: (r) => (
        <span
          title={r.reason ? `Reason: ${r.reason}` : undefined}
          style={{
            fontSize: 12.5,
            color: "#41382d",
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
            display: "-webkit-box",
            WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {r.body_snapshot}
          {r.message_id === null && (
            <span className="font-mono" style={{ fontSize: 9.5, color: "#8d8375" }}> · original deleted</span>
          )}
        </span>
      ),
    },
    { head: "Status", width: "100px", cell: (r) => <StatusChip label={r.status} tone={REPORT_TONE[r.status] ?? "gray"} /> },
    { head: "", width: "230px", align: "right", cell: (r) => <ReportActions reportId={r.id} status={r.status} /> },
  ];

  const openCount = rows.filter(r => r.status === "open").length;

  return (
    <>
      <PageHeading
        title="Disputes & Flags"
        sub={`${view === "all" ? rows.length : openCount} report${(view === "all" ? rows.length : openCount) === 1 ? "" : "s"} · player-flagged messages, snapshotted at report time`}
      />
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {FILTERS.map((f) => {
          const active = view === f.key || (view !== "all" && f.key === "open");
          return (
            <Link
              key={f.key}
              href={`/league-office/reports${f.key === "open" ? "" : "?view=all"}`}
              className="font-mono"
              style={{
                fontSize: 11,
                letterSpacing: ".06em",
                textTransform: "uppercase",
                padding: "6px 12px",
                borderRadius: 20,
                textDecoration: "none",
                border: "1px solid var(--color-cream-border)",
                background: active ? "var(--color-forest)" : "#fff",
                color: active ? "#f8f5f0" : "#6b6257",
              }}
            >
              {f.label}
            </Link>
          );
        })}
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        getKey={(r) => r.id}
        empty="No reports. Player-flagged messages land here with their snapshotted text."
      />
    </>
  );
}
