// League Office — Subscriber detail. Live profile, play-history matrix
// (7 games × last 7 days), team memberships, and badges. Write-actions
// (View-as / Correct-a-score / Pause) are Tier 2 — shown disabled here.

import Link from "next/link";
import { requireStaff } from "@/lib/league-office/service";
import { getSubscriber } from "@/lib/league-office/data";
import { PageHeading, KpiCard, Card, PendingScreen, StatusChip, EmptyState } from "@/components/league-office/primitives";
import { GameDot } from "@/components/league-office/primitives";

function fmtDay(d: string) {
  return new Intl.DateTimeFormat("en-US", { month: "numeric", day: "numeric" }).format(new Date(d + "T12:00:00Z"));
}

export default async function SubscriberDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const staff = await requireStaff();
  if (!staff.ok) return <PendingScreen />;
  const { id } = await params;
  const d = await getSubscriber(staff.s, id);

  if (!d.sub) {
    return (
      <>
        <PageHeading title="Subscriber" />
        <EmptyState>Subscriber not found.</EmptyState>
      </>
    );
  }
  const handle = d.sub.handle || d.sub.email.split("@")[0];

  return (
    <>
      <Link href="/league-office/subscribers" style={{ fontSize: 12.5, color: "var(--color-amber-dark)", textDecoration: "none" }}>
        ← Subscribers
      </Link>
      <div style={{ display: "flex", alignItems: "center", gap: 14, margin: "8px 0 6px" }}>
        <h1 className="font-serif" style={{ fontSize: 26, margin: 0 }}>@{handle}</h1>
        <StatusChip label={d.sub.active === false ? "Paused" : "Active"} tone={d.sub.active === false ? "gray" : "green"} />
      </div>
      <div className="double-rule" />
      <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "12px 0 20px" }}>
        <span className="font-mono" style={{ fontSize: 11.5, color: "#8d8375" }}>{d.sub.email}</span>
        <span style={{ flex: 1 }} />
        {["View as read-only", "Correct a score", "Pause account"].map((a) => (
          <button
            key={a}
            disabled
            title="Write-actions land in the next phase (Tier 2)"
            style={{
              fontSize: 12.5,
              padding: "7px 12px",
              borderRadius: 7,
              border: "1px solid var(--color-cream-border)",
              background: "#fff",
              color: "#b2a898",
              cursor: "not-allowed",
            }}
          >
            {a}
          </button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 22 }}>
        <KpiCard label="Attempts (7d)" value={d.totals.attempts} />
        <KpiCard label="Wins (7d)" value={d.totals.wins} />
        <KpiCard label="Play streak" value={d.sub.play_streak ?? 0} />
        <KpiCard label="Badges" value={d.totals.badges} />
      </div>

      <Card title="Play history — last 7 days">
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 520 }}>
            <div style={{ display: "grid", gridTemplateColumns: "150px repeat(7, 1fr)", gap: 6, marginBottom: 6 }}>
              <div />
              {d.dates.map((dt) => (
                <div key={dt} className="font-mono" style={{ fontSize: 10, color: "#8d8375", textAlign: "center" }}>
                  {fmtDay(dt)}
                </div>
              ))}
            </div>
            {d.matrix.map((row) => (
              <div key={row.game} style={{ display: "grid", gridTemplateColumns: "150px repeat(7, 1fr)", gap: 6, marginBottom: 6, alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <GameDot game={row.game} />
                  <span style={{ fontSize: 12.5 }}>{row.game}</span>
                </div>
                {row.cells.map((c) => (
                  <div
                    key={c.date}
                    title={c.played ? `Score ${c.score}` : "Missed"}
                    style={{
                      height: 30,
                      borderRadius: 6,
                      display: "grid",
                      placeItems: "center",
                      fontSize: 11.5,
                      fontWeight: 600,
                      background: c.played ? "rgba(79,107,77,.16)" : "var(--color-warm-cream)",
                      color: c.played ? "#4f6b4d" : "#c3b9a8",
                    }}
                  >
                    {c.played ? c.score : "·"}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
        <Card title="Team memberships">
          {d.memberships.length === 0 ? (
            <EmptyState>Not on any team.</EmptyState>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {d.memberships.map((m, i) => (
                <li key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderTop: i ? "1px solid var(--color-cream-line)" : "none" }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{m.team}</span>
                  {m.group_type === "company" ? <StatusChip label="Company" tone="amber" /> : null}
                  <span style={{ flex: 1 }} />
                  <StatusChip label={m.pending ? "Pending" : m.role} tone={m.pending ? "amber" : "green"} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Badges">
          {d.badges.length === 0 ? (
            <EmptyState>No badges yet.</EmptyState>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {d.badges.map((b, i) => (
                <span key={i} className="font-mono" style={{ fontSize: 11, padding: "5px 9px", borderRadius: 6, background: "var(--color-warm-panel)", border: "1px solid var(--color-cream-border)", color: "#6b6257" }}>
                  {b.key}
                </span>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
