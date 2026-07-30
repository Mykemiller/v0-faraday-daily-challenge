// League Office — Seasons index (spec §2.1). The existing table, plus scope,
// slate size and config-version columns, a per-row action menu, and the
// New Season entry point.
//
// The row is no longer a single wrapping <Link> — the action menu is interactive
// and must not nest inside one. The season name carries the link instead.

import Link from "next/link";
import { requireStaff } from "@/lib/league-office/service";
import { listSeasonSummaries, type SeasonSummary } from "@/lib/league-office/seasons";
import { PageHeading, PendingScreen, StatusChip } from "@/components/league-office/primitives";
import { DataTable, type Column } from "@/components/league-office/DataTable";
import { SeasonRowMenu } from "@/components/league-office/season/SeasonRowMenu";

const statusTone = (s: string) =>
  s === "active" ? "green" : s === "upcoming" ? "amber" : "gray";

export default async function SeasonsPage() {
  const staff = await requireStaff();
  if (!staff.ok) return <PendingScreen />;
  const seasons = await listSeasonSummaries(staff.s);

  const columns: Column<SeasonSummary>[] = [
    {
      head: "Season",
      width: "1.5fr",
      cell: (r) => (
        <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <Link
            href={`/league-office/seasons/${r.season.id}`}
            style={{
              fontWeight: 600,
              color: "#141210",
              textDecoration: "none",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {r.season.name}
          </Link>
          {r.season.locked_at ? <StatusChip label="locked" tone="gray" /> : null}
        </span>
      ),
    },
    {
      head: "Status",
      width: "104px",
      cell: (r) => <StatusChip label={r.season.status} tone={statusTone(r.season.status)} />,
    },
    {
      head: "Scope",
      width: "1.1fr",
      cell: (r) => (
        <span
          className="font-mono"
          title={r.scope.excluded.length ? `Excluded: ${r.scope.excluded.join(", ")}` : undefined}
          style={{
            fontSize: 10,
            letterSpacing: ".04em",
            padding: "3px 7px",
            borderRadius: 5,
            border: "1px solid var(--color-cream-border)",
            background: "var(--color-warm-panel)",
            color: "#6b6257",
            display: "inline-block",
            maxWidth: "100%",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {r.scope.label}
          {r.scope.excluded.length ? ` −${r.scope.excluded.length}` : ""}
        </span>
      ),
    },
    {
      head: "Games",
      width: "84px",
      align: "right",
      cell: (r) => (
        <span
          className="font-mono"
          style={{ fontSize: 12, color: r.enabledGames === 0 ? "#9c3b2e" : "#141210" }}
        >
          {r.enabledGames} of {r.totalGames}
        </span>
      ),
    },
    { head: "Config", width: "1.2fr", cell: (r) => <ConfigCell row={r} /> },
    {
      head: "Starts",
      width: "100px",
      cell: (r) => <span className="font-mono" style={{ fontSize: 12 }}>{r.season.starts_on ?? "—"}</span>,
    },
    {
      head: "Ends",
      width: "100px",
      cell: (r) => <span className="font-mono" style={{ fontSize: 12 }}>{r.season.ends_on ?? "—"}</span>,
    },
    {
      head: "",
      width: "48px",
      align: "right",
      cell: (r) => (
        <SeasonRowMenu
          seasonId={r.season.id}
          configId={
            (r.activeConfig ?? r.scheduledConfig ?? r.configs[r.configs.length - 1])?.id ?? null
          }
          locked={!!r.season.locked_at}
        />
      ),
    },
  ];

  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <PageHeading
            title="Seasons"
            sub={`${seasons.length} season${seasons.length === 1 ? "" : "s"}`}
          />
        </div>
        <Link
          href="/league-office/seasons/new"
          className="font-mono"
          style={{
            marginTop: 4,
            flex: "none",
            fontSize: 10.5,
            letterSpacing: ".08em",
            textTransform: "uppercase",
            padding: "9px 16px",
            borderRadius: 7,
            background: "#c4922a",
            border: "1px solid #c4922a",
            color: "#fff",
            textDecoration: "none",
            whiteSpace: "nowrap",
          }}
        >
          New Season
        </Link>
      </div>

      <DataTable
        columns={columns}
        rows={seasons}
        getKey={(r) => r.season.id}
        empty="No seasons yet — create the first one."
      />
    </>
  );
}

/** `v2 · active` plus any scheduled successor, and the warning badge required by
 *  spec §2.1 when the season's governing config has validation findings. */
function ConfigCell({ row }: { row: SeasonSummary }) {
  const active = row.activeConfig;
  const scheduled = row.scheduledConfig;
  const latest = row.configs[row.configs.length - 1];

  if (!row.configs.length)
    return <span style={{ fontSize: 12, color: "#8d8375" }}>No config</span>;

  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      {active ? (
        <span className="font-mono" style={{ fontSize: 11.5, color: "#141210" }}>
          v{active.version} · <span style={{ color: "#4f6b4d" }}>active</span>
        </span>
      ) : (
        <span className="font-mono" style={{ fontSize: 11.5, color: "#8d8375" }}>
          v{latest.version} · {latest.state}
        </span>
      )}

      {scheduled ? (
        <span className="font-mono" style={{ fontSize: 10.5, color: "#94560a" }}>
          v{scheduled.version} · scheduled {String(scheduled.effective_from).slice(0, 10)}
        </span>
      ) : null}

      {row.errors > 0 ? (
        <StatusChip label={`${row.errors} error${row.errors === 1 ? "" : "s"}`} tone="red" />
      ) : row.warnings > 0 ? (
        <StatusChip label={`${row.warnings} warning${row.warnings === 1 ? "" : "s"}`} tone="amber" />
      ) : null}
    </span>
  );
}
