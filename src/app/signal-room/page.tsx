import StubPage from "@/components/StubPage";

export const metadata = { title: "Signal Room — Faraday" };

export default function Page() {
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
