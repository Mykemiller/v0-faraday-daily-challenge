// League Office — Scoring section. Destructive Tier 2 action: reset the active
// season's scoring to zero (score_events / dc_completions / leaderboard_daily /
// dc_season_state), audited and reversible. Streaks + past-season results are
// out of scope by design.

import { requireStaff } from "@/lib/league-office/service";
import { getScoringResetPreview } from "@/lib/league-office/data";
import { PageHeading, PendingScreen, Card, StatusChip } from "@/components/league-office/primitives";
import ScoringReset from "@/components/league-office/ScoringReset";

export default async function ScoringPage() {
  const staff = await requireStaff();
  if (!staff.ok) return <PendingScreen />;

  const { season, counts, total } = await getScoringResetPreview(staff.s);

  return (
    <>
      <PageHeading
        title="Scoring"
        sub="Season-level scoring administration. Destructive actions are audited and reversible from the Audit Log."
      />

      <Card
        title="Reset Season Scoring"
        action={season ? <StatusChip label={season.status} tone="green" /> : undefined}
      >
        {season ? (
          <>
            <p style={{ fontSize: 13.5, color: "#41382d", margin: "0 0 6px" }}>
              Active season: <strong>{season.name}</strong>{" "}
              <span className="font-mono" style={{ color: "#8d8375", fontSize: 11.5 }}>
                {season.starts_on} → {season.ends_on}
              </span>
            </p>
            <p style={{ fontSize: 13, color: "#6b6257", margin: "0 0 16px", maxWidth: 640 }}>
              Zeros every score for <strong>{season.name}</strong> across score events, completions,
              the daily leaderboard, and season state — in a single audited transaction. Player
              <strong> streaks</strong> and <strong>archived season results</strong> are not touched,
              and no other season is affected. Prior values are captured in the Audit Log so the
              reset can be recovered manually.
            </p>

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 18,
                alignItems: "center",
                padding: "12px 14px",
                background: "var(--color-warm-panel)",
                border: "1px solid var(--color-cream-border)",
                borderRadius: 8,
                marginBottom: 16,
              }}
            >
              <Metric label="Score events" value={counts.score_events} />
              <Metric label="Completions" value={counts.dc_completions} />
              <Metric label="Daily leaderboard" value={counts.leaderboard_daily} />
              <Metric label="Season state" value={counts.dc_season_state} />
              <Metric label="Total to zero" value={total} strong />
            </div>

            <ScoringReset
              seasonName={season.name}
              counts={counts}
              total={total}
              hasActiveSeason
            />
          </>
        ) : (
          <p style={{ fontSize: 13, color: "#8d8375", margin: 0 }}>
            No active season. There is nothing to reset until a season is marked active.
          </p>
        )}
      </Card>
    </>
  );
}

function Metric({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div>
      <div className="font-mono" style={{ fontSize: 9.5, letterSpacing: ".1em", textTransform: "uppercase", color: "#8d8375" }}>
        {label}
      </div>
      <div
        className="font-serif"
        style={{ fontSize: strong ? 22 : 18, color: strong ? "var(--color-brick)" : "#141210", marginTop: 3, lineHeight: 1 }}
      >
        {value}
      </div>
    </div>
  );
}
