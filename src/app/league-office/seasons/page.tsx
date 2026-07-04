// League Office — Seasons list. Live seasons with status chips.

import { requireStaff } from "@/lib/league-office/service";
import { listSeasons, type Season } from "@/lib/league-office/data";
import { PageHeading, PendingScreen, StatusChip } from "@/components/league-office/primitives";
import { DataTable, type Column } from "@/components/league-office/DataTable";

const statusTone = (s: string) =>
  s === "active" ? "green" : s === "upcoming" ? "amber" : "gray";

export default async function SeasonsPage() {
  const staff = await requireStaff();
  if (!staff.ok) return <PendingScreen />;
  const seasons = await listSeasons(staff.s);

  const columns: Column<Season>[] = [
    { head: "Season", width: "1.6fr", cell: (s) => <span style={{ fontWeight: 600, color: "#141210" }}>{s.name}</span> },
    { head: "Status", width: "120px", cell: (s) => <StatusChip label={s.status} tone={statusTone(s.status)} /> },
    { head: "Starts", width: "120px", cell: (s) => s.starts_on ?? "—" },
    { head: "Ends", width: "120px", cell: (s) => s.ends_on ?? "—" },
    { head: "Free agency", width: "130px", cell: (s) => s.free_agency_start ?? "—" },
  ];

  return (
    <>
      <PageHeading title="Seasons" sub={`${seasons.length} season${seasons.length === 1 ? "" : "s"}`} />
      <DataTable columns={columns} rows={seasons} getKey={(s) => s.id} rowHref={(s) => `/league-office/seasons/${s.id}`} empty="No seasons yet." />
    </>
  );
}
