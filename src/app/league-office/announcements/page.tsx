// League Office — Announcements (COMMISSIONER TOOLS). Compose and send the
// in-app banner every active player sees, and revoke a live one.
//
// Staff-gated exactly like every other Tier 2 route: the /league-office layout
// wraps this in <StaffGate>, and requireStaff() re-verifies server-side before a
// single row is read. A non-staff user hitting this URL directly gets the same
// treatment as Subscribers, Teams or Scoring.
//
// "Broadcast" is the internal/table/action vocabulary and the send-button verb;
// "Announcements" is the only user-facing label.

import { requireStaff } from "@/lib/league-office/service";
import {
  broadcastStatus,
  countActivePlayers,
  listBroadcasts,
  type BroadcastRow,
  type BroadcastStatus,
} from "@/lib/league-office/broadcasts";
import { PageHeading, Card, PendingScreen, StatusChip } from "@/components/league-office/primitives";
import { DataTable, type Column } from "@/components/league-office/DataTable";
import { ActionButton } from "@/components/league-office/actions";
import BroadcastComposer from "@/components/league-office/BroadcastComposer";
import type { StatusTone } from "@/lib/league-office/constants";

const STATUS_TONE: Record<BroadcastStatus, StatusTone> = {
  live: "green",
  scheduled: "amber",
  expired: "gray",
  revoked: "red",
};

function fmt(iso: string | null) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

export default async function AnnouncementsPage() {
  const staff = await requireStaff();
  if (!staff.ok) return <PendingScreen />;

  const [broadcasts, recipientCount] = await Promise.all([
    listBroadcasts(staff.s),
    countActivePlayers(staff.s),
  ]);

  const columns: Column<BroadcastRow>[] = [
    {
      head: "Sent",
      width: "120px",
      cell: (r) => (
        <span className="font-mono" style={{ fontSize: 11.5, color: "#6b6257" }}>
          {fmt(r.created_at)}
        </span>
      ),
    },
    {
      head: "Message",
      width: "2fr",
      cell: (r) => (
        <span style={{ fontSize: 12.5, color: "#41382d" }}>
          {r.body_text.length > 120 ? `${r.body_text.slice(0, 120)}…` : r.body_text}
        </span>
      ),
    },
    {
      head: "Severity",
      width: "110px",
      cell: (r) => (
        <span className="font-mono" style={{ fontSize: 11, color: "#6b6257" }}>
          {r.severity}
        </span>
      ),
    },
    {
      head: "Expires",
      width: "110px",
      cell: (r) => (
        <span className="font-mono" style={{ fontSize: 11.5, color: "#8d8375" }}>
          {r.expires_at ? fmt(r.expires_at) : "until revoked"}
        </span>
      ),
    },
    {
      head: "Status",
      width: "110px",
      cell: (r) => {
        const status = broadcastStatus(r);
        return <StatusChip label={status} tone={STATUS_TONE[status]} />;
      },
    },
    {
      head: "",
      width: "110px",
      align: "right",
      cell: (r) =>
        r.revoked_at ? (
          <span className="font-mono" style={{ fontSize: 10, color: "#8d8375" }}>
            REVOKED
          </span>
        ) : (
          <ActionButton
            label="Revoke"
            variant="danger"
            title="Revoke this broadcast"
            description="The banner disappears for every player the next time they load the game. Nothing is deleted — the broadcast is kept and the revoke is logged."
            confirmLabel="Revoke"
            destructive
            payload={{ action: "broadcast.revoke", broadcastId: r.id }}
          />
        ),
    },
  ];

  return (
    <>
      <PageHeading
        title="Announcements"
        sub={`In-app banner to all active players · ${recipientCount.toLocaleString()} recipient${recipientCount === 1 ? "" : "s"} · one banner shows at a time (most recent first)`}
      />

      <div style={{ display: "grid", gap: 18 }}>
        <Card title="New announcement">
          <BroadcastComposer recipientCount={recipientCount} />
        </Card>

        <Card title="Past announcements" action={
          <span className="font-mono" style={{ fontSize: 10.5, color: "#8d8375" }}>
            {broadcasts.length} TOTAL
          </span>
        }>
          <DataTable
            rows={broadcasts}
            columns={columns}
            getKey={(r) => r.id}
            empty="No announcements sent yet."
          />
        </Card>
      </div>
    </>
  );
}
