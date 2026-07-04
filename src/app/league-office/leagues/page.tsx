// League Office — Leagues & Conferences. Conferences ARE the existing
// teams.group_type='company' rows + parent_id hierarchy (no new tables).

import Link from "next/link";
import { requireStaff } from "@/lib/league-office/service";
import { getLeagues } from "@/lib/league-office/data";
import { PageHeading, Card, PendingScreen, EmptyState } from "@/components/league-office/primitives";

export default async function LeaguesPage() {
  const staff = await requireStaff();
  if (!staff.ok) return <PendingScreen />;
  const conferences = await getLeagues(staff.s);

  return (
    <>
      <PageHeading title="Leagues & Conferences" sub={`${conferences.length} conference${conferences.length === 1 ? "" : "s"} · conferences are company groups in the team hierarchy`} />
      {conferences.length === 0 ? (
        <EmptyState>No conferences defined yet.</EmptyState>
      ) : (
        <div style={{ display: "grid", gap: 14 }}>
          {conferences.map((c) => (
            <Card key={c.id} title={c.name} action={
              <span className="font-mono" style={{ fontSize: 10.5, color: "#8d8375" }}>
                {c.teamCount} TEAMS · {c.memberCount} MEMBERS
              </span>
            }>
              {c.teams.length === 0 ? (
                <EmptyState>No teams in this conference.</EmptyState>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                  {c.teams.map((t) => (
                    <Link key={t.id} href={`/league-office/teams/${t.id}`} className="lo-row"
                      style={{ textDecoration: "none", color: "inherit", border: "1px solid var(--color-cream-line)", borderRadius: 8, padding: "10px 12px", display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{t.name}</span>
                      <span style={{ flex: 1 }} />
                      <span className="font-mono" style={{ fontSize: 11, color: "#8d8375" }}>{t.members}</span>
                    </Link>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
