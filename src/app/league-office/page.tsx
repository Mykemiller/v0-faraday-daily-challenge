// League Office — Dashboard. Live league health for the scoped season.

import { requireStaff } from "@/lib/league-office/service";
import { getDashboard, ctToday } from "@/lib/league-office/data";
import { PageHeading, KpiCard, Card, PendingScreen, StatusChip } from "@/components/league-office/primitives";
import { statusToTone, type StatusTone } from "@/lib/league-office/constants";
import Link from "next/link";

function prettyDate(d: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(d + "T12:00:00Z"));
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}) {
  const staff = await requireStaff();
  if (!staff.ok) return <PendingScreen />;
  const { season: seasonId } = await searchParams;
  const d = await getDashboard(staff.s, seasonId);

  return (
    <>
      <PageHeading
        title="Dashboard"
        sub={
          <>
            League health for <strong>{d.season?.name ?? "all seasons"}</strong> ·{" "}
            {prettyDate(ctToday())}
          </>
        }
      />

      {d.season && (
        <div
          className="brand-gradient"
          style={{ borderRadius: 12, padding: "18px 22px", color: "#f8f5f0", marginBottom: 20 }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <span
              aria-hidden
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: "var(--color-gold)",
                animation: "loPulse 1.6s ease-out infinite",
              }}
            />
            <div>
              <div className="font-serif" style={{ fontSize: 18 }}>
                {d.season.name}
              </div>
              <div style={{ fontSize: 12.5, color: "rgba(248,245,240,.8)", marginTop: 2 }}>
                {d.season.status.toUpperCase()} · {d.season.starts_on ?? "?"} → {d.season.ends_on ?? "?"}
                {d.season.free_agency_start ? ` · FA opens ${d.season.free_agency_start}` : ""}
              </div>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 22 }}>
        <KpiCard label="Active Subscribers" value={d.activeSubscribers.toLocaleString()} foot="opted-in players" href="/league-office/subscribers" />
        <KpiCard label="Playing Today" value={d.playingToday.toLocaleString()} foot={`${pct(d.playingToday, d.activeSubscribers)} of active`} />
        <KpiCard label="Teams" value={d.teams.toLocaleString()} foot={`${d.pendingRequests} pending requests`} href="/league-office/teams" />
        <KpiCard label="Pending Requests" value={d.pendingRequests.toLocaleString()} foot="membership approvals" href="/league-office/teams" />
        <KpiCard label="Puzzle Cache" value={`${d.puzzleCached}d`} foot="days cached ahead" href="/league-office/puzzles" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16 }}>
        <Card title="League activity" action={<Link href="/league-office/subscribers" style={{ fontSize: 12, color: "var(--color-amber-dark)", textDecoration: "none" }}>Subscribers →</Link>}>
          {d.activity.length === 0 ? (
            <p style={{ color: "#8d8375", fontSize: 13, margin: 0 }}>No scoring events recorded yet.</p>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {d.activity.map((a, i) => (
                <li key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderTop: i ? "1px solid var(--color-cream-line)" : "none" }}>
                  <span aria-hidden style={{ width: 8, height: 8, borderRadius: "50%", background: dotColor(a.tone as StatusTone), flex: "none" }} />
                  <span style={{ fontSize: 13, color: "#141210", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    <strong>@{a.who}</strong> — {a.what}
                  </span>
                  <span className="font-mono" style={{ fontSize: 11, color: "#8d8375", flex: "none" }}>{a.when}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Needs attention">
          {d.attention.length === 0 ? (
            <p style={{ color: "#8d8375", fontSize: 13, margin: 0 }}>Nothing needs attention. Queue clear.</p>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {d.attention.map((a, i) => (
                <li key={i} style={{ padding: "10px 0", borderTop: i ? "1px solid var(--color-cream-line)" : "none" }}>
                  <Link href={a.href} style={{ textDecoration: "none", color: "inherit", display: "block" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                      <StatusChip label={a.chip} tone={statusToTone(a.chip)} />
                      <span style={{ fontSize: 13, fontWeight: 600, color: "#141210" }}>{a.title}</span>
                    </div>
                    <div style={{ fontSize: 12, color: "#6b6257" }}>{a.sub}</div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

function pct(a: number, b: number) {
  if (!b) return "0%";
  return `${Math.round((a / b) * 100)}%`;
}
function dotColor(tone: StatusTone) {
  return { green: "#4f6b4d", amber: "#94560a", red: "#9c3b2e", gray: "#8d8375" }[tone];
}
