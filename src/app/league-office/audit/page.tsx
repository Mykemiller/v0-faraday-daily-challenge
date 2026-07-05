// League Office — Audit Log. Every staff override, newest first, with the
// mandatory reason and a Revert affordance on reversible, not-yet-reverted rows.

import Link from "next/link";
import { requireStaff } from "@/lib/league-office/service";
import { listAudit, type AuditRow } from "@/lib/league-office/write";
import { PageHeading, PendingScreen, StatusChip } from "@/components/league-office/primitives";
import { DataTable, type Column } from "@/components/league-office/DataTable";
import { ActionButton } from "@/components/league-office/actions";
import { statusToTone } from "@/lib/league-office/constants";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "subscribers", label: "Subscribers" },
  { key: "teams", label: "Teams" },
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

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ domain?: string }>;
}) {
  const staff = await requireStaff();
  if (!staff.ok) return <PendingScreen />;
  const { domain = "all" } = await searchParams;
  const rows = await listAudit(staff.s, domain);

  const columns: Column<AuditRow>[] = [
    { head: "When", width: "120px", cell: (r) => <span className="font-mono" style={{ fontSize: 11.5, color: "#6b6257" }}>{fmt(r.at)}</span> },
    { head: "Staff", width: "150px", cell: (r) => <span style={{ fontSize: 12.5 }}>{r.staff_email.split("@")[0]}</span> },
    { head: "Domain", width: "110px", cell: (r) => <StatusChip label={r.domain} tone={statusToTone(r.domain)} /> },
    { head: "Action", width: "1.1fr", cell: (r) => <span className="font-mono" style={{ fontSize: 11.5 }}>{r.action}</span> },
    { head: "Reason", width: "1.6fr", cell: (r) => <span style={{ fontStyle: "italic", color: "#41382d" }}>“{r.reason}”</span> },
    {
      head: "",
      width: "110px",
      align: "right",
      cell: (r) =>
        r.reverts_id ? (
          <span className="font-mono" style={{ fontSize: 10, color: "#8d8375" }}>REVERSAL</span>
        ) : r.reverted_by ? (
          <StatusChip label="Reverted" tone="gray" />
        ) : r.reversible ? (
          <ActionButton
            label="Revert"
            variant="neutral"
            title="Revert this action"
            description={`Restore the previous state for this ${r.target_type ?? "record"}. A linked reversal row is written — nothing is deleted.`}
            confirmLabel="Revert"
            payload={{ action: "audit.revert", auditId: r.id }}
          />
        ) : (
          <span className="font-mono" style={{ fontSize: 10, color: "#c3b9a8" }}>—</span>
        ),
    },
  ];

  return (
    <>
      <PageHeading title="Audit Log" sub={`${rows.length} logged action${rows.length === 1 ? "" : "s"} · every override, with its reason`} />
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {FILTERS.map((f) => {
          const active = domain === f.key || (domain === "all" && f.key === "all");
          return (
            <Link
              key={f.key}
              href={`/league-office/audit${f.key === "all" ? "" : `?domain=${f.key}`}`}
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
      <DataTable columns={columns} rows={rows} getKey={(r) => r.id} empty="No actions logged yet. Overrides will appear here immediately." />
    </>
  );
}
