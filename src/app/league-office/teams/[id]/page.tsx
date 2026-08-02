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

  const canAdd = d.addable.length > 0;
  const canMove = d.otherTeams.length > 0;

  return (
    <>
      <Link href="/league-office/teams" style={{ fontSize: 12.5, color: "var(--color-amber-dark)", textDecoration: "none" }}>← Teams</Link>
      <div style={{ display: "flex", alignItems: "center", gap: 14, margin: "8px 0 6px" }}>
        <h1 className="font-serif" style={{ fontSize: 26, margin: 0 }}>{d.team.name}</h1>
        {d.archived ? <StatusChip label="Disbanded" tone="gray" /> : <StatusChip label="Active" tone="green" />}
      </div>
      <div className="double-rule" />
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "12px 0 20px", flexWrap: "wrap" }}>
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
        {d.archived ? (
          <ActionButton
            label="Restore team"
            variant="primary"
            title="Restore team"
            description={`Restore ${d.team.name}. It returns to the active directory with its roster and history intact.`}
            confirmLabel="Restore"
            payload={{ action: "team.restore", teamId: d.team.id }}
          />
        ) : (
          <ActionButton
            label="Disband"
            variant="danger"
            destructive
            title="Disband team"
            description={`Disband ${d.team.name}. The team is archived — its roster and scoring history are preserved and it can be restored later. It stops appearing in the active team directory.`}
            confirmLabel="Disband"
            payload={{ action: "team.archive", teamId: d.team.id }}
          />
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 16 }}>
        <Card title={`Roster · ${d.roster.length}`}>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: d.roster.length ? 4 : 0 }}>
            {canAdd ? (
              <ActionButton
                label="+ Add member"
                title="Add a subscriber to this team"
                description={`Add a subscriber to ${d.team.name} for the active season. They become a confirmed member immediately.`}
                confirmLabel="Add member"
                payload={{ action: "membership.add", teamId: d.team.id }}
                extraField={{
                  kind: "select",
                  name: "subscriberId",
                  label: "Subscriber",
                  options: d.addable.map((a) => ({ value: a.subscriberId, label: `@${a.handle}` })),
                }}
              />
            ) : (
              <span style={{ fontSize: 11.5, color: "#8d8375" }}>Every active subscriber is already on this team.</span>
            )}
          </div>
          {d.roster.length === 0 ? (
            <EmptyState>No confirmed members.</EmptyState>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {d.roster.map((m) => (
                <li key={m.membershipId} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 0", borderTop: "1px solid var(--color-cream-line)" }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>@{m.handle}</span>
                  {m.role === "Captain" ? <StatusChip label="Captain" tone="amber" /> : null}
                  <span style={{ flex: 1 }} />
                  {canMove ? (
                    <ActionButton
                      label="Move"
                      title="Move to another team"
                      description={`Move @${m.handle} from ${d.team!.name} to another team, keeping their season. They are removed here and added to the destination.`}
                      confirmLabel="Move"
                      payload={{ action: "membership.move", membershipId: m.membershipId }}
                      extraField={{
                        kind: "select",
                        name: "teamId",
                        label: "Destination team",
                        options: d.otherTeams.map((t) => ({ value: t.id, label: t.name })),
                      }}
                    />
                  ) : null}
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
