// League Office — Leagues & Conferences management.
//
// leagues → conferences → teams. Staff can create/archive/restore leagues and
// conferences, and assign teams to a conference (which sets the team's
// conference_id AND league_id). All writes go through the Tier 2 audited funnel
// (executeAction, domain 'leagues'). The trigger-derived
// team_conference_memberships table is never touched — assignment is the
// teams.conference_id / league_id FK columns only.

import Link from "next/link";
import { requireStaff } from "@/lib/league-office/service";
import { getLeagueTree, type TeamLite } from "@/lib/league-office/data";
import { PageHeading, Card, PendingScreen, StatusChip, EmptyState } from "@/components/league-office/primitives";
import { ActionButton } from "@/components/league-office/actions";

export default async function LeaguesPage() {
  const staff = await requireStaff();
  if (!staff.ok) return <PendingScreen />;
  const { leagues, independentTeams, assignTargets } = await getLeagueTree(staff.s);

  const activeLeagues = leagues.filter((l) => !l.archived);
  const archivedLeagues = leagues.filter((l) => l.archived);
  const confOptions = assignTargets.map((t) => ({ value: t.id, label: t.label }));

  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <PageHeading title="Leagues & Conferences" sub={`${activeLeagues.length} active league${activeLeagues.length === 1 ? "" : "s"}${archivedLeagues.length ? ` · ${archivedLeagues.length} archived` : ""}`} />
        </div>
        <div style={{ marginTop: 4 }}>
          <ActionButton
            label="+ New league"
            variant="primary"
            title="Create a league"
            description="Create a new public league. Add conferences to it, then assign teams to those conferences."
            confirmLabel="Create league"
            payload={{ action: "league.create" }}
            extraField={{ kind: "text", name: "name", label: "League name", placeholder: "e.g. Founders League" }}
          />
        </div>
      </div>

      {activeLeagues.length === 0 && independentTeams.length === 0 ? (
        <EmptyState>No leagues yet — create one to get started.</EmptyState>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          {activeLeagues.map((l) => (
            <LeagueCard key={l.id} league={l} confOptions={confOptions} />
          ))}
        </div>
      )}

      {independentTeams.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <Card title="Independent teams" action={<span className="font-mono" style={{ fontSize: 10.5, color: "#8d8375" }}>NO LEAGUE</span>}>
            <TeamGrid teams={independentTeams} confOptions={confOptions} />
          </Card>
        </div>
      )}

      {archivedLeagues.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div className="font-mono" style={{ fontSize: 10.5, letterSpacing: ".08em", textTransform: "uppercase", color: "#8d8375", marginBottom: 10 }}>
            Archived leagues · {archivedLeagues.length}
          </div>
          <div style={{ display: "grid", gap: 16 }}>
            {archivedLeagues.map((l) => (
              <LeagueCard key={l.id} league={l} confOptions={confOptions} />
            ))}
          </div>
        </div>
      )}
    </>
  );
}

type LeagueNode = Awaited<ReturnType<typeof getLeagueTree>>["leagues"][number];

