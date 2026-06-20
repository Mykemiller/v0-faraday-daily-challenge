import StubPage from "@/components/StubPage";

export const metadata = { title: "Jurisdiction Watch — Faraday" };

// NOTE: the live interactive choropleth + JPS panel lives in the standalone
// frontend (github.com/Mykemiller/jw). This stub frames the product and links
// out; porting the d3-geo choropleth/JPS components into this app is the
// follow-up (the jw build first needs its UpgradeRequiredError export fixed).
export default function Page() {
  return (
    <StubPage
      title="Jurisdiction Watch"
      tagline="Read the map before the market does."
      status="In build"
      cta={{ label: "Jurisdiction Watch frontend (jw)", href: "https://github.com/Mykemiller/jw" }}
    >
      <p>
        Jurisdiction Watch scores jurisdiction-level posture and permitting risk for AI data center development and
        renders it as a live choropleth. Each jurisdiction carries a <strong>Jurisdiction Posture Score (JPS)</strong> —
        Faraday&apos;s read on how welcoming, how fast, and how durable a place is for new capacity.
      </p>
      <p>
        Twenty jurisdictions are live from the scoring API today. Unlock a jurisdiction&apos;s detailed briefing with
        tokens; the interactive map is being integrated here from the Jurisdiction Watch frontend.
      </p>
    </StubPage>
  );
}
