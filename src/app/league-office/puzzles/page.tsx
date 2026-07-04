// League Office — Puzzle & Hint Admin. Trailing 4-week cache-status calendar
// (dc_daily_page_content, keyed by puzzle_date) + IDF domain ranking
// (faraday_domains). Airtable authors → Supabase caches; Airtable is never in
// the hot path. Resync / Preview are Tier 2 (shown disabled).

import { requireStaff } from "@/lib/league-office/service";
import { getPuzzleCalendar, ctToday } from "@/lib/league-office/data";
import { PageHeading, Card, PendingScreen, EmptyState } from "@/components/league-office/primitives";

const AIRTABLE_BANK = "https://airtable.com/appxfti7VuoHYUeu6/tbliJaRmctbIWJC43";

export default async function PuzzlesPage() {
  const staff = await requireStaff();
  if (!staff.ok) return <PendingScreen />;
  const { days, domains } = await getPuzzleCalendar(staff.s);
  const today = ctToday();
  const cached = days.filter((d) => d.cached).length;

  return (
    <>
      <PageHeading title="Puzzle & Hint Admin" sub={`${cached} of ${days.length} trailing days cached · Airtable authors → Supabase caches`} />

      <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 16 }}>
        <Card
          title="Cache calendar — last 4 weeks"
          action={
            <a href={AIRTABLE_BANK} target="_blank" rel="noreferrer" className="font-mono" style={{ fontSize: 10.5, color: "#94560a", textDecoration: "none" }}>
              Open Puzzle Bank ↗
            </a>
          }
        >
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
            {days.map((d) => {
              const isToday = d.date === today;
              const color = d.cached ? (d.synced ? "#4f6b4d" : "#c4922a") : "#d8cfbf";
              return (
                <div
                  key={d.date}
                  title={`${d.date}${d.cached ? (d.synced ? " · synced" : " · cached (unsynced)") : " · not cached"}${d.domain ? ` · ${d.domain}` : ""}`}
                  style={{
                    border: isToday ? "2px solid var(--color-forest)" : "1px solid var(--color-cream-line)",
                    borderRadius: 7,
                    padding: "8px 6px",
                    minHeight: 46,
                    background: "#fff",
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  }}
                >
                  <span className="font-mono" style={{ fontSize: 10, color: "#8d8375" }}>{d.date.slice(5)}</span>
                  <span aria-hidden style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 14, marginTop: 12, flexWrap: "wrap" }}>
            <Legend color="#4f6b4d" label="Synced" />
            <Legend color="#c4922a" label="Cached · unsynced" />
            <Legend color="#d8cfbf" label="Not cached" />
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            {["Resync from Airtable", "Preview as subscriber"].map((a) => (
              <button key={a} disabled title="Write-actions land in the next phase (Tier 2)"
                style={{ fontSize: 12.5, padding: "8px 13px", borderRadius: 7, border: "1px solid var(--color-cream-border)", background: "#fff", color: "#b2a898", cursor: "not-allowed" }}>
                {a}
              </button>
            ))}
          </div>
        </Card>

        <Card title="IDF domain ranking">
          {domains.length === 0 ? (
            <EmptyState>No active domains in faraday_domains.</EmptyState>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {domains.map((dm, i) => {
                const weight = 1 - i / Math.max(1, domains.length); // rank-ordered visual weight
                return (
                  <li key={dm.code} style={{ padding: "8px 0", borderTop: i ? "1px solid var(--color-cream-line)" : "none" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                      <span className="font-mono" style={{ fontSize: 11, color: "#8d8375", width: 34 }}>{dm.code}</span>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{dm.emoji ? `${dm.emoji} ` : ""}{dm.name}</span>
                    </div>
                    <div style={{ height: 8, borderRadius: 4, background: "var(--color-warm-cream)", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${Math.round(weight * 100)}%`, background: "linear-gradient(90deg, var(--color-gold) 0%, var(--color-gold-light) 100%)" }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "#6b6257" }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
      {label}
    </span>
  );
}
