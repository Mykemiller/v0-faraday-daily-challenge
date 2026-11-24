import { redirect } from "next/navigation";
import StubPage from "@/components/StubPage";
import { SIGNAL_ROOM_URL, loadSignalRoomHealth, signalRoomTile } from "@/lib/signal-room";

export const metadata = { title: "Signal Room — Faraday" };

// faraday-intelligence.ai/signal-room is the in-brand address the DC masthead,
// the legal schedule and old links point at. Signal Room itself is a separate
// app (src/lib/signal-room.ts). When that app reports a populated, launched
// feed this route forwards to it; until then it keeps rendering the stub, so
// the in-brand address never lands a reader on an error card. The rule is the
// same one the Home tile uses for its "Live" tag.
export default async function Page() {
  const health = await loadSignalRoomHealth();
  if (signalRoomTile(health).tag === "Live") redirect(SIGNAL_ROOM_URL);

  return (
    <StubPage
      title="Signal Room"
      tagline="Shop for alerts. Compose your own feed."
      status="Concept"
    >
      <p className="font-serif text-[16px] italic text-forest">
        From the grid and the foundry to the capital stack, Faraday follows every Theater, Sector, and Thread of the
        buildout — Signal by Signal.
      </p>
      <p>
        Signal Room is the configurator storefront — where you compose a personalized intelligence subscription across
        five dimensions: <strong>Theater, Sector, Thread, Company, and Frequency</strong>. Select what matters; Faraday
        delivers the matching Signals on your cadence — real-time, daily, weekly, or threshold-triggered.
      </p>
      <p>
        Where Intelligent Alert is Faraday&apos;s editorial read for everyone, Signal Room is your watchlist — you decide
        what&apos;s in.
      </p>
    </StubPage>
  );
}
