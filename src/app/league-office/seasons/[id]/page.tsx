// League Office — Season detail. Timeline centerpiece (regular play · trading
// windows · free agency · TODAY marker), standings snapshot, participants —
// plus the configuration layer (spec §2.3): scope chips, the version timeline
// with its field-by-field diff, the "effective now" panel, and the action bar.

import Link from "next/link";
import { requireStaff } from "@/lib/league-office/service";
import { getSeason, ctToday } from "@/lib/league-office/data";
import { getSeasonConfigDetail, resolveScopeTeamCount } from "@/lib/league-office/seasons";
import { PageHeading, Card, KpiCard, PendingScreen, StatusChip, EmptyState } from "@/components/league-office/primitives";
import { SeasonVersions } from "@/components/league-office/season/SeasonVersions";
import { SeasonActionBar } from "@/components/league-office/season/SeasonActionBar";
import { GenerationPanel } from "@/components/league-office/season/GenerationPanel";
import { dayMaskLabel } from "@/lib/league-office/season-config-logic";

function dnum(d: string | null): number | null {
  if (!d) return null;
  return new Date(d + "T12:00:00Z").getTime();
}
function addDays(d: string, n: number): string {
  const t = new Date(d + "T12:00:00Z");
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

export default async function SeasonDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const staff = await requireStaff();
  if (!staff.ok) return <PendingScreen />;
  const { id } = await params;
  const [d, cfg] = await Promise.all([
    getSeason(staff.s, id),
    getSeasonConfigDetail(staff.s, id),
  ]);
  const scopeTeamCount = await resolveScopeTeamCount(staff.s, cfg.scopes);

  if (!d.season) {
    return (
      <>
        <PageHeading title="Season" />
        <EmptyState>Season not found.</EmptyState>
      </>
    );
  }
  const s = d.season;

  return (
    <>
      <Link href="/league-office/seasons" style={{ fontSize: 12.5, color: "var(--color-amber-dark)", textDecoration: "none" }}>← Seasons</Link>
      <div style={{ display: "flex", alignItems: "center", gap: 14, margin: "8px 0 6px" }}>
        <h1 className="font-serif" style={{ fontSize: 26, margin: 0 }}>{s.name}</h1>
        <StatusChip label={s.status} tone={s.status === "active" ? "green" : s.status === "upcoming" ? "amber" : "gray"} />
      </div>
      <div className="double-rule" />
      <p style={{ fontSize: 13, color: "#6b6257", margin: "12px 0 12px" }}>
        {s.starts_on ?? "?"} → {s.ends_on ?? "?"}
        {s.locked_at ? ` · locked ${s.locked_at.slice(0, 10)}` : ""}
      </p>

      {/* scope chips */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 18 }}>
        <ScopeChip label={cfg.scope.label} />
        {cfg.scope.excluded.map((x) => (
          <ScopeChip key={x} label={`excl. ${x}`} muted />
        ))}
        <ScopeChip label={`${scopeTeamCount} team${scopeTeamCount === 1 ? "" : "s"}`} muted />
      </div>

      <div style={{ marginBottom: 20 }}>
        <SeasonActionBar seasonId={s.id} locked={!!s.locked_at} status={s.status} />
      </div>

      <div style={{ marginBottom: 16 }}>
        <Card title="Puzzle generation">
          <GenerationPanel seasonId={s.id} />
        </Card>
      </div>

      <Card title="Configuration versions">
        <SeasonVersions seasonId={s.id} configs={cfg.configs} />
      </Card>

      <div style={{ margin: "16px 0" }}>
        <Card title="Effective now">
          <EffectiveNow effective={cfg.effective} />
        </Card>
      </div>

      <Card title="Season timeline">
        <Timeline
          start={s.starts_on}
          end={s.ends_on}
          faStart={s.free_agency_start}
          today={ctToday()}
        />
        <div style={{ display: "flex", gap: 16, marginTop: 12, flexWrap: "wrap" }}>
          <Legend color="#325638" label="Regular play" />
          <Legend color="#c4922a" label="Trading window" />
          <Legend color="#8ca68a" label="Free agency" />
          <Legend color="#9c3b2e" label="Today" />
        </div>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, margin: "16px 0" }}>
        <KpiCard label="Participants" value={d.participants} foot="with recorded season state" />
        <KpiCard label="Free agency" value={s.free_agency_start ? `${s.free_agency_start}` : "—"} foot="opens" />
        <KpiCard label="Status" value={s.status} />
      </div>

      <Card title="Standings snapshot (top 10)">
        {d.standings.length === 0 ? (
          <EmptyState>No ranking snapshots recorded for this scope yet.</EmptyState>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {d.standings.map((r) => (
              <li key={r.rank} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderTop: r.rank > 1 ? "1px solid var(--color-cream-line)" : "none" }}>
                <span className="font-mono" style={{ fontSize: 13, color: "#94560a", width: 28 }}>#{r.rank}</span>
                <span style={{ fontSize: 13, fontWeight: 600 }}>@{r.handle}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

function ScopeChip({ label, muted }: { label: string; muted?: boolean }) {
  return (
    <span
      className="font-mono"
      style={{
        fontSize: 10,
        letterSpacing: ".05em",
        padding: "4px 9px",
        borderRadius: 5,
        border: "1px solid var(--color-cream-border)",
        background: muted ? "var(--color-warm-panel)" : "rgba(196,146,42,.12)",
        color: muted ? "#8d8375" : "#94560a",
      }}
    >
      {label}
    </span>
  );
}

/** Reads `v_season_effective_config` — the configuration actually in force right
 *  now. Runtime view: a scheduled version does NOT appear here until its
 *  effective date arrives (the hourly cron flips it), which is exactly how the
 *  commissioner can tell scheduling is real and not decorative. */
function EffectiveNow({ effective }: { effective: Record<string, unknown> | null }) {
  if (!effective)
    return <EmptyState>No configuration version is in force for this season yet.</EmptyState>;

  const v = (k: string) => effective[k];
  const fmt = (x: unknown) =>
    x === null || x === undefined || x === "" ? "—" : typeof x === "boolean" ? (x ? "On" : "Off") : String(x);

  const rows: [string, string][] = [
    ["Version", `v${fmt(v("config_version"))} · ${fmt(v("config_state"))}`],
    ["In force since", String(v("effective_from") ?? "").slice(0, 16).replace("T", " ") || "—"],
    ["Games per day", fmt(v("games_per_day") ?? "all enabled")],
    ["Play days", dayMaskLabel((v("play_days_of_week") as number[]) ?? null)],
    ["Max teams / subscriber", fmt(v("max_teams_per_subscriber"))],
    ["Team size", `${fmt(v("min_team_size"))} – ${fmt(v("max_team_size") ?? "∞")}`],
    ["Scoring profile", fmt(v("scoring_profile"))],
    ["Team score method", fmt(v("team_score_method"))],
    ["Difficulty curve", fmt(v("difficulty_curve"))],
    ["Hints", v("hints_enabled") ? `${fmt(v("max_hints_per_game"))} max · −${fmt(v("hint_penalty_pct"))}%` : "Off"],
    ["Free agency", fmt(v("allow_free_agency"))],
    ["Late join", fmt(v("allow_late_join"))],
    ["Leaderboard", v("publish_leaderboard") ? fmt(v("leaderboard_visibility")) : "Not published"],
    ["Roster lock", fmt(v("roster_lock_on"))],
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: "10px 22px" }}>
      {rows.map(([label, value]) => (
        <div key={label} style={{ display: "flex", gap: 10, alignItems: "baseline", minWidth: 0 }}>
          <span
            className="font-mono"
            style={{ fontSize: 9.5, letterSpacing: ".08em", textTransform: "uppercase", color: "#8d8375", flex: "none", width: 118 }}
          >
            {label}
          </span>
          <span style={{ fontSize: 12.5, color: "#141210", overflow: "hidden", textOverflow: "ellipsis" }}>
            {value}
          </span>
        </div>
      ))}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "#6b6257" }}>
      <span style={{ width: 12, height: 12, borderRadius: 3, background: color }} />
      {label}
    </span>
  );
}

