import DcStubPage from "@/components/DcStubPage";

export const metadata = { title: "Who is Faraday" };

// More Faraday → Who is Faraday stub — the persona/namesake page, distinct from
// /about (the company). If these end up saying the same thing, consolidate the
// two menu items in buildHeaderMenus/buildSiteMenus to a single link.

export default function WhoIsFaradayPage() {
  return (
    <DcStubPage
      title="Who is Faraday"
      blurb="The namesake, the voice behind the briefings, and why an 1830s experimentalist fronts a data-center intelligence engine."
    >
      <p>This page is on its way.</p>
    </DcStubPage>
  );
}
