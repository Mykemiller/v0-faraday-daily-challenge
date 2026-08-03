// League Office — Season Config editor route (spec §2.4).
//
// Server component: verifies staff, loads the config bundle + the pickers the
// editor needs, and hands them to the client editor. The editability rule lives
// in the editor and in the API — this page only supplies data.

import { requireStaff } from "@/lib/league-office/service";
import {
  getConfigBundle, getScopeOptions, loadConfigs, loadThemeTaxonomy,
} from "@/lib/league-office/seasons";
import { PageHeading, PendingScreen, EmptyState } from "@/components/league-office/primitives";
import ConfigEditor from "@/components/league-office/season/ConfigEditor";

export default async function ConfigEditorPage({
  params,
}: {
  params: Promise<{ id: string; configId: string }>;
}) {
  const staff = await requireStaff();
  if (!staff.ok) return <PendingScreen />;

  const { id, configId } = await params;
  const bundle = await getConfigBundle(staff.s, configId);

  if (!bundle || bundle.config.season_id !== id) {
    return (
      <>
        <PageHeading title="Configuration" />
        <EmptyState>That configuration version was not found for this season.</EmptyState>
      </>
    );
  }

  const [scopeOptions, taxonomy, siblings] = await Promise.all([
    getScopeOptions(staff.s),
    loadThemeTaxonomy(staff.s),
    loadConfigs(staff.s, id),
  ]);

  // The incumbent is what the promote dialog diffs against.
  const incumbent =
    siblings.find((c: { state: string; id: string }) => c.state === "active" && c.id !== configId) ??
    null;

  return (
    <ConfigEditor
      bundle={bundle}
      scopeOptions={scopeOptions}
      taxonomy={taxonomy}
      incumbent={incumbent}
    />
  );
}
