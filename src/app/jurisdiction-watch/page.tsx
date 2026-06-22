import StubPage from "@/components/StubPage";

export const metadata = { title: "Jurisdiction Watch — Faraday" };

// Jurisdiction Watch is brought under the brand: the in-engine path renders an
// in-brand stub on faraday-intelligence.ai instead of a silent 301 off-domain
// (which leaked the brand/session mid-funnel). The live standalone app is offered
// as a clearly-labelled affiliated surface. Full under-brand mount
// (jurisdiction-watch.faraday-intelligence.ai) is a follow-on; the real app lives
// in Faraday/jurisdiction-watch-repo (FAR-27).
export default function Page() {
  return (
    <StubPage
      title="Jurisdiction Watch"
      tagline="Where the buildout meets the statehouse."
      status="In build"
      cta={{ label: "Open the live Jurisdiction Watch (affiliated surface)", href: "https://jurisdiction-watch.com" }}
    >
      <p className="font-serif text-[16px] italic text-forest">
        Power gets approved — or stalled — one jurisdiction at a time. Faraday watches where.
      </p>
      <p>
        Jurisdiction Watch maps permitting posture and interconnection risk across the AI-infrastructure
        buildout on a live choropleth — so you see which jurisdictions are clearing the way and which are
        tightening, before the capital commits.
      </p>
      <p>
        It is moving onto <strong>faraday-intelligence.ai</strong>. In the meantime the live build runs as an
        affiliated surface — same intelligence, opening in a new tab.
      </p>
    </StubPage>
  );
}
