import StubPage from "@/components/StubPage";

export const metadata = { title: "Intelligent Alert" };

export default function Page() {
  return (
    <StubPage
      title="Intelligent Alert"
      tagline="The moves that matter, the moment they matter."
      status="In production"
      masthead={{ appName: "Intelligent Alert", homeHref: "/intelligent-alert" }}
    >
      <p className="font-serif text-[16px] italic text-forest">
        From the grid and the foundry to the capital stack, Faraday follows every Theater, Sector, and Thread of the
        buildout — Signal by Signal.
      </p>
      <p>
        Intelligent Alert is the curated editorial publication — Faraday decides what&apos;s in, and the same
        sharp read goes to every subscriber. Delivered to your inbox and readable on the web.
      </p>
      <p>
        The <strong>weekly Pulse</strong> briefing is bundled in: a once-a-week step back from the daily flow to frame
        where the AI data center economy is heading.
      </p>
    </StubPage>
  );
}
