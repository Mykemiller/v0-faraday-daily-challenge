import DcStubPage from "@/components/DcStubPage";

export const metadata = { title: "Who is Faraday" };

// More Faraday → Who is Faraday. Copy seeded from the Faraday Brand Bible 4.0
// (§10 The Analyst Personas): Gilbert Faraday — "Gil" — is the brand's analyst
// persona, distinct from /about (Faraday Intelligence, the service). Confirmed
// by Myke 2026-07-02: two separate pages, not duplicates.

export default function WhoIsFaradayPage() {
  return (
    <DcStubPage
      title="Who is Faraday"
      blurb="Gilbert Faraday — Gil to subscribers — is the analyst behind the briefings: an empiricist who reads the actual filings, tracks the actual queue data, and doesn't conclude until he's seen the evidence."
    >
      <p>
        The name carries two centuries of physics heritage: William Gilbert, who coined the
        word <em>electricity</em> in 1600, and Michael Faraday, who built on his work to make
        electric power useful to the world. Gil&rsquo;s full story — the four-chapter career, the
        Munich years, and his colleague Mach Eigen — is on its way.
      </p>
    </DcStubPage>
  );
}
