// League Office — Game Library (CC-LO-GAME-LIBRARY-1.0).
//
// (A) library status board, (B) lifecycle control, (C) which games are active in
// which season. The three are deliberately distinct surfaces because lifecycle
// and season assignment are different kinds of fact (D1): lifecycle is ONE state
// per game; assignment is a many-to-many relationship. Every one of the 7 live
// games is Live *and* assigned to 4 seasons.
//
// ⚠️ The season slate is ADVISORY (D4). /api/challenge/today selects on publish
// state alone (`published = 'Live'`) and keys games by free-text puzzle_type —
// it never reads season_config or season_games. Toggling a game here changes
// what the console *says*, not what subscribers are served. Enforcement is a
// later phase, gated behind the DC_PUZZLE_SOURCE cutover.

import { requireStaff } from "@/lib/league-office/service";
import { loadGameLibrary, loadAuditByGame } from "@/lib/league-office/game-library";
import { PageHeading, PendingScreen, KpiCard, Card } from "@/components/league-office/primitives";
import { LIFECYCLE_LABEL, LIFECYCLE_STATES } from "@/lib/league-office/game-library-logic";
import { LibraryBoard, type BoardRow } from "@/components/league-office/game-library/LibraryBoard";
import { SeasonMatrix } from "@/components/league-office/game-library/SeasonMatrix";
import { NewGameButton } from "@/components/league-office/game-library/NewGameButton";
import { Toaster } from "@/components/league-office/actions";

export const dynamic = "force-dynamic";

export default async function GameLibraryPage() {
  const staff = await requireStaff();
  if (!staff.ok) return <PendingScreen />;

  const [library, auditByGame] = await Promise.all([
    loadGameLibrary(staff.s),
    loadAuditByGame(staff.s),
  ]);

  const rows: BoardRow[] = library.entries.map((e) => ({
    ...e,
    audit: auditByGame.get(e.game.id) ?? [],
    seasons: library.seasons,
    bankDepthUnavailable: library.bankDepthUnavailable,
  }));

  const total = library.entries.length;

  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <PageHeading
            title="Game Library"
            sub={`${total} games across the catalog — lifecycle, puzzle-bank depth, and season assignment.`}
          />
        </div>
        <div style={{ paddingTop: 4 }}>
          <NewGameButton />
        </div>
      </div>

      {/* summary strip */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: 12,
          marginBottom: 22,
        }}
      >
        {LIFECYCLE_STATES.map((s) => (
          <KpiCard
            key={s}
            label={LIFECYCLE_LABEL[s]}
            value={library.counts[s]}
            foot={s === "live" ? "serving today" : s === "new_idea" ? "backlog concepts" : undefined}
          />
        ))}
      </div>

      <div style={{ marginBottom: 26 }}>
        <LibraryBoard rows={rows} canWrite={staff.role === "commissioner"} />
      </div>

      <Card title="Season matrix">
        <SeasonMatrix entries={library.entries} seasons={library.seasons} />
      </Card>

      <p style={{ fontSize: 11.5, color: "#8d8375", marginTop: 18, lineHeight: 1.6, maxWidth: 760 }}>
        <strong>The slate gates serving.</strong> A game enabled here is served to subscribers;
        a game disabled here is not — it loses its lobby tile and cannot be played.{" "}
        <code>/api/challenge/today</code> narrows the day&rsquo;s Live puzzles to the active
        season&rsquo;s enabled games. A season with no active configuration serves everything,
        so an unconfigured season can never go dark.
      </p>

      <Toaster />
    </>
  );
}