function Timeline({
  start,
  end,
  faStart,
  today,
}: {
  start: string | null;
  end: string | null;
  faStart: string | null;
  today: string;
}) {
  if (!start || !end) return <EmptyState>Season dates not set.</EmptyState>;
  const s = dnum(start)!;
  const e = dnum(end)!;
  const faS = dnum(faStart) ?? null;
  const faE = faStart ? dnum(addDays(faStart, 5))! : null;
  const domainEnd = Math.max(e, faE ?? e);
  const span = Math.max(1, domainEnd - s);
  const pct = (t: number) => `${Math.min(100, Math.max(0, ((t - s) / span) * 100))}%`;
  const width = (a: number, b: number) => `${Math.max(0, ((b - a) / span) * 100)}%`;

  const tradeFirst = { left: pct(s), width: width(s, dnum(addDays(start, 7))!) };
  const tradeLast = { left: pct(dnum(addDays(end, -7))!), width: width(dnum(addDays(end, -7))!, e) };
  const todayT = dnum(today)!;

  return (
    <div style={{ position: "relative", height: 46 }}>
      {/* regular play base */}
      <div style={{ position: "absolute", top: 14, left: pct(s), width: width(s, e), height: 18, background: "#325638", borderRadius: 4 }} />
      {/* trading windows */}
      <div style={{ position: "absolute", top: 14, left: tradeFirst.left, width: tradeFirst.width, height: 18, background: "#c4922a", borderRadius: 4 }} />
      <div style={{ position: "absolute", top: 14, left: tradeLast.left, width: tradeLast.width, height: 18, background: "#c4922a", borderRadius: 4 }} />
      {/* free agency (overhangs end) */}
      {faS != null && faE != null && (
        <div style={{ position: "absolute", top: 8, left: pct(faS), width: width(faS, faE), height: 10, background: "#8ca68a", borderRadius: 4, opacity: 0.9 }} title="Free agency" />
      )}
      {/* today marker */}
      {todayT >= s && todayT <= domainEnd && (
        <div style={{ position: "absolute", top: 2, bottom: 2, left: pct(todayT), width: 2, background: "#9c3b2e" }} title={`Today · ${today}`} />
      )}
    </div>
  );
}
