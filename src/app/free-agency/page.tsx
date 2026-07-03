import DcStubPage from "@/components/DcStubPage";

export const metadata = { title: "Free Agency · Faraday Daily Challenge" };

// Compete → Free Agency stub. Season-scoped: teams lock during the season and
// players move only inside the trading window. The window itself is a
// placeholder — nothing here is functional yet.

export default function FreeAgencyPage() {
  return (
    <DcStubPage
      title="Free Agency"
      blurb="Move between teams during the season's trading window. Season-scoped — outside the window, rosters stay locked."
    >
      <p className="font-mono text-[13px] text-forest">Trade window: TBD</p>
      <p>
        When the window opens you&rsquo;ll be able to leave a team and join another without
        losing your season score. Details land here before the first window.
      </p>
    </DcStubPage>
  );
}
