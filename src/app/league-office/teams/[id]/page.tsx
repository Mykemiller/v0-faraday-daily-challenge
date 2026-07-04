// League Office — Team detail. Live roster (captain flagged) + pending
// membership requests. Approve/Deny/Reassign are Tier 2 (shown disabled).

import Link from "next/link";
import { requireStaff } from "@/lib/league-office/service";
import { getTeam } from "@/lib/league-office/data";
import { PageHeading, Card, PendingScreen, StatusChip, EmptyState } from "@/components/league-office/primitives";

export default async function TeamDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const staff = await requireStaff();
  if (!staff.ok) return <PendingScreen />;
  const { id } = await params;
  const d = await getTeam(staff.s, id);

  if (!d.team) {
    return (
      <>
        <PageHeading title="Team" />
        <EmptyState>Team not found.</EmptyState>
      </>
    );
  }

  return (
    <>
      <Link href="/league-office/teams" style={{ fontSize: 12.5, color: "var(--color-amber-dark)", textDecoration: "none" }}>← Teams</Link>
      <div style={{ display: "flex", alignItems: "center", gap: 14, margin: "8px 0 6px" }}>
        <h1 className="font-serif" style={{ fontSize: 26, margin: 0 }}>{d.team.name}</h1>
        <StatusChip label="Active" tone="green" />
      </div>
      <div className="double-rule" />
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "12px 0 20px" }}>
        {d.conference ? (
          <span className="font-mono" style={{ fontSize: 10.5, letterSpacing: ".06em", textTransform: "uppercase", color: "#94560a" }}>{d.conference}</span>
        ) : (
          <span className="font-mono" style={{ fontSize: 10.5, color: "#b2a898" }}>INDEPENDENT</span>
        )}
        <span style={{ flex: 1 }} />
        {["Reassign captain", "Rename", "Force disband"].map((a) => (
          <button key={a} disabled title="Write-actions land in the next phase (Tier 2)"
            style={{ fontSize: 12.5, padding: "7px 12px", borderRadius: 7, border: "1px solid var(--color-cream-border)", background: "#fff", color: a === "Force disband" ? "#d3a29a" : "#b2a898", cursor: "not-allowed" }}>
            {a}
          </button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 16 }}>
        <Card title={`Roster · ${d.roster.length}`}>
          {d.roster.length === 0 ? (
            <EmptyState>No confirmed members.</EmptyState>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {d.roster.map((m, i) => (
                <li key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 0", borderTop: i ? "1px solid var(--color-cream-line)" : "none" }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>@{m.handle}</span>
                  {m.role === "Captain" ? <StatusChip label="Captain" tone="amber" /> : null}
                  <span style={{ flex: 1 }} />
                  <button disabled title="Tier 2" style={{ fontSize: 12, padding: "5px 10px", borderRadius: 6, border: "1px solid var(--color-cream-border)", background: "#fff", color: "#c3b9a8", cursor: "not-allowed" }}>Remove</button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={`Pending requests · ${d.pending.length}`}>
          {d.pending.length === 0 ? (
            <EmptyState>No pending membership requests.</EmptyState>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {d.pending.map((m, i) => (
                <li key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 0", borderTop: i ? "1px solid var(--color-cream-line)" : "none" }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>@{m.handle}</span>
                  <span style={{ flex: 1 }} />
                  {["Approve", "Deny"].map((a) => (
                    <button key={a} disabled title="Tier 2" style={{ fontSize: 12, padding: "5px 10px", borderRadius: 6, border: "1px solid var(--color-cream-border)", background: "#fff", color: "#c3b9a8", cursor: "not-allowed" }}>{a}</button>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
