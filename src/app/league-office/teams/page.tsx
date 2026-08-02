// League Office — Team directory. Live teams as a card grid,
// with their company/conference label, roster size, and captain.

import Link from "next/link";
import { requireStaff } from "@/lib/league-office/service";
import { listTeams, type TeamCard } from "@/lib/league-office/data";
import { PageHeading, PendingScreen, StatusChip, EmptyState } from "@/components/league-office/primitives";
import { ActionButton } from "@/components/league-office/actions";

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

  const active = teams.filter((t) => !t.archived);
  const archived = teams.filter((t) => t.archived);

  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <PageHeading title="Teams" sub={`${active.length} active${archived.length ? ` · ${archived.length} disbanded` : ""}${needle ? ` matching “${q}”` : ""}`} />
        </div>
        <div style={{ marginTop: 4 }}>
          <ActionButton
            label="+ New team"
            variant="primary"
            title="Create a team"
            description="Create a new INDEPENDENT team. It starts empty (no captain, no conference) — add members and assign a captain from the team page."
            confirmLabel="Create team"
            payload={{ action: "team.create" }}
            extraField={{ kind: "text", name: "name", label: "Team name", placeholder: "e.g. Grid Runners" }}
          />
        </div>
      </div>

      {active.length === 0 ? (
        <EmptyState>{needle ? `No active teams match “${q}”.` : "No teams yet — create one to get started."}</EmptyState>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
          {active.map((t) => (
            <TeamCardLink key={t.id} t={t} />
          ))}
        </div>
      )}

      {archived.length > 0 && (
        <div style={{ marginTop: 28 }}>
          <div className="font-mono" style={{ fontSize: 10.5, letterSpacing: ".08em", textTransform: "uppercase", color: "#8d8375", marginBottom: 10 }}>
            Disbanded teams · {archived.length}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
            {archived.map((t) => (
              <TeamCardLink key={t.id} t={t} />
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function TeamCardLink({ t }: { t: TeamCard }) {
  return (
    <Link href={`/league-office/teams/${t.id}`} style={{ textDecoration: "none", color: "inherit" }}>
      <div style={{ background: "#fff", border: "1px solid var(--color-cream-border)", borderRadius: 10, padding: 16, height: "100%", opacity: t.archived ? 0.7 : 1 }} className="lo-row">
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span className="font-serif" style={{ fontSize: 16, fontWeight: 700, color: "#141210" }}>{t.name}</span>
          <span style={{ flex: 1 }} />
          {t.archived ? <StatusChip label="Disbanded" tone="gray" /> : <StatusChip label="Active" tone="green" />}
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
  );
}
