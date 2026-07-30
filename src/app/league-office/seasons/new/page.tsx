// League Office — New Season wizard route (spec §2.2).
//
// Static segment, so it resolves ahead of /seasons/[id]. Loads the pickers the
// wizard needs; the season row itself is not created until step 4 submits.

import { requireStaff } from "@/lib/league-office/service";
import { loadSeasons } from "@/lib/league-office/data";
import { getScopeOptions } from "@/lib/league-office/seasons";
import { PendingScreen } from "@/components/league-office/primitives";
import SeasonWizard from "@/components/league-office/season/SeasonWizard";

export default async function NewSeasonPage({
  searchParams,
}: {
  searchParams: Promise<{ copyFrom?: string }>;
}) {
  const staff = await requireStaff();
  if (!staff.ok) return <PendingScreen />;

  const [scopeOptions, seasons, sp] = await Promise.all([
    getScopeOptions(staff.s),
    loadSeasons(staff.s),
    searchParams,
  ]);

  return (
    <SeasonWizard
      scopeOptions={scopeOptions}
      seasons={seasons.map((s) => ({ id: s.id, name: s.name, slug: s.slug }))}
      existingSlugs={seasons.map((s) => String(s.slug).toLowerCase())}
      initialCopyFrom={sp?.copyFrom}
    />
  );
}
