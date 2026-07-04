// League Office — Team directory. Live teams (group_type='team') as a card grid,
// with their company/conference label, roster size, and captain.

import Link from "next/link";
import { requireStaff } from "@/lib/league-office/service";
import { listTeams } from "@/lib/league-office/data";
import { PageHeading, PendingScreen, StatusChip, EmptyState } from "@/components/league-office/primitives";

export default async function TeamsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const staff = await requireStaff();
  if (!staff.ok) return <PendingScreen />;
  const { q = "" } = await searchParams;
  const needle = q.trim().toLowerCase();

  let teams = await listTeams(staff.s);
  if (needle) teams = teams.filter((t) => t.name.toLowerCase().includes(needle) || (t.conference ?? "").toLowerCase().includes(needle));

  return (
    <>
      <PageHeading title="Teams" sub={`${teams.length} team${teams.length === 1 ? "" : "s"}${needle ? ` matching “${q}”` : ""}`} />
      {teams.length === 0 ? (
        <EmptyState>{needle ? `No teams match “${q}”.` : "No teams yet."}</EmptyState>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
          {teams.map((t) => (
            <Link
              key={t.id}
              href={`/league-office/teams/${t.id}`}
              style={{ textDecoration: "none", color: "inherit" }}
            >
              <div style={{ background: "#fff", border: "1px solid var(--color-cream-border)", borderRadius: 10, padding: 16, height: "100%" }} className="lo-row">
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span className="font-serif" style={{ fontSize: 16, fontWeight: 700, color: "#141210" }}>{t.name}</span>
                  <span style={{ flex: 1 }} />
                  <StatusChip label="Active" tone="green" />
                </div>
                {t.conference ? (
                  <div className="font-mono" style={{ fontSize: 10, letterSpacing: ".06em", textTransform: "uppercase", color: "#94560a", marginBottom: 10 }}>
                    {t.conference}
                  </div>
                ) : (
                  <div className="font-mono" style={{ fontSize: 10, color: "#b2a898", marginBottom: 10 }}>INDEPENDENT</div>
                )}
                <div style={{ display: "flex", gap: 16, fontSize: 12.5, color: "#6b6257" }}>
                  <span><strong style={{ color: "#141210" }}>{t.memberCount}</strong> members</span>
                  {t.pendingCount > 0 ? <span><strong style={{ color: "#94560a" }}>{t.pendingCount}</strong> pending</span> : null}
                </div>
                <div style={{ marginTop: 10, fontSize: 12, color: "#8d8375" }}>
                  Captain: {t.captainHandle ? <strong style={{ color: "#141210" }}>@{t.captainHandle}</strong> : "—"}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
