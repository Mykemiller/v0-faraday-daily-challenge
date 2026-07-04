// League Office — Subscriber directory. Live dc_subscribers with client-search
// (via ?q) + status filter pills.

import Link from "next/link";
import { requireStaff } from "@/lib/league-office/service";
import { listSubscribers, type SubscriberRow } from "@/lib/league-office/data";
import { PageHeading, PendingScreen, StatusChip } from "@/components/league-office/primitives";
import { DataTable, type Column } from "@/components/league-office/DataTable";

function handleOf(s: SubscriberRow) {
  return s.handle || s.email.split("@")[0];
}
function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(iso));
}

const FILTERS = [
  { key: "", label: "All" },
  { key: "active", label: "Active" },
  { key: "paused", label: "Paused" },
];

export default async function SubscribersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const staff = await requireStaff();
  if (!staff.ok) return <PendingScreen />;
  const { q = "", status = "" } = await searchParams;

  let rows = await listSubscribers(staff.s);
  const needle = q.trim().toLowerCase();
  if (needle)
    rows = rows.filter(
      (r) => handleOf(r).toLowerCase().includes(needle) || r.email.toLowerCase().includes(needle)
    );
  if (status === "active") rows = rows.filter((r) => r.active !== false);
  if (status === "paused") rows = rows.filter((r) => r.active === false);

  const columns: Column<SubscriberRow>[] = [
    {
      head: "Subscriber",
      width: "1.6fr",
      cell: (r) => (
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, color: "#141210", overflow: "hidden", textOverflow: "ellipsis" }}>@{handleOf(r)}</div>
          <div className="font-mono" style={{ fontSize: 11, color: "#8d8375", overflow: "hidden", textOverflow: "ellipsis" }}>{r.email}</div>
        </div>
      ),
    },
    { head: "Status", width: "90px", cell: (r) => <StatusChip label={r.active === false ? "Paused" : "Active"} tone={r.active === false ? "gray" : "green"} /> },
    { head: "Teams", width: "70px", align: "right", cell: (r) => r.teamCount },
    { head: "Streak", width: "80px", align: "right", cell: (r) => (r.play_streak ?? 0) },
    { head: "Last seen", width: "110px", cell: (r) => fmtDate(r.last_seen_at) },
    { head: "Joined", width: "110px", cell: (r) => fmtDate(r.created_at) },
  ];

  return (
    <>
      <PageHeading title="Subscribers" sub={`${rows.length} subscriber${rows.length === 1 ? "" : "s"}${needle ? ` matching “${q}”` : ""}`} />

      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {FILTERS.map((f) => {
          const active = status === f.key || (!status && f.key === "");
          const params = new URLSearchParams();
          if (q) params.set("q", q);
          if (f.key) params.set("status", f.key);
          return (
            <Link
              key={f.key || "all"}
              href={`/league-office/subscribers${params.toString() ? `?${params}` : ""}`}
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
        rowHref={(r) => `/league-office/subscribers/${r.id}`}
        empty={needle ? `No subscribers match “${q}”.` : "No subscribers yet."}
      />
    </>
  );
}
