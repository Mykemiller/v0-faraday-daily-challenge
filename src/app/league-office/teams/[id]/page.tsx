// League Office — Team detail. Live roster (captain flagged) + pending
// membership requests. Approve/Deny/Reassign are Tier 2 (shown disabled).

import Link from "next/link";
import { requireStaff } from "@/lib/league-office/service";
import { getTeam } from "@/lib/league-office/data";
import { PageHeading, Card, PendingScreen, StatusChip, EmptyState } from "@/components/league-office/primitives";
import { ActionButton } from "@/components/league-office/actions";

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
        <ActionButton
          label="Reassign captain"
          title="Reassign team captain"
          description={`Choose a new captain for ${d.team.name}. The current captain becomes a regular member.`}
          confirmLabel="Reassign"
          payload={{ action: "team.reassign_captain", teamId: d.team.id }}
          extraField={{
            kind: "select",
            name: "captainSubscriberId",
            label: "New captain",
            options: d.roster.map((m) => ({ value: m.subscriberId, label: `@${m.handle}` })),
          }}
        />
        <ActionButton
          label="Rename"
          title="Rename team"
          description={`Rename ${d.team.name}. This is visible to all members.`}
          confirmLabel="Rename"
          payload={{ action: "team.rename", teamId: d.team.id }}
          extraField={{ kind: "text", name: "name", label: "New name", initial: d.team.name }}
        />
        <button disabled title="Deferred: destructive team deletion on live shared data — later pass"
          style={{ fontSize: 12.5, padding: "7px 12px", borderRadius: 7, border: "1px solid var(--color-cream-border)", background: "#fff", color: "#d3a29a", cursor: "not-allowed" }}>
          Force disband
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 16 }}>
        <Card title={`Roster · ${d.roster.length}`}>
          {d.roster.length === 0 ? (
            <EmptyState>No confirmed members.</EmptyState>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {d.roster.map((m) => (
                <li key={m.membershipId} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 0", borderTop: "1px solid var(--color-cream-line)" }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>@{m.handle}</span>
                  {m.role === "Captain" ? <StatusChip label="Captain" tone="amber" /> : null}
                  <span style={{ flex: 1 }} />
                  <ActionButton
                    label="Remove"
                    variant="danger"
                    destructive
                    title="Remove from team"
                    description={`Remove @${m.handle} from ${d.team!.name}. Their membership record is deleted.`}
                    confirmLabel="Remove"
                    payload={{ action: "membership.deny", membershipId: m.membershipId }}
                  />
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
              {d.pending.map((m) => (
                <li key={m.membershipId} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 0", borderTop: "1px solid var(--color-cream-line)" }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>@{m.handle}</span>
                  <span style={{ flex: 1 }} />
                  <ActionButton
                    label="Approve"
                    variant="primary"
                    title="Approve membership request"
                    description={`Approve @${m.handle} into ${d.team!.name}. They become a confirmed member.`}
                    confirmLabel="Approve"
                    payload={{ action: "membership.approve", membershipId: m.membershipId }}
                  />
                  <ActionButton
                    label="Deny"
                    variant="danger"
                    destructive
                    title="Deny membership request"
                    description={`Deny @${m.handle}'s request to join ${d.team!.name}. The pending record is removed.`}
                    confirmLabel="Deny"
                    payload={{ action: "membership.deny", membershipId: m.membershipId }}
                  />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