function LeagueCard({ league, confOptions }: { league: LeagueNode; confOptions: { value: string; label: string }[] }) {
  return (
    <div style={{ border: "1px solid var(--color-cream-border)", borderRadius: 12, background: "#fff", opacity: league.archived ? 0.75 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: "1px solid var(--color-cream-line)" }}>
        <span className="font-serif" style={{ fontSize: 17, fontWeight: 700, color: "#141210" }}>{league.name}</span>
        <span className="font-mono" style={{ fontSize: 9.5, letterSpacing: ".06em", textTransform: "uppercase", color: "#94560a" }}>{league.league_type}</span>
        {league.archived ? <StatusChip label="Archived" tone="gray" /> : null}
        <span style={{ flex: 1 }} />
        {!league.archived ? (
          <ActionButton
            label="+ Conference"
            title="Add a conference"
            description={`Create a conference in ${league.name}. Assign teams to it below.`}
            confirmLabel="Create conference"
            payload={{ action: "conference.create", leagueId: league.id }}
            extraField={{ kind: "text", name: "name", label: "Conference name", placeholder: "e.g. East" }}
          />
        ) : null}
        {league.archived ? (
          <ActionButton
            label="Restore"
            variant="primary"
            title="Restore league"
            description={`Restore ${league.name}.`}
            confirmLabel="Restore"
            payload={{ action: "league.restore", leagueId: league.id }}
          />
        ) : (
          <ActionButton
            label="Archive"
            variant="danger"
            destructive
            title="Archive league"
            description={`Archive ${league.name}. Its conferences and teams keep their data; it stops appearing as an active league and can be restored later.`}
            confirmLabel="Archive"
            payload={{ action: "league.archive", leagueId: league.id }}
          />
        )}
      </div>

      <div style={{ padding: 16, display: "grid", gap: 12 }}>
        {league.conferences.length === 0 && league.looseTeams.length === 0 ? (
          <EmptyState>No conferences or teams in this league yet.</EmptyState>
        ) : null}

        {league.conferences.map((c) => (
          <div key={c.id} style={{ border: "1px solid var(--color-cream-line)", borderRadius: 10, padding: 12, opacity: c.archived ? 0.7 : 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: "#141210" }}>{c.name}</span>
              <span className="font-mono" style={{ fontSize: 9.5, color: "#8d8375", textTransform: "uppercase" }}>{c.type}</span>
              {c.archived ? <StatusChip label="Archived" tone="gray" /> : null}
              <span className="font-mono" style={{ fontSize: 10.5, color: "#8d8375" }}>{c.teams.length} TEAM{c.teams.length === 1 ? "" : "S"}</span>
              <span style={{ flex: 1 }} />
              {c.archived ? (
                <ActionButton
                  label="Restore"
                  title="Restore conference"
                  description={`Restore the ${c.name} conference in ${league.name}.`}
                  confirmLabel="Restore"
                  payload={{ action: "conference.restore", conferenceId: c.id }}
                />
              ) : (
                <ActionButton
                  label="Archive"
                  variant="danger"
                  destructive
                  title="Archive conference"
                  description={`Archive the ${c.name} conference. Its teams keep their assignment data; it can be restored later.`}
                  confirmLabel="Archive"
                  payload={{ action: "conference.archive", conferenceId: c.id }}
                />
              )}
            </div>
            {c.teams.length === 0 ? (
              <EmptyState>No teams in this conference.</EmptyState>
            ) : (
              <TeamGrid teams={c.teams} confOptions={confOptions} inConference />
            )}
          </div>
        ))}

        {league.looseTeams.length > 0 ? (
          <div>
            <div className="font-mono" style={{ fontSize: 9.5, letterSpacing: ".06em", textTransform: "uppercase", color: "#8d8375", marginBottom: 8 }}>
              In {league.name}, no conference
            </div>
            <TeamGrid teams={league.looseTeams} confOptions={confOptions} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TeamGrid({ teams, confOptions, inConference }: { teams: TeamLite[]; confOptions: { value: string; label: string }[]; inConference?: boolean }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
      {teams.map((t) => (
        <div key={t.id} style={{ border: "1px solid var(--color-cream-line)", borderRadius: 8, padding: "9px 12px", display: "flex", alignItems: "center", gap: 8, opacity: t.archived ? 0.6 : 1 }}>
          <Link href={`/league-office/teams/${t.id}`} style={{ fontSize: 13, fontWeight: 600, color: "#141210", textDecoration: "none" }}>{t.name}</Link>
          <span className="font-mono" style={{ fontSize: 11, color: "#8d8375" }}>{t.members}</span>
          <span style={{ flex: 1 }} />
          {confOptions.length > 0 ? (
            <ActionButton
              label={inConference ? "Move" : "Assign"}
              title="Assign team to a conference"
              description={`Assign ${t.name} to a conference. This sets the team's conference and its league to match.`}
              confirmLabel="Assign"
              payload={{ action: "team.set_conference", teamId: t.id }}
              extraField={{ kind: "select", name: "conferenceId", label: "Conference", options: confOptions }}
            />
          ) : null}
          {inConference ? (
            <ActionButton
              label="Independent"
              variant="danger"
              title="Remove from conference"
              description={`Remove ${t.name} from its conference. It stays in the league but joins no conference.`}
              confirmLabel="Remove"
              payload={{ action: "team.clear_conference", teamId: t.id }}
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}
