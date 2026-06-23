import StubPage from "@/components/StubPage";

export const metadata = { title: "Jurisdiction Watch — Faraday" };

// Jurisdiction Watch is brought under the brand via a subdomain (decision locked):
// the real app deploys at jurisdiction-watch.faraday-intelligence.ai (its own
// Vercel project / Supabase / Stripe / token ledger stay intact). This in-engine
// landing keeps /jurisdiction-watch on-brand and routes to the live map — no
// off-domain leak. See FARADAY-FINDINGS.md §5 for the deploy runbook.
const JW_APP_URL = "https://jurisdiction-watch.faraday-intelligence.ai";

export default function Page() {
  return (
    <StubPage
      title="Jurisdiction Watch"
      tagline="Where the buildout meets the statehouse."
      status="Live · under the brand"
      cta={{ label: "Open the live map", href: JW_APP_URL }}
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
        It runs at <strong>jurisdiction-watch.faraday-intelligence.ai</strong> — under the Faraday brand,
        on your Faraday token balance.
      </p>
    </StubPage>
  );
}
